/** Root-reviewed evidence ONLY. No process/model/install/download side effects.
 * No sample/fallback peak, metadata-size-to-RAM conversion or automatic approval.
 * Must run as the actual API uid so the final private file has that uid/custody.
 */
import { readFileSync, lstatSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import {projectCapturedConfiguration,assertStableConfiguration,assertKernelEnvironment,assertCaptureDecoder} from './capture-projection.mjs';
import {parseStrictJobJson} from '../../../../services/ingenium-api/lib/dot-v2/job-bootstrap-frame.mjs';
const fail = code => { throw new Error(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = v => v && typeof v === 'object' ? Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
  : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v);
const positive = n => Number.isSafeInteger(n) && n > 0;
function trusted(path, max = 1048576) {
  const facts = lstatSync(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.uid !== 0 || facts.nlink !== 1 || facts.mode & 0o022 || facts.size > max) fail('ROOT_CAPTURE_CUSTODY_REQUIRED');
  const bytes = readFileSync(path); if (bytes.length !== facts.size) fail('ROOT_CAPTURE_CHANGED');
  return { bytes, sha256: hash(bytes) };
}
function json(path) { const input = trusted(path); return { ...input, value: parseStrictJobJson(input.bytes,1048576) }; }
function counter(snapshot, field) {
  const value = snapshot.kernel[field]; if (!/^(0|[1-9][0-9]*)\n?$/.test(value ?? '')) fail('RAW_KERNEL_COUNTER_REQUIRED');
  const n = Number(value.trim()); if (!Number.isSafeInteger(n)) fail('RAW_KERNEL_COUNTER_RANGE'); return n;
}
function rss(snapshot) { const match = snapshot.procStatus.match(/^VmRSS:\s+([0-9]+) kB$/m); if (!match) fail('RAW_PROC_RSS_REQUIRED'); return Number(match[1]) * 1024; }
function run(path, expectedCase, review, closureSha256) {
  const descriptor=review.captureDecoders?.[expectedCase];assertCaptureDecoder(descriptor,expectedCase);
  const capture = json(path), value = capture.value, owner = value.kernelOwner;
  if (value.case !== expectedCase || value.successful !== true || value.productionApproval !== false
    || !['ownerExitJoined', 'ownerCloseJoined', 'stdoutJoined', 'stderrJoined'].every(k => value[k] === true)
    || !owner || owner.runId !== value.runId || owner.waited !== true || owner.populated !== false || owner.leafRemoved !== true
    || owner.stdoutEOF !== true || owner.stderrEOF !== true || owner.deadlineKilled !== false
    || !['memoryPeakBytes', 'leaderMaxRssBytes', 'pidsPeak', 'childStartTicks', 'inode'].every(k => positive(owner[k]))
    || value.exit?.code !== 0 || value.exit.signal) fail('POSITIVE_ORIGINAL_CAPTURE_REQUIRED');
  const stdout = trusted(resolve(dirname(path), 'stdout.log')), stderr = trusted(resolve(dirname(path), 'stderr.log'));
  if (stdout.sha256 !== value.stdoutSha256 || stderr.sha256 !== value.stderrSha256) fail('ORIGINAL_CAPTURE_HASH');
  // A constrained/failed workload must not mint a deceptively small peak.
  const errors = stderr.bytes.toString('utf8');
  for (const label of ['oom', 'oom_kill', 'oom_group_kill']) if (new RegExp(`^${label} [1-9][0-9]*$`, 'm').test(errors)) fail('QUALIFICATION_OOM');
  if (/^max [1-9][0-9]*$/m.test(errors)) fail('QUALIFICATION_MEMORY_OR_PIDS_LIMIT_HIT');
  const events = stdout.bytes.toString('utf8').split('\n').filter(s => s.startsWith('{')).map(s => parseStrictJobJson(Buffer.from(s),1048576));
  const grant=json(descriptor.grantPath);
  const projection=projectCapturedConfiguration({capture:value,captureSha256:capture.sha256,grant:grant.value,grantSha256:grant.sha256,descriptor,review,closureSha256,events});
  return { ...capture, owner, events, projection, stdoutSha256: stdout.sha256, stderrSha256: stderr.sha256 };
}
export async function generateApproval({ reviewPath, profilePath, profileModule, resourceModule, outputPath }) {
  if (process.platform !== 'linux' || process.getuid?.() === 0) fail('ACTUAL_NONROOT_API_UID_REQUIRED');
  const review = json(reviewPath), r = review.value;
  if (r.kind !== 'root-cpu-qualification-review-v2' || r.approved !== true || r.templateOnly === true || r.platform !== 'linux-cgroup-v2'
    || r.fixtureEvidence !== false || !r.bindings || !r.cases || !positive(r.approvalLifetimeMs) || r.approvalLifetimeMs > 86400000
    || !positive(r.maxLifetimeMs) || r.maxLifetimeMs > 1800000 || !positive(r.maxWitnessLifetimeMs) || r.maxWitnessLifetimeMs > 60000) fail('ACTUAL_ROOT_REVIEW_REQUIRED');
  assertStableConfiguration(r.bindings);assertKernelEnvironment(r.kernelEnvironment);
  const { ManagedCpuProfile } = await import(pathToFileURL(profileModule));
  const profile = ManagedCpuProfile.load(profilePath);
  if (r.bindings.profileDigest !== profile.profileDigest || r.bindings.codeBundleDigest !== hash(canonical(profile.value.bundle))
    || r.bindings.helperSha256 !== hash(profile.helperSource) || r.bindings.witnessSha256 !== hash(profile.witnessSource)) fail('EXACT_PROFILE_REVIEW_MISMATCH');
  const closure = json(r.dependencyClosurePath);
  if (closure.sha256 !== r.bindings.dependencyClosureSha256 || closure.value.allRecordHashesVerified !== true
    || closure.value.environmentSealed !== true || !closure.value.bundledVad?.sha256 || closure.value.bundledVad.bytes !== 1245151) fail('SEALED_ACTUAL_DEPENDENCY_CLOSURE_REQUIRED');
  const cold = run(r.cases.coldHot, 'model-cold-hot', r, closure.sha256), helper = run(r.cases.helper, 'helper', r, closure.sha256),
    witness = run(r.cases.witness, 'witness', r, closure.sha256), probe = run(r.cases.probe, 'probe', r, closure.sha256), wire = run(r.cases.wire, 'production-wire', r, closure.sha256);
  if (r.kernelEnvironment.bootId !== cold.owner.bootId || [helper, witness, probe, wire].some(capture => capture.owner.bootId !== cold.owner.bootId
    || capture.owner.namespaceInode !== cold.owner.namespaceInode)) fail('QUALIFIED_KERNEL_OR_NAMESPACE_CHANGED');
  const wireAuthority = json(r.coreWireReceiptPath);
  if (wireAuthority.sha256 !== r.coreWireReceiptSha256 || wireAuthority.value.actualCoreWriter !== true
    || wireAuthority.value.allCpuV2ReceiptsVerified !== true || wireAuthority.value.originalHelperAndWitnessJoined !== true
    || wireAuthority.value.controlAndLeavesRetired !== true || wireAuthority.value.fixturesUsed !== false
    || canonical(wireAuthority.value.bindings) !== canonical(r.bindings)) fail('ACTUAL_CORE_PRODUCER_QUALIFICATION_REQUIRED');
  const phase = (capture, name) => { const values = capture.events.filter(e => e.phase === name); if (values.length !== 1) fail('ACTUAL_RAW_PHASE_REQUIRED'); return values[0]; };
  const ready = phase(cold, 'cold-ready'), beforeHot = phase(cold, 'before-hot'), afterHot = phase(cold, 'after-hot');
  const wireBefore = phase(wire, 'wire-before-hot'), wireAfter = phase(wire, 'wire-after-hot');
  if (!wire.events.some(e => e.phase === 'production-wire-complete' && e.fullPayloadEnvelopeTested === true && e.realCoreProducerUsed === true)) fail('FULL_ACTUAL_PRODUCTION_WIRE_REQUIRED');
  const modelsResidentBytes = Math.max(rss(ready), counter(ready, 'memory.current'));
  const measuredBound = run => Math.max(run.owner.memoryPeakBytes, run.owner.leaderMaxRssBytes);
  const modelWarmupExtraBytes = Math.max(cold.owner.leaderMaxRssBytes - rss(ready), cold.owner.memoryPeakBytes - counter(ready, 'memory.current'),
    measuredBound(wire) - modelsResidentBytes - measuredBound(helper) - measuredBound(witness) - measuredBound(probe));
  const hotWorkspaceBytes = Math.max(afterHot.ruMaxRssBytes - rss(beforeHot), counter(afterHot, 'memory.peak') - counter(beforeHot, 'memory.current'),
    wireAfter.ruMaxRssBytes - rss(wireBefore), counter(wireAfter, 'memory.peak') - counter(wireBefore, 'memory.current'));
  const components = { modelsResidentBytes, modelWarmupExtraBytes, helperBytes: measuredBound(helper), witnessBytes: measuredBound(witness), probeBytes: measuredBound(probe), hotWorkspaceBytes,
    coldTasks: Math.max(cold.owner.pidsPeak + helper.owner.pidsPeak + witness.owner.pidsPeak + probe.owner.pidsPeak, wire.owner.pidsPeak),
    hotAdditionalTasks: Math.max(0, counter(afterHot, 'pids.peak') - counter(beforeHot, 'pids.current'), counter(wireAfter, 'pids.peak') - counter(wireBefore, 'pids.current')) + witness.owner.pidsPeak + probe.owner.pidsPeak,
    witnessTasks: witness.owner.pidsPeak + probe.owner.pidsPeak };
  if (!Object.values(components).every(positive)) fail('MEASURED_COMPONENT_ZERO_OR_MISSING_NO_APPROVAL');
  const cpu = measured => { const value = Math.ceil(measured.owner.cpuQuotaUsec * 1000 / measured.owner.cpuPeriodUsec); if (!positive(value)) fail('ACTUAL_CPU_ENVELOPE_REQUIRED'); return value; };
  const artifacts = json(r.modelArtifactsPath), assets = artifacts.value.assets.map(({ role, file, sha256, bytes }) => ({ role, file, sha256, bytes }));
  const qualifiedAt = Date.now(), expiresAt = qualifiedAt + r.approvalLifetimeMs;
  const plan = { version: 1, profileDigest: profile.profileDigest, codeBundleDigest: r.bindings.codeBundleDigest, helperSha256: r.bindings.helperSha256,
    witnessSha256: r.bindings.witnessSha256, modelManifestSha256: r.bindings.modelManifestSha256,
    modelSetDigest: hash(canonical(assets.map(({ role, file, sha256 }) => ({ role, file, sha256 })).sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0))),
    assets, workerAddressSpaceBytes: profile.value.memoryBytes, cpuThreads: profile.settings.cpu_threads, components,
    stages: { cold: { additionalBytes: components.modelsResidentBytes + components.modelWarmupExtraBytes + components.helperBytes + components.witnessBytes + components.probeBytes, additionalTasks: components.coldTasks, cpuMilli: cpu(cold) },
      hot: { additionalBytes: components.hotWorkspaceBytes + components.witnessBytes + components.probeBytes, additionalTasks: components.hotAdditionalTasks, cpuMilli: cpu(wire) },
      witness: { additionalBytes: components.witnessBytes + components.probeBytes, additionalTasks: components.witnessTasks, cpuMilli: cpu(witness) } },
    qualifiedAt, expiresAt, retirementExpiresAt: expiresAt + r.maxWitnessLifetimeMs, maxLifetimeMs: r.maxLifetimeMs, maxWitnessLifetimeMs: r.maxWitnessLifetimeMs,
    qualificationDigest: hash(canonical({ review: review.sha256, dependencyClosure: closure.sha256, coreWire: wireAuthority.sha256,
      projectionSchema: "root-cpu-configuration-v1", configuration: r.bindings, kernelEnvironment: r.kernelEnvironment,
      cases: [cold, helper, witness, probe, wire].map(e => ({ receipt: e.sha256, grant: e.projection.rawGrantSha256, decoder: e.projection.decoder, projection: e.projection.projectionSha256, stdout: e.stdoutSha256, stderr: e.stderrSha256 })) })) };
  const { readResourceApproval, verifyModelSet } = await import(pathToFileURL(resourceModule));
  // Validate actual sealed assets BEFORE emitting private approval. The review
  // authority is Root; digest syntax alone is never represented as execution.
  verifyModelSet(profile, plan, Date.now() + 60000);
  if (existsSync(outputPath)) fail('EXISTING_APPROVAL_NOT_OVERWRITTEN');
  const candidate = resolve(dirname(outputPath), '.qualification-candidate-' + randomUUID() + '.json');
  writeFileSync(candidate, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  // Invalid candidates remain small unique failure evidence, outside the mounted
  // authority path. No automatic unlink or retry through another path.
  readResourceApproval(candidate, profile);
  if (existsSync(outputPath)) fail('EXISTING_APPROVAL_NOT_OVERWRITTEN');
  // Exclusive final creation cannot overwrite a concurrent existing authority.
  // An interrupted partial file fails the normal strict decoder; never patch or
  // overwrite it. Root reconciles the candidate after its final review consumer.
  writeFileSync(outputPath, readFileSync(candidate), { flag: 'wx', mode: 0o600 });
  readResourceApproval(outputPath, profile);
  return { outputPath, candidate, qualificationDigest: plan.qualificationDigest };
}
