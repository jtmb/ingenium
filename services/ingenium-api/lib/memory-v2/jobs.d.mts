import type { MemoryLifecycle, MemoryScope, MemoryReceipt, Admission, SourceRef } from './lifecycle.mjs';
export function runMemoryExtraction(adapters: {
  memory: MemoryLifecycle; scope: MemoryScope; chatId: string; operationId: string; sourceRefs: SourceRef[]; model: string;
  leaseValid: () => boolean; quota: (model: string) => "available" | "exhausted" | "unknown";
  extract: (input: { scope: MemoryScope; admission: Admission; model: string; maxOutputBytes: number }) => Promise<string>;
  minimize: (candidate: string, context: { scope: MemoryScope; admission: Admission }) => Promise<string>;
}): Promise<{ status: "committed"; receipt: MemoryReceipt; idempotent: boolean } | { status: "reconciled"; receipt: MemoryReceipt } | { status: "deferred"; reason: "quota-exhausted" | "quota-unknown" }>;
