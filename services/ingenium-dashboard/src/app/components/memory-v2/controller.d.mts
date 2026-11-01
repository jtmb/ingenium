import type { MemoryControlsState, MemoryControlChange } from './MemoryControls';
export interface MemoryBinding { scopeKey: string; scopeHash: string; chatId: string; bindingHash: string; bindingEpoch: number }
export interface PendingMemoryChange { identity: MemoryBinding; operationId: string; change: MemoryControlChange }
export interface PolicyReceipt { status: "committed"; operationId: string; scopeHash: string; operation: "policy" | "chat-policy"; revision: number }
export interface MemoryControllerPorts {
  api: {
    /** Original HTTP owner only: this error happened before its write dispatch. */
    rejectedBeforeDispatch?: (error: unknown) => boolean;
    read: (binding: MemoryBinding) => Promise<{ scopeHash: string; chatId: string; bindingHash: string; bindingEpoch: number; available: boolean; canChange: boolean; policy: MemoryControlsState['policy']; chat: MemoryControlsState['chat'] }>;
    change: (pending: PendingMemoryChange) => Promise<{ receipt: PolicyReceipt }>;
    operation: (binding: MemoryBinding, operationId: string) => Promise<PolicyReceipt | null>;
  };
  journal: {
    get: (scopeHash: string) => PendingMemoryChange | undefined | Promise<PendingMemoryChange | undefined>;
    set: (scopeHash: string, pending: PendingMemoryChange) => void | Promise<void>;
    remove: (scopeHash: string, expectedOperationId: string) => void | Promise<void>;
  };
  newOperationId?: () => string;
}
export function createMemoryController(ports: MemoryControllerPorts): Readonly<{
  getSnapshot: () => Readonly<MemoryControlsState>;
  subscribe: (listener: () => void) => () => void;
  activate: (binding: MemoryBinding) => Promise<void>;
  change: (scopeKey: string, chatId: string, change: MemoryControlChange) => Promise<boolean>;
  reconcile: (operationId: string) => Promise<boolean>;
  dispose: () => void;
}>;
