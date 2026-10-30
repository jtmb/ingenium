import { readVerifiedRecallSource } from './recall-availability.mjs';
import { readCompletedSnapshotSource } from './bounded-snapshot.mjs';
import { createHash } from 'node:crypto';
import { scopeKey } from './lifecycle.mjs';
const sha = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const parse = (value) => { try { const data = JSON.parse(value); return data && typeof data === 'object' && !Array.isArray(data) ? data : null; } catch { return null; } };
const timestamp = (value) => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
const scopeFields = ['organizationId','ownerUserId','projectId','workspaceId','hostId','environmentId','bindingHash','bindingEpoch','visibility'];
export const CODEX_MEMORY_IDLE_POLICY = Object.freeze({ version: 'codex-memory-source-v1', defaultHours: 6, minHours: 1, maxHours: 48,
  provenance: Object.freeze(['https://learn.chatgpt.com/docs/config-file/config-reference','https://learn.chatgpt.com/docs/customization/memories']) });

/** Only server-owned policy facts enter this seam; callers never forward request body configuration. */
export function eligibilityFingerprint(policy, scope, execution) {
  if (!policy || policy.version !== CODEX_MEMORY_IDLE_POLICY.version || !Number.isInteger(policy.minRolloutIdleHours)
    || policy.minRolloutIdleHours < 1 || policy.minRolloutIdleHours > 48 || policy.runtimeId !== execution.runtimeId
    || scopeFields.some((field) => policy.scope?.[field] !== scope[field])
    || !policy.admission || !['settled','pending','unknown'].includes(policy.admission.state)
    || !Number.isSafeInteger(policy.admission.revision) || policy.admission.revision < 0
    || !Number.isSafeInteger(policy.admission.contextRevision) || policy.admission.contextRevision < 0
    || typeof policy.admission.chatId !== 'string' || !policy.admission.chatId
    || typeof policy.admission.conversationId !== 'string' || !policy.admission.conversationId) return null;
  const admission = policy.admission;
  return `${policy.version}:${policy.minRolloutIdleHours}:${sha(JSON.stringify([scopeKey(scope),scope.bindingHash,scope.bindingEpoch,execution.runtimeId,
    admission.chatId,admission.conversationId,admission.state,admission.revision,admission.contextRevision]))}`;
}

