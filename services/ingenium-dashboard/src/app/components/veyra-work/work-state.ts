export interface WorkIdentity {
  instanceId: string;
  ownerId: string;
  organizationId: string;
  projectId: string | null;
  runtimeId: string;
  workspaceId: string;
  sessionId: string | null;
}

export interface WorkDraft {
  text: string;
  attachments: Array<{ id: string; name: string; mime: string; url: string }>;
  skillIds: string[];
  providerId: string;
  modelId: string;
  variant: string;
}

export function workDraftKey(identity: WorkIdentity): string {
  return JSON.stringify([identity.instanceId, identity.ownerId, identity.organizationId, identity.projectId,
    identity.runtimeId, identity.workspaceId, identity.sessionId]);
}

export function emptyWorkDraft(): WorkDraft {
  return { text: "", attachments: [], skillIds: [], providerId: "", modelId: "", variant: "" };
}

export function initialWorkDraft(sessionId: string | null,
  nativeModel: { id: string; providerID: string; variant?: string } | undefined,
  defaults: { providerId: string; modelId: string; variant?: string } | null,
): WorkDraft {
  const draft = emptyWorkDraft();
  if (sessionId !== null) {
    if (nativeModel) Object.assign(draft, { providerId: nativeModel.providerID, modelId: nativeModel.id, variant: nativeModel.variant ?? "" });
  } else if (defaults) Object.assign(draft, { ...defaults, variant: defaults.variant ?? "" });
  return draft;
}

export function canSendWork({ ready, pending, draft }: { ready: boolean; pending: boolean; draft: WorkDraft }): boolean {
  return ready && !pending && Boolean(draft.providerId && draft.modelId)
    && Boolean(draft.text.trim() || draft.attachments.length);
}

export function workAttachmentError(existing: number, files: Array<{ size: number; type: string }>): string | null {
  if (existing + files.length > 5) return "Attach up to five files per message.";
  if (files.some((file) => file.size > 10 * 1024 * 1024)) return "Each attachment must be 10 MiB or smaller.";
  const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf", "text/plain", "text/markdown"];
  if (files.some((file) => !allowed.includes(file.type))) return "Choose PNG, JPEG, WebP, GIF, PDF, plain text or Markdown files.";
  return null;
}

export const workFeatures = [
  { label: "Tasks", href: "/tasks", description: "Track work and its status" },
  { label: "Files and editor", href: "/vscode", description: "Browse, search and edit workspace files" },
  { label: "Terminal", href: "/opencode?mode=cli", description: "Open the authorized workspace terminal" },
  { label: "Documents", href: "/docs", description: "Read and edit project documentation" },
  { label: "Plugins", href: "/plugins", description: "Manage integrations and capabilities" },
  { label: "Skills", href: "/skills", description: "Inspect reusable instructions" },
  { label: "Agents", href: "/agents", description: "Inspect available agent profiles" },
  { label: "Memory and context", href: "/context", description: "Inspect saved context and provenance" },
  { label: "Jobs", href: "/jobs", description: "Inspect queued operations and outcomes" },
  { label: "Settings", href: "/settings", description: "Configure Veyra" },
] as const;
