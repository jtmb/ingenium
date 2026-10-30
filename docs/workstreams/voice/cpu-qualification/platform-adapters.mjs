import { runEnvelope } from './run-envelope.mjs';
/** Actual Linux adapter delegates to the original root-owned kernel constructor.
 * Neither importing nor selecting an adapter starts a process. */
export function qualificationAdapter(platform) {
  if (platform === 'linux') return Object.freeze({ runEnvelope, productionApprovalFormat: 'linux-cgroup-v2-v1' });
  if (platform === 'win32') throw new Error('QUAL_WINDOWS_NATIVE_ORIGINAL_JOB_ACCOUNTING_AND_INTERPRETER_UNQUALIFIED');
  throw new Error('QUAL_PLATFORM_UNSUPPORTED');
}
export const windowsPrerequisites = Object.freeze([
  'Actual qualified native Windows CPython3.12.13 and pinned Windows wheel closure; no WSL ELF fallback',
  'Existing Native CPU Original/OwnedProcessJob constructor, suspended creation and assignment before resume, no breakaway and actual aggregate memory/CPU/active-task limits',
  'Retained actual process/thread/job handles and positive process wait plus job-empty and pipe/witness joins; no PID/name/health/timeout proof',
  'Actual Native QueryInformationJobObject accounting and process RSS/commit measurements with their own declared basis; do not relabel Linux cgroup memory as Windows memory',
  'Original Windows resource approval adapter/schema reviewed by Root; Linux approval must not be emitted for Windows',
]);