/** Reads canonical source facts on the supplied API connection; no transcript, policy or job is written. */
export function contextMemorySourceState({ db, scope, execution, chatId, messageId, conversationId, contentHash, policy = null, completedSnapshot, readAvailability, nowMs = Date.now() }) {
  const key = scopeKey(scope);
  if (scope.projectId === null || !Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  const source = db.prepare(`SELECT m.id,m.sequence,m.role,m.content,m.content_hash,m.metadata,m.idempotency_key,m.created_at
    FROM context_messages m JOIN context_conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id
    WHERE m.id=? AND m.conversation_id=? AND m.project_id=? AND c.organization_id=? AND c.owner_user_id=? AND c.visibility='private'
      AND json_extract(c.metadata,'$.source')='opencode-chat' AND json_extract(c.metadata,'$.sourceRuntimeId')=?
      AND json_extract(c.metadata,'$.sourceSessionId')=?`).get(messageId,conversationId,scope.projectId,scope.organizationId,scope.ownerUserId,execution.runtimeId,chatId);
  if (!source || source.content_hash !== contentHash || typeof source.content !== 'string' || sha(source.content) !== contentHash) return null;
  const excluded = !!db.prepare(`SELECT 1 FROM veyra_memory_suppression WHERE scope_key=? AND
    ((kind='source' AND target=?) OR (kind='content' AND target=?)) LIMIT 1`).get(key,messageId,contentHash);
  if (completedSnapshot !== undefined) {
    const metadata=parse(source.metadata);
    const policyValid=policy?.version===CODEX_MEMORY_IDLE_POLICY.version && policy.runtimeId===execution.runtimeId
      && scopeFields.every(field=>policy.scope?.[field]===scope[field]);
    const selected=policyValid ? readCompletedSnapshotSource(completedSnapshot,{scope,execution,chatId,
      engineMessageId:metadata?.sourceMessageId,role:source.role,content:source.content,contentHash,
      minRolloutIdleHours:policy.minRolloutIdleHours}) : null;
    if(!selected) return {active:false,excluded,uncertain:true,idleEligible:false};
    const terminal=db.prepare(`SELECT m.id,m.sequence,m.content,m.content_hash,m.idempotency_key,m.metadata,
      cp.message_count,cp.idempotency_key AS checkpoint_key,cp.metadata AS checkpoint_metadata
      FROM context_messages m JOIN context_checkpoints cp ON cp.project_id=m.project_id AND cp.conversation_id=m.conversation_id AND cp.through_message_id=m.id
      WHERE m.project_id=? AND m.conversation_id=? AND m.role='assistant'
        AND json_extract(m.metadata,'$.sourceMessageId')=? ORDER BY cp.sequence DESC LIMIT 1`)
      .get(scope.projectId,conversationId,selected.terminalAssistantId);
    const turnKey=(role,id)=>`opencode-${role}:${sha(`${execution.runtimeId}\0${chatId}\0${id}`)}`;
    const matches=meta=>meta?.source==='opencode-chat'&&meta.sourceRuntimeId===execution.runtimeId&&meta.sourceSessionId===chatId;
    const user=db.prepare(`SELECT id,sequence,content,content_hash,idempotency_key,metadata FROM context_messages
      WHERE project_id=? AND conversation_id=? AND role='user' AND json_extract(metadata,'$.sourceMessageId')=?`)
      .get(scope.projectId,conversationId,selected.userMessageId);
    const pairExcluded=excluded || !!db.prepare(`SELECT 1 FROM veyra_memory_suppression WHERE scope_key=? AND
      ((kind='source' AND target IN (?,?)) OR (kind='content' AND target IN (?,?))) LIMIT 1`)
      .get(key,user?.id??'',terminal?.id??'',selected.userContentHash,selected.terminalContentHash);
    const throughMetadata=parse(terminal?.metadata), checkpointMetadata=parse(terminal?.checkpoint_metadata);
    const complete=matches(metadata) && source.idempotency_key===turnKey(source.role,metadata.sourceMessageId)
      && !!user && matches(parse(user.metadata)) && user.idempotency_key===turnKey('user',selected.userMessageId)
      && typeof user.content==='string' && sha(user.content)===selected.userContentHash && user.content_hash===selected.userContentHash
      && !!terminal && user.sequence+1===terminal.sequence && matches(throughMetadata) && matches(checkpointMetadata)
      && checkpointMetadata.sourceAssistantMessageId===selected.terminalAssistantId
      && terminal.idempotency_key===turnKey('assistant',selected.terminalAssistantId)
      && terminal.checkpoint_key===turnKey('checkpoint',selected.terminalAssistantId)
      && typeof terminal.content==='string' && sha(terminal.content)===selected.terminalContentHash && terminal.content_hash===selected.terminalContentHash
      && terminal.message_count===terminal.sequence+1 && source.sequence<=terminal.sequence
      && db.prepare('SELECT COUNT(*) AS count FROM context_messages WHERE project_id=? AND conversation_id=? AND sequence<=?')
        .get(scope.projectId,conversationId,terminal.sequence).count===terminal.message_count;
    const host=db.prepare('SELECT enabled,generate,external_context FROM veyra_memory_policy WHERE scope_key=?').get(key);
    const chat=db.prepare('SELECT contribute FROM veyra_memory_chat_policy WHERE scope_key=? AND chat_id=?').get(key,chatId);
    const archive=db.prepare(`SELECT event_type,archive_sequence FROM context_checkpoint_audit_events WHERE project_id=? AND conversation_id=?
      AND archive_sequence IS NOT NULL ORDER BY archive_sequence DESC LIMIT 1`).get(scope.projectId,conversationId);
    return {active:false,excluded:pairExcluded,uncertain:!complete,
      idleEligible:!!(complete&&!pairExcluded&&(!archive||archive.event_type==='conversation_unarchived')&&host?.enabled===1&&host.generate===1&&chat?.contribute===1
        &&(!selected.externalContextUsed||host.external_context===1)),
      eligibilityVersion:selected.eligibilityVersion+':'+(archive?.archive_sequence??-1)};
  }
  if (readAvailability !== undefined) {
    const state=readVerifiedRecallSource(readAvailability,{db,scope,execution,chatId,messageId,contentHash});
    return state?{...state,excluded:excluded||state.excluded}:{active:false,excluded,uncertain:true,idleEligible:false};
  }
  const last = db.prepare(`SELECT id,sequence,role,metadata,idempotency_key,created_at FROM context_messages
    WHERE project_id=? AND conversation_id=? ORDER BY sequence DESC LIMIT 1`).get(scope.projectId,conversationId);
  const checkpoint = db.prepare(`SELECT through_message_id,message_count,idempotency_key,metadata,created_at FROM context_checkpoints
    WHERE project_id=? AND conversation_id=? ORDER BY sequence DESC LIMIT 1`).get(scope.projectId,conversationId);
  const count = db.prepare('SELECT COUNT(*) AS count FROM context_messages WHERE project_id=? AND conversation_id=?').get(scope.projectId,conversationId).count;
  const sourceMetadata = parse(source.metadata), lastMetadata = parse(last?.metadata), checkpointMetadata = parse(checkpoint?.metadata);
  const provenanceMatches = (metadata) => metadata?.source === 'opencode-chat' && metadata.sourceRuntimeId === execution.runtimeId && metadata.sourceSessionId === chatId;
  const turnKey = (role, sourceId) => `opencode-${role}:${sha(`${execution.runtimeId}\0${chatId}\0${sourceId}`)}`;
  const sourceTime = timestamp(source.created_at), lastTime = timestamp(last?.created_at), checkpointTime = timestamp(checkpoint?.created_at);
  const complete = !!last && !!checkpoint && ['user','assistant'].includes(source.role) && provenanceMatches(sourceMetadata)
    && typeof sourceMetadata.sourceMessageId === 'string' && sourceMetadata.sourceMessageId.length > 0
    && source.idempotency_key === turnKey(source.role,sourceMetadata.sourceMessageId)
    && last.role === 'assistant' && provenanceMatches(lastMetadata) && typeof lastMetadata.sourceMessageId === 'string'
    && last.idempotency_key === turnKey('assistant',lastMetadata.sourceMessageId)
    && provenanceMatches(checkpointMetadata) && checkpointMetadata.sourceAssistantMessageId === lastMetadata.sourceMessageId
    && checkpoint.idempotency_key === turnKey('checkpoint',lastMetadata.sourceMessageId)
    && checkpoint.through_message_id === last.id && checkpoint.message_count === count && last.sequence + 1 === count
    && source.sequence <= last.sequence && [sourceTime,lastTime,checkpointTime].every((value) => Number.isFinite(value) && value <= nowMs);
  const runtime = execution.mode === 'runtime' ? db.prepare(`SELECT id,state,security_epoch,revision,active_connections,active_generations,last_authenticated_activity_at
    FROM runtime_instances WHERE id=? AND workspace_id=? AND organization_id=? AND project_id=? AND owner_user_id=?`)
    .get(execution.runtimeId,scope.workspaceId,scope.organizationId,scope.projectId,scope.ownerUserId) : null;
  if (execution.mode === 'runtime' && (!runtime || !['READY','IDLE'].includes(runtime.state) || runtime.security_epoch !== scope.bindingEpoch)) return null;
  const countersKnown = !!runtime && [runtime.active_connections,runtime.active_generations].every((value) => Number.isSafeInteger(value) && value >= 0);
  const runtimeActive = countersKnown && (runtime.active_connections > 0 || runtime.active_generations > 0);
  const finished = runtime ? db.prepare(`SELECT event_type,revision,created_at FROM runtime_activity_events WHERE runtime_id=?
    AND event_type IN ('generation_started','generation_finished') ORDER BY revision DESC LIMIT 1`).get(runtime.id) : null;
  const activityTime = timestamp(runtime?.last_authenticated_activity_at), finishedTime = timestamp(finished?.created_at);
  const activityKnown = countersKnown && finished?.event_type === 'generation_finished' && finished.revision <= runtime.revision
    && [activityTime,finishedTime].every((value) => Number.isFinite(value) && value <= nowMs);
  const host = db.prepare('SELECT enabled,generate FROM veyra_memory_policy WHERE scope_key=?').get(key);
  const chat = db.prepare('SELECT contribute FROM veyra_memory_chat_policy WHERE scope_key=? AND chat_id=?').get(key,chatId);
  const archive = db.prepare(`SELECT event_type,archive_sequence FROM context_checkpoint_audit_events WHERE project_id=? AND conversation_id=?
    AND archive_sequence IS NOT NULL ORDER BY archive_sequence DESC LIMIT 1`).get(scope.projectId,conversationId);
  const archiveAllowsGeneration = !archive || archive.event_type === 'conversation_unarchived';
  const policyFingerprint = eligibilityFingerprint(policy,scope,execution);
  const fingerprint = policyFingerprint === null ? null : policyFingerprint + ':' + (archive?.archive_sequence ?? -1);
  const admissionMatches = fingerprint !== null && policy.admission.chatId === chatId && policy.admission.conversationId === conversationId
    && policy.admission.contextRevision === count;
  const pending = admissionMatches && policy.admission.state === 'pending';
  const uncertainAdmission = admissionMatches && policy.admission.state === 'unknown';
  const active = runtimeActive || pending;
  const lastActivity = Math.max(sourceTime,lastTime,checkpointTime,activityTime,finishedTime);
  const idleEligible = !excluded && complete && archiveAllowsGeneration && !uncertainAdmission && activityKnown && !active && host?.enabled === 1 && host.generate === 1 && chat?.contribute === 1
    && admissionMatches && policy.admission.state === 'settled' && nowMs - lastActivity >= policy.minRolloutIdleHours * 3_600_000;
  return { active: !!active, excluded, uncertain: !complete || !!uncertainAdmission, idleEligible: !!idleEligible,
    ...(fingerprint === null ? {} : { eligibilityVersion: fingerprint }) };
}
