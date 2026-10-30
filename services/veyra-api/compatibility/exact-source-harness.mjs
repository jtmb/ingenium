import os from 'node:os';
import { verifyExactSourceArtifact } from './process-qualification.mjs';
import { qualifyCompatibility } from './compatibility-harness.mjs';
import { compareApiLatency, measureStarts } from './performance-harness.mjs';
import { QualificationError } from './qualification-transport.mjs';

function authorityEvidence(value) {
  if (!value || !/^[a-f0-9]{40}$/.test(value.sourceCommit ?? '')
      || !/^[a-f0-9]{64}$/.test(value.artifactSha256 ?? '')
      || !/^[a-f0-9]{64}$/.test(value.receiptSha256 ?? '')) {
    throw new QualificationError('AUTHORITY_PROVENANCE_REQUIRED');
  }
  return { sourceCommit: value.sourceCommit, artifactSha256: value.artifactSha256,
    receiptSha256: value.receiptSha256, verification: 'coordinator runtime/build evidence; not inferred from HTTP' };
}

/**
 * Root owns the configuration/traffic lease and launch callbacks. This runner never
 * starts an existing service itself, issues credentials, writes a receipt or invokes a shell.
 */
export async function qualifyExactSource({
  artifact, authorityProvenance, authorityOrigin, credentials, withEdge, evidenceClass,
  latency = null, startupSubjects = [],
}) {
  if (!['fixture', 'platform'].includes(evidenceClass)) throw new QualificationError('EVIDENCE_CLASS_REQUIRED');
  const authority = authorityEvidence(authorityProvenance);
  const identity = await verifyExactSourceArtifact(artifact);
  if (!Array.isArray(startupSubjects) || startupSubjects.length > 2
      || startupSubjects.some(item => !['authority', 'edge'].includes(item.name))
      || new Set(startupSubjects.map(item => item.name)).size !== startupSubjects.length) {
    throw new QualificationError('INVALID_STARTUP_SUBJECTS');
  }
  const lifecycle = [];
  const launchEdge = async (origin, exercise) => {
    const owned = await withEdge(origin, exercise);
    if (!owned?.ok || !owned.cleanup?.closed || owned.artifactSha256 !== identity.binarySha256
        || (identity.scriptSha256 && owned.scriptSha256 !== identity.scriptSha256)) {
      throw new QualificationError('EDGE_PROCESS_BINDING_OR_CLEANUP_FAILED');
    }
    lifecycle.push({ pid: owned.cleanup.pid, closed: owned.cleanup.closed,
      exitCode: owned.cleanup.exitCode, signal: owned.cleanup.signal });
  };
  const compatibility = await qualifyCompatibility({ authorityOrigin, credentials, withEdge: launchEdge });
  let apiLatency = null;
  if (latency && compatibility.accepted) {
    await launchEdge(authorityOrigin, async (edgeOrigin, signal) => {
      apiLatency = await compareApiLatency({ ...latency, authorityOrigin, edgeOrigin,
        headers: credentials.session, signal });
      return apiLatency;
    });
  }
  const starts = [];
  if (compatibility.accepted) {
    for (const subject of startupSubjects) {
      const verifiedSubject = await verifyExactSourceArtifact(subject.artifact);
      const result = await measureStarts({ ...subject.options,
        launch: callback => subject.options.launch(callback).then(owned => {
          if (owned.artifactSha256 !== verifiedSubject.binarySha256
              || (verifiedSubject.scriptSha256 && owned.scriptSha256 !== verifiedSubject.scriptSha256)) {
            throw new QualificationError('STARTUP_PROCESS_BINDING_FAILED');
          }
          return owned;
        }),
      });
      await verifyExactSourceArtifact(subject.artifact);
      starts.push({ subject: subject.name, identity: verifiedSubject, result });
      if (!result.accepted) break;
    }
  }
  await verifyExactSourceArtifact(artifact);
  const coverage = { compatibility: compatibility.accepted, apiLatency: apiLatency?.accepted === true,
    authorityStartup: starts.some(item => item.subject === 'authority' && item.result.accepted),
    edgeStartup: starts.some(item => item.subject === 'edge' && item.result.accepted) };
  return { schemaVersion: 1, kind: 'source-bound-qualification', evidenceClass, identity, authority,
    environment: { platform: process.platform, architecture: process.arch, osRelease: os.release(),
      harnessNode: process.version, clock: 'monotonic-performance.now' },
    coverage, allRequiredMeasurementsPassed: Object.values(coverage).every(Boolean),
    compatibility, apiLatency, starts, lifecycle };
}
