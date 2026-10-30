export type Schedule =
  | { kind: "once"; at: string }
  | { kind: "interval"; anchor: string; minutes: number }
  | { kind: "calendar"; timeZone: string; hour: number; minute: number; weekdays?: number[]; fold: "earlier" | "later" | "both" };
export type MissedPolicy = "skip" | "latest" | "all";

export interface DotScope {
  organizationId: string;
  ownerUserId: string;
  projectId: string | null;
  executionBindingId: string;
  executionBindingFingerprint: string;
  conversationId: string | null;
}
export interface Actor { id: string; organizationId: string }
export type DotAction = "read" | "suggest" | "approve" | "cancel" | "notify" | "dispatch";
export interface Authorization {
  require(actor: Actor, scope: DotScope, action: DotAction, capabilities: readonly string[]): void;
  requireSource(actor: Actor, scope: DotScope, source: Suggestion["source"]): void;
  canReadMemory(actor: Actor, scope: DotScope): boolean;
}
export interface Suggestion {
  id: string; revision: number; scope: DotScope; title: string; prompt: string;
  source: { kind: "user" | "event" | "memory"; reference: string };
  capabilities: string[]; state: "proposed" | "dismissed" | "approved";
  createdAt: string; expiresAt: string;
}
export interface Followup {
  id: string; revision: number; suggestionId: string; scope: DotScope;
  jobId: string; jobRevision: number; scheduleRevision: number;
  schedule: Schedule; missedPolicy: MissedPolicy; cursor: string;
  state: "active" | "paused" | "cancelled"; notificationPolicy: "meaningful" | "failures" | "silent";
  capabilities: string[];
}
export interface OriginalManagedDispatch {
  protocol:"core126-original-v1"|"core126-candidate-original-v1";fence:"not-admitted-v1"|"core-owner-admitted-v1"|"closed-unadmitted-v1";runIdentityHash:string;
}
export interface Operation {
  managedDispatch?:OriginalManagedDispatch;
  id: string; revision: number; followupId: string; scope: DotScope; scheduledFor: string;
  state: "claimed" | "running" | "success" | "failed" | "cancel_requested" | "cancelled" | "unknown" | "skipped" | "blocked";
  runId: string | null; code: string | null; updatedAt: string;
}
export interface Notification {
  id: string; revision: number; operationId: string; scope: DotScope; title: string; read: boolean; createdAt: string;
}
export interface DotSnapshot {
  suggestions: Suggestion[]; followups: Followup[]; operations: Operation[]; notifications: Notification[];
  nextCursors: Partial<Record<"suggestions"|"followups"|"operations"|"notifications"|"queue", string | null>>;
  queue: { id: string; state: string; projectId: string }[];
}
