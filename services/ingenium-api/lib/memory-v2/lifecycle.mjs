import { createHash, randomUUID } from 'node:crypto';

export class MemoryError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code) => { throw new MemoryError(code); };
const digest = (value) => createHash('sha256').update(value).digest('hex');
const hash = (value) => digest(JSON.stringify(value));
const text = (value, max = 256) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_INPUT');
  return value;
};
const integer = (value, min, max) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_INPUT');
  return value;
};
const bool = (value) => { if (typeof value !== 'boolean') fail('INVALID_INPUT'); return value; };
const scopeFields = ['organizationId', 'ownerUserId', 'hostId', 'environmentId', 'projectId', 'workspaceId'];
export function scopeKey(scope) {
  if (!scope || scope.visibility !== 'private') fail('INVALID_SCOPE');
  text(scope.bindingHash, 256); integer(scope.bindingEpoch, 0, Number.MAX_SAFE_INTEGER);
  return JSON.stringify(scopeFields.map((field) => field === 'projectId' && scope[field] === null
    ? null : text(scope[field])));
}
export const DEFAULT_MEMORY_POLICY = Object.freeze({ revision: 0, enabled: true, generate: false, useMemory: true, externalContext: false });
export const DEFAULT_CHAT_MEMORY_POLICY = Object.freeze({ revision: 0, useMemory: true, contribute: false });

/** Uses the API's existing SQLite connection. Never opens a DB or starts a scheduler.
 * authorize must recheck membership, host/workspace/chat binding and capability on every call.
 * sources must resolve authoritative transcript hashes/revocation, never caller assertions.
 */
