import type { MemoryScope, SourceState, SqlConnection } from './lifecycle.mjs';
import type { AuthenticatedExecution } from './adapters.mjs';
export interface ApprovedMemoryEligibilityPolicy {
  version: 'codex-memory-source-v1'; minRolloutIdleHours: number; scope: MemoryScope; runtimeId: string;
  admission?: { chatId: string; conversationId: string; state: 'settled' | 'pending' | 'unknown'; revision: number; contextRevision: number };
}
export const CODEX_MEMORY_IDLE_POLICY: Readonly<{ version: 'codex-memory-source-v1'; defaultHours: 6; minHours: 1; maxHours: 48; provenance: readonly string[] }>;
export function eligibilityFingerprint(policy: ApprovedMemoryEligibilityPolicy | null, scope: MemoryScope, execution: AuthenticatedExecution): string | null;
export function contextMemorySourceState(input: { db: SqlConnection; scope: MemoryScope; execution: AuthenticatedExecution; chatId: string;
  messageId: string; conversationId: string; contentHash: string; policy?: ApprovedMemoryEligibilityPolicy | null; nowMs?: number;
}): Pick<SourceState,'active' | 'excluded' | 'uncertain' | 'idleEligible' | 'eligibilityVersion'> | null;
