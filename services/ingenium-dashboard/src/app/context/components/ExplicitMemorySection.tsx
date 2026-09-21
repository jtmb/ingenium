"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ExplicitMemory, type ExplicitMemoryReceipt } from "@/lib/api";
import { newExplicitMemoryOperationId } from "@/lib/explicit-memory";

type UpdateInput = {
  operationId: string;
  workspaceId: string;
  expectedVersion: number;
  content: string;
  tags: string[];
};

type ForgetInput = {
  operationId: string;
  workspaceId: string;
  expectedVersion: number;
};

type MemoryAction = {
  status: "updated" | "forgotten" | "failed";
  message: string;
} | {
  status: "queued";
  message: string;
  checkedUnknown: boolean;
  memoryId: string;
  request: { operation: "update"; input: UpdateInput } | { operation: "forget"; input: ForgetInput };
};

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function mutationMessage(error: unknown, action: "updated" | "forgotten", fallback: string): string {
  if (typeof error === "object" && error !== null && "status" in error && error.status === 409) {
    return `Memory changed before it could be ${action}. Refresh saved memory and try again.`;
  }
  return message(error, fallback);
}

export default function ExplicitMemorySection({ project, workspaceId }: { project: string; workspaceId: string | null }) {
  const [memories, setMemories] = useState<ExplicitMemory[]>([]);
  const [loading, setLoading] = useState(Boolean(workspaceId));
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirmForgetId, setConfirmForgetId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [action, setAction] = useState<MemoryAction | null>(null);
  const savedMemoryTitleRef = useRef<HTMLHeadingElement>(null);
  const memoryActionRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusAfterForgetRef = useRef<string | null | undefined>(undefined);

  const load = useCallback(async () => {
    if (!workspaceId) {
      setMemories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setMemories((await api.memory.list(project, workspaceId)).data.items.map((item) => item.memory));
    } catch (failure) {
      setError(message(failure, "Unable to load saved memory."));
    } finally {
      setLoading(false);
    }
  }, [project, workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  useEffect(() => {
    const focusTarget = focusAfterForgetRef.current;
    if (focusTarget === undefined) return;
    (focusTarget ? memoryActionRefs.current.get(focusTarget) : savedMemoryTitleRef.current)?.focus();
    focusAfterForgetRef.current = undefined;
  }, [action, memories]);

  const queueFocusAfterForget = (memoryId: string) => {
    const forgottenIndex = memories.findIndex((memory) => memory.id === memoryId);
    focusAfterForgetRef.current = forgottenIndex < 0 ? null : memories[forgottenIndex + 1]?.id ?? null;
  };

  const startEditing = (memory: ExplicitMemory) => {
    setConfirmForgetId(null);
    setEditingId(memory.id);
    setDraft(memory.content);
    setAction(null);
  };

  const update = async (memory: ExplicitMemory) => {
    if (!workspaceId || !draft.trim() || pendingId) return;
    setPendingId(memory.id);
    setAction(null);
    try {
      const input: UpdateInput = {
        operationId: newExplicitMemoryOperationId(),
        workspaceId,
        expectedVersion: memory.version,
        content: draft.trim(),
        tags: memory.tags,
      };
      const result = await api.memory.update(project, memory.id, input);
      if ("status" in result.data) {
        setAction({
          status: "queued",
          message: `Update outcome is pending (${input.operationId}). Check its status before retrying.`,
          checkedUnknown: false,
          memoryId: memory.id,
          request: { operation: "update", input },
        });
        return;
      }
      const updatedMemory = result.data.memory;
      if (updatedMemory) {
        setMemories((current) => current.map((item) => item.id === memory.id ? updatedMemory : item));
      } else {
        await load();
      }
      setEditingId(null);
      setAction({ status: "updated", message: `Memory updated to version ${result.data.receipt.version}. Receipt ${result.data.receipt.receiptId}.` });
    } catch (failure) {
      setAction({ status: "failed", message: mutationMessage(failure, "updated", "Memory update failed.") });
    } finally {
      setPendingId(null);
    }
  };

  const forget = async (memory: ExplicitMemory) => {
    if (!workspaceId || pendingId) return;
    setPendingId(memory.id);
    setAction(null);
    try {
      const input: ForgetInput = {
        operationId: newExplicitMemoryOperationId(),
        workspaceId,
        expectedVersion: memory.version,
      };
      const result = await api.memory.forget(project, memory.id, input);
      if ("status" in result.data) {
        setAction({
          status: "queued",
          message: `Forget outcome is pending (${input.operationId}). Check its status before retrying.`,
          checkedUnknown: false,
          memoryId: memory.id,
          request: { operation: "forget", input },
        });
        return;
      }
      queueFocusAfterForget(memory.id);
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      setConfirmForgetId(null);
      setEditingId(null);
      setAction({ status: "forgotten", message: `Memory forgotten and excluded from future retrieval. Receipt ${result.data.receipt.receiptId}.` });
    } catch (failure) {
      setAction({ status: "failed", message: mutationMessage(failure, "forgotten", "Memory forget failed.") });
    } finally {
      setPendingId(null);
    }
  };

  const resolveCommitted = async (queued: Extract<MemoryAction, { status: "queued" }>, receipt: ExplicitMemoryReceipt) => {
    if (queued.request.operation === "forget") queueFocusAfterForget(queued.memoryId);
    await load();
    setEditingId(null);
    setConfirmForgetId(null);
    setAction(queued.request.operation === "update"
      ? { status: "updated", message: `Memory updated to version ${receipt.version}. Receipt ${receipt.receiptId}.` }
      : { status: "forgotten", message: `Memory forgotten and excluded from future retrieval. Receipt ${receipt.receiptId}.` });
  };

  const checkStatus = async () => {
    if (action?.status !== "queued" || checkingStatus) return;
    const queued = action;
    setCheckingStatus(true);
    try {
      const result = await api.memory.operationStatus(project, queued.request.input.workspaceId, queued.request.input.operationId);
      if (result.data.status === "committed") {
        await resolveCommitted(queued, result.data.receipt);
      } else {
        setAction({ ...queued, checkedUnknown: true, message: `${queued.request.operation === "update" ? "Update" : "Forget"} outcome is still unknown (${queued.request.input.operationId}). It has not been reported as committed.` });
      }
    } catch {
      setAction({ ...queued, message: `Unable to check ${queued.request.operation} status. The original outcome remains unknown (${queued.request.input.operationId}).` });
    } finally {
      setCheckingStatus(false);
    }
  };

  const replay = async () => {
    if (action?.status !== "queued" || !action.checkedUnknown || pendingId) return;
    const queued = action;
    setPendingId(queued.memoryId);
    try {
      const result = queued.request.operation === "update"
        ? await api.memory.update(project, queued.memoryId, queued.request.input)
        : await api.memory.forget(project, queued.memoryId, queued.request.input);
      if ("status" in result.data) {
        setAction({ ...queued, checkedUnknown: false, message: `${queued.request.operation === "update" ? "Update" : "Forget"} outcome is pending (${queued.request.input.operationId}). Check its status before retrying.` });
      } else {
        await resolveCommitted(queued, result.data.receipt);
      }
    } catch {
      setAction({ ...queued, message: `The identical ${queued.request.operation} could not be replayed. The original outcome remains unknown (${queued.request.input.operationId}).` });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow" aria-labelledby="saved-memory-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 ref={savedMemoryTitleRef} id="saved-memory-title" tabIndex={-1} className="text-lg font-semibold text-[var(--color-text-primary)]">Saved memory</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Inspect, correct, or forget private memories for this project and workspace.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={!workspaceId || loading} className="self-start rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50">
          Refresh
        </button>
      </div>

      {!workspaceId && <p className="mt-4 text-sm text-[var(--color-text-muted)]">Select an authorized workspace to manage saved memory.</p>}
      {loading && <p className="mt-4 text-sm text-[var(--color-text-muted)]" role="status">Loading saved memory…</p>}
      {error && <p className="mt-4 rounded border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-3 text-sm text-[var(--color-error-text)]" role="alert">{error}</p>}
      {action && (
        <div className={`mt-4 rounded border p-3 text-sm ${action.status === "failed" ? "border-[var(--color-error-border)] bg-[var(--color-error-bg)] text-[var(--color-error-text)]" : "border-[var(--color-border)] bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]"}`} role={action.status === "failed" ? "alert" : "status"}>
          <p>{action.message}</p>
          {action.status === "queued" && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => void checkStatus()} disabled={checkingStatus} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-medium text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50">
                {checkingStatus ? "Checking…" : "Check status"}
              </button>
              {action.checkedUnknown && (
                <button type="button" onClick={() => void replay()} disabled={pendingId === action.memoryId} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-medium text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50">
                  Retry identical {action.request.operation}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && !error && workspaceId && memories.length === 0 && (
        <p className="mt-4 text-sm text-[var(--color-text-muted)]">No saved memories in this workspace.</p>
      )}

      {memories.length > 0 && (
        <ul className="mt-4 space-y-3">
          {memories.map((memory) => (
            <li key={memory.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 hover:shadow-md transition-shadow">
              {editingId === memory.id ? (
                <div className="space-y-3">
                  <label htmlFor={`memory-${memory.id}`} className="block text-sm font-medium text-[var(--color-text-primary)]">Memory content</label>
                  <textarea id={`memory-${memory.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} rows={4} maxLength={32_768} className="w-full resize-y rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]" />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void update(memory)} disabled={!draft.trim() || pendingId === memory.id} className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{pendingId === memory.id ? "Updating…" : "Update memory"}</button>
                    <button type="button" onClick={() => setEditingId(null)} disabled={pendingId === memory.id} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-text-primary)]">{memory.content}</p>
                  <p className="mt-2 text-xs text-[var(--color-text-muted)]">Version {memory.version} · Updated {new Date(memory.updatedAt).toLocaleString()}</p>
                  {memory.tags.length > 0 && <p className="mt-1 text-xs text-[var(--color-text-muted)]">Tags: {memory.tags.join(", ")}</p>}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button ref={(element) => { if (element) memoryActionRefs.current.set(memory.id, element); else memoryActionRefs.current.delete(memory.id); }} type="button" onClick={() => startEditing(memory)} disabled={pendingId === memory.id} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50">Edit</button>
                    {confirmForgetId === memory.id ? (
                      <>
                        <button type="button" onClick={() => void forget(memory)} disabled={pendingId === memory.id} className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">{pendingId === memory.id ? "Forgetting…" : "Confirm forget"}</button>
                        <button type="button" onClick={() => setConfirmForgetId(null)} disabled={pendingId === memory.id} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50">Cancel</button>
                      </>
                    ) : (
                      <button type="button" onClick={() => { setEditingId(null); setConfirmForgetId(memory.id); }} disabled={pendingId === memory.id} className="rounded border border-[var(--color-error-border)] bg-[var(--color-surface)] px-3 py-1.5 text-sm text-[var(--color-error-text)] hover:bg-[var(--color-error-bg)] disabled:opacity-50">Forget memory</button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