export class MemoryLifecycle {
  constructor({ db, authorize, sources, checkpoint, clock = () => new Date().toISOString() }) {
    if (!db || typeof authorize !== 'function' || typeof sources !== 'function' || typeof checkpoint !== 'function') fail('INVALID_ADAPTER');
    Object.assign(this, { db, authorize, sources, checkpoint, clock });
  }
  access(scope, permission, chatId = null) {
    const key = scopeKey(scope);
    if (chatId !== null) text(chatId);
    if (this.authorize(scope, permission, chatId) !== true) fail('FORBIDDEN');
    return key;
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    let result;
    try { result = fn(); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    // A checkpoint failure occurs after commit: the caller must query operation status.
    this.checkpoint();
    return result;
  }
  policyAt(key) {
    const row = this.db.prepare('SELECT * FROM veyra_memory_policy WHERE scope_key=?').get(key);
    return row ? { revision: row.revision, enabled: !!row.enabled, generate: !!row.generate, useMemory: !!row.use_memory, externalContext: !!row.external_context } : { ...DEFAULT_MEMORY_POLICY };
  }
  chatAt(key, chatId) {
    const row = this.db.prepare('SELECT * FROM veyra_memory_chat_policy WHERE scope_key=? AND chat_id=?').get(key, chatId);
    return row ? { revision: row.revision, useMemory: !!row.use_memory, contribute: !!row.contribute } : { ...DEFAULT_CHAT_MEMORY_POLICY };
  }
  policy(scope, chatId) {
    const key = this.access(scope, 'read', chatId);
    return { schemaVersion: 1, scopeHash: digest(key), chatId, bindingHash: scope.bindingHash, bindingEpoch: scope.bindingEpoch, policy: this.policyAt(key), chat: this.chatAt(key, chatId), available: true };
  }
  operation(scope, operationId) {
    const key = this.access(scope, 'read');
    const row = this.db.prepare('SELECT receipt_json FROM veyra_memory_receipt WHERE scope_key=? AND operation_id=?').get(key, text(operationId, 128));
    return row ? JSON.parse(row.receipt_json) : null;
  }
  mutate(key, operationId, request, fn) {
    text(operationId, 128);
    const requestHash = hash(request);
    return this.transaction(() => {
      const prior = this.db.prepare('SELECT * FROM veyra_memory_receipt WHERE scope_key=? AND operation_id=?').get(key, operationId);
      if (prior) {
        if (prior.request_hash !== requestHash) fail('OPERATION_CONFLICT');
        return { receipt: JSON.parse(prior.receipt_json), idempotent: true };
      }
      const receipt = { schemaVersion: 1, receiptId: randomUUID(), operationId, status: 'committed', operation: request.kind, committedAt: this.clock(), scopeHash: digest(key) };
      Object.assign(receipt, fn(receipt));
      this.db.prepare('INSERT INTO veyra_memory_receipt VALUES (?,?,?,?)').run(key, operationId, requestHash, JSON.stringify(receipt));
      return { receipt, idempotent: false };
    });
  }
  setPolicy(scope, { operationId, expectedRevision, ...input }) {
    const key = this.access(scope, 'write-policy');
    const policy = Object.fromEntries(['enabled', 'generate', 'useMemory', 'externalContext'].map((field) => [field, bool(input[field])]));
    integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1);
    return this.mutate(key, operationId, { kind: 'policy', expectedRevision, policy }, () => {
      if (this.policyAt(key).revision !== expectedRevision) fail('VERSION_CONFLICT');
      const revision = expectedRevision + 1;
      this.db.prepare(`INSERT INTO veyra_memory_policy VALUES (?,?,?,?,?,?) ON CONFLICT(scope_key) DO UPDATE SET
        revision=excluded.revision,enabled=excluded.enabled,generate=excluded.generate,use_memory=excluded.use_memory,external_context=excluded.external_context`)
        .run(key, revision, +policy.enabled, +policy.generate, +policy.useMemory, +policy.externalContext);
      return { revision };
    });
  }
  setChatPolicy(scope, chatId, { operationId, expectedRevision, useMemory, contribute }) {
    const key = this.access(scope, 'write-policy', chatId);
    bool(useMemory); bool(contribute); integer(expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1);
    return this.mutate(key, operationId, { kind: 'chat-policy', chatId, expectedRevision, useMemory, contribute }, () => {
      if (this.chatAt(key, chatId).revision !== expectedRevision) fail('VERSION_CONFLICT');
      const revision = expectedRevision + 1;
      this.db.prepare(`INSERT INTO veyra_memory_chat_policy VALUES (?,?,?,?,?) ON CONFLICT(scope_key,chat_id) DO UPDATE SET
        revision=excluded.revision,use_memory=excluded.use_memory,contribute=excluded.contribute`).run(key, chatId, revision, +useMemory, +contribute);
      return { revision };
    });
  }
  generationState(key, chatId) {
    const policy = this.policyAt(key), chat = this.chatAt(key, chatId);
    if (!policy.enabled || !policy.generate || !chat.contribute) fail('GENERATION_EXCLUDED');
    return { policy, chat };
  }
  validateSources(scope, key, chatId, sourceRefs, externalContext) {
    if (!Array.isArray(sourceRefs) || sourceRefs.length < 1 || sourceRefs.length > 32) fail('INVALID_INPUT');
    if (new Set(sourceRefs.map((ref) => ref.id)).size !== sourceRefs.length) fail('INVALID_INPUT');
    return sourceRefs.map((ref) => {
      const id = text(ref.id), contentHash = text(ref.contentHash, 64);
      if (contentHash.length !== 64 || [...contentHash].some((c) => !'0123456789abcdef'.includes(c))) fail('INVALID_INPUT');
      const source = this.sources(scope, chatId, id);
      if (!source || source.contentHash !== contentHash || source.active !== false || source.excluded !== false || source.uncertain !== false || source.idleEligible !== true
        || !['transcript', 'tool', 'external'].includes(source.kind)) fail('SOURCE_UNAVAILABLE');
      if (source.kind !== 'transcript' && !externalContext) fail('EXTERNAL_CONTEXT_EXCLUDED');
      // Suppress the source identity, including revised versions, after forget.
      if (this.suppressed(key, 'source', id)) fail('SOURCE_FORGOTTEN');
      return { id, contentHash, kind: source.kind, chatId };
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  }
  admit(scope, chatId, sourceRefs) {
    const key = this.access(scope, 'generate', chatId);
    const { policy, chat } = this.generationState(key, chatId);
    const sources = this.validateSources(scope, key, chatId, sourceRefs, policy.externalContext);
    return { schemaVersion: 1, scopeHash: digest(key), chatId, policyRevision: policy.revision, chatRevision: chat.revision, sources, inputHash: hash(sources) };
  }
  processedExtraction(scope, admission) {
    const key = this.access(scope, 'generate', admission?.chatId);
    if (admission?.scopeHash !== digest(key)) fail('STALE_ADMISSION');
    text(admission.inputHash, 64);
    const row = this.db.prepare('SELECT memory_id FROM veyra_memory_extraction WHERE scope_key=? AND input_hash=?').get(key, admission.inputHash);
    return row ? { memoryId: row.memory_id } : null;
  }
  commitRecall(scope, { operationId, admission, content, model }) {
    const key = this.access(scope, 'generate', admission?.chatId);
    text(content, 8192); text(model, 256);
    // Model/provider adapters must minimize/redact before this point. This is only defense in depth.
    if (['-----BEGIN PRIVATE KEY-----', 'Bearer ', 'sk-proj-'].some((secret) => content.includes(secret))) fail('CONTENT_REJECTED');
    const request = { kind: 'recall', admission, contentHash: digest(content), model };
    return this.mutate(key, operationId, request, () => {
      const { policy, chat } = this.generationState(key, admission.chatId);
      if (admission.scopeHash !== digest(key) || admission.policyRevision !== policy.revision || admission.chatRevision !== chat.revision) fail('STALE_ADMISSION');
      const sources = this.validateSources(scope, key, admission.chatId, admission.sources, policy.externalContext);
      if (hash(sources) !== admission.inputHash) fail('STALE_ADMISSION');
      const contentHash = digest(content);
      if (this.suppressed(key, 'content', contentHash)) fail('CONTENT_FORGOTTEN');
      if (this.db.prepare('SELECT 1 FROM veyra_memory_extraction WHERE scope_key=? AND input_hash=?').get(key, admission.inputHash)) fail('INPUT_ALREADY_PROCESSED');
      const id = randomUUID(), now = this.clock();
      this.db.prepare('INSERT INTO veyra_memory_extraction VALUES (?,?,?)').run(key, admission.inputHash, id);
      this.db.prepare('INSERT INTO veyra_memory_recall VALUES (?,?,?,?,?,1,?,?,?)')
        .run(key, id, content, contentHash, JSON.stringify({ sources, model, policyRevision: policy.revision, inferred: true }), 'active', now, now);
      return { memoryId: id, version: 1, inputHash: admission.inputHash, jobHash: hash([key, admission.chatId, sources.map(({ id, contentHash }) => ({ id, contentHash })), model]) };
    });
  }
  suppressed(key, kind, target) {
    return !!this.db.prepare('SELECT 1 FROM veyra_memory_suppression WHERE scope_key=? AND kind=? AND target=?').get(key, kind, target);
  }
  activeRows(key) {
    return this.db.prepare(`SELECT * FROM veyra_memory_recall WHERE scope_key=? AND state='active' ORDER BY updated_at DESC,id`).all(key)
      .filter((row) => !this.suppressed(key, 'memory', row.id) && !this.suppressed(key, 'content', row.content_hash)
        && !JSON.parse(row.provenance_json).sources.some((ref) => this.suppressed(key, 'source', ref.id)));
  }
  sourceAvailable(scope, provenance) {
    return provenance.sources.every((ref) => {
      if (this.authorize(scope, 'read-source', ref.chatId) !== true) return false;
      const current = this.sources(scope, ref.chatId, ref.id);
      return current && current.contentHash === ref.contentHash && current.excluded === false && current.uncertain === false;
    });
  }
  recall(scope, chatId, { maxItems = 16, maxTokens = 2048 } = {}) {
    const key = this.access(scope, 'read', chatId);
    integer(maxItems, 1, 16); integer(maxTokens, 1, 2048);
    const policy = this.policyAt(key), chat = this.chatAt(key, chatId);
    if (!policy.enabled || !policy.useMemory || !chat.useMemory) return { items: [], omitted: [], excluded: true, usedTokens: 0 };
    const items = [], omitted = []; let usedTokens = 0;
    for (const row of this.activeRows(key)) {
      const provenance = JSON.parse(row.provenance_json);
      // A source can be revoked after extraction. Never serve stale authorization.
      const valid = this.sourceAvailable(scope, provenance);
      if (!valid) { omitted.push({ id: row.id, reason: 'source-unavailable' }); continue; }
      const estimatedTokens = Math.ceil(Buffer.byteLength(row.content, 'utf8') / 3);
      if (items.length >= maxItems || usedTokens + estimatedTokens > maxTokens) { omitted.push({ id: row.id, reason: 'budget' }); continue; }
      usedTokens += estimatedTokens;
      items.push({ id: row.id, version: row.version, content: row.content, contentHash: row.content_hash, provenance,
        scope: { ...scope }, contentKind: 'untrusted_memory_data', instructionAuthority: false, stalePossible: true, estimatedTokens, reason: 'same-private-execution-scope' });
    }
    return { items, omitted, excluded: false, usedTokens };
  }
  inspect(scope, { offset = 0, limit = 25 } = {}) {
    const key = this.access(scope, 'read');
    integer(offset, 0, Number.MAX_SAFE_INTEGER); integer(limit, 1, 100);
    const rows = this.activeRows(key).filter((row) => this.sourceAvailable(scope, JSON.parse(row.provenance_json)));
    return { items: rows.slice(offset, offset + limit).map((row) => ({ id: row.id, content: row.content, version: row.version, provenance: JSON.parse(row.provenance_json) })), total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null };
  }
  suppressRows(key, rows, receipt) {
    const insert = this.db.prepare('INSERT INTO veyra_memory_suppression VALUES (?,?,?,?) ON CONFLICT(scope_key,kind,target) DO NOTHING');
    for (const row of rows) {
      insert.run(key, 'memory', row.id, receipt.receiptId);
      insert.run(key, 'content', row.content_hash, receipt.receiptId);
      for (const source of JSON.parse(row.provenance_json).sources) insert.run(key, 'source', source.id, receipt.receiptId);
    }
    // A source may back several summaries. Wipe every derivative in this transaction.
    const erased = this.db.prepare(`SELECT * FROM veyra_memory_recall WHERE scope_key=? AND state='active'`).all(key).filter((row) =>
      this.suppressed(key, 'memory', row.id) || this.suppressed(key, 'content', row.content_hash)
      || JSON.parse(row.provenance_json).sources.some((source) => this.suppressed(key, 'source', source.id)));
    for (const row of erased) {
      insert.run(key, 'memory', row.id, receipt.receiptId);
      insert.run(key, 'content', row.content_hash, receipt.receiptId);
      this.db.prepare(`UPDATE veyra_memory_recall SET content='',provenance_json='[]',state='forgotten',version=version+1,updated_at=? WHERE scope_key=? AND id=?`).run(receipt.committedAt, key, row.id);
    }
    return erased.length;
  }
  forget(scope, { operationId, memoryId, expectedVersion }) {
    const key = this.access(scope, 'forget'); text(memoryId); integer(expectedVersion, 1, Number.MAX_SAFE_INTEGER - 1);
    return this.mutate(key, operationId, { kind: 'forget', memoryId, expectedVersion }, (receipt) => {
      const row = this.db.prepare(`SELECT * FROM veyra_memory_recall WHERE scope_key=? AND id=? AND state='active'`).get(key, memoryId);
      if (!row) fail('NOT_FOUND');
      if (row.version !== expectedVersion) fail('VERSION_CONFLICT');
      return { memoryId, version: row.version + 1, forgottenCount: this.suppressRows(key, [row], receipt) };
    });
  }
  previewReset(scope) {
    const key = this.access(scope, 'forget');
    const rows = this.activeRows(key);
    return { scopeHash: digest(key), count: rows.length, confirmation: hash([key, rows.map((row) => [row.id, row.version, row.content_hash])]) };
  }
  reset(scope, { operationId, confirmation }) {
    const key = this.access(scope, 'forget'); text(confirmation, 64);
    return this.mutate(key, operationId, { kind: 'reset', confirmation }, (receipt) => {
      const preview = this.previewReset(scope);
      if (confirmation !== preview.confirmation) fail('RESET_CHANGED');
      return { forgottenCount: this.suppressRows(key, this.activeRows(key), receipt), scopeHash: preview.scopeHash };
    });
  }
  exportSuppressions(scope) {
    const key = this.access(scope, 'backup');
    return { schemaVersion: 1, scopeHash: digest(key), entries: this.db.prepare('SELECT kind,target,receipt_id FROM veyra_memory_suppression WHERE scope_key=? ORDER BY kind,target').all(key),
      receipts: this.db.prepare('SELECT operation_id,request_hash,receipt_json FROM veyra_memory_receipt WHERE scope_key=? ORDER BY operation_id').all(key)
        .filter((row) => ['forget', 'reset'].includes(JSON.parse(row.receipt_json).operation)) };
  }
  applySuppressions(scope, bundle) {
    const key = this.access(scope, 'restore');
    if (bundle?.schemaVersion !== 1 || bundle.scopeHash !== digest(key) || !Array.isArray(bundle.entries) || bundle.entries.length > 100000 || !Array.isArray(bundle.receipts) || bundle.receipts.length > 100000) fail('INVALID_SUPPRESSION');
    return this.transaction(() => {
            for (const row of bundle.receipts) {
        text(row.operation_id, 128); text(row.request_hash, 64); text(row.receipt_json, 4096);
        const receipt = JSON.parse(row.receipt_json);
        if (receipt.scopeHash !== digest(key) || receipt.operationId !== row.operation_id || !['forget', 'reset'].includes(receipt.operation)
          || receipt.status !== 'committed' || receipt.schemaVersion !== 1) fail('INVALID_SUPPRESSION');
        const existing = this.db.prepare('SELECT request_hash FROM veyra_memory_receipt WHERE scope_key=? AND operation_id=?').get(key, row.operation_id);
        if (existing && existing.request_hash !== row.request_hash) fail('OPERATION_CONFLICT');
        this.db.prepare('INSERT INTO veyra_memory_receipt VALUES (?,?,?,?) ON CONFLICT(scope_key,operation_id) DO NOTHING').run(key, row.operation_id, row.request_hash, row.receipt_json);
      }
      for (const entry of bundle.entries) {
        if (!['memory', 'source', 'content'].includes(entry.kind)) fail('INVALID_SUPPRESSION');
        text(entry.target); text(entry.receipt_id);
        this.db.prepare('INSERT INTO veyra_memory_suppression VALUES (?,?,?,?) ON CONFLICT(scope_key,kind,target) DO NOTHING').run(key, entry.kind, entry.target, entry.receipt_id);
      }
      return { suppressedCount: this.suppressRows(key, [], { receiptId: randomUUID(), committedAt: this.clock() }) };
    });
  }
}
