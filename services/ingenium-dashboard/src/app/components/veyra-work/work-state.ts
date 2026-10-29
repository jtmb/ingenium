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
  selectionOrigin?: "defaults" | "native" | "explicit";
}

export interface WorkModel { providerId: string; modelId: string; label: string; variants?: string[] }

export function workModels(providers: Array<{ providerId: string; label: string; models: Array<{ id: string; label: string; variants?: Record<string, unknown> }> }>): WorkModel[] {
  return providers.flatMap((provider) => provider.models.map((model) => ({ providerId: provider.providerId, modelId: model.id,
    label: `${provider.label} / ${model.label}`, ...(model.variants ? { variants: Object.keys(model.variants) } : {}) })));
}

export function availableWorkSelection(draft: WorkDraft, models: WorkModel[]): boolean {
  const model = models.find((candidate) => candidate.providerId === draft.providerId && candidate.modelId === draft.modelId);
  return Boolean(model && (!draft.variant || model.variants?.includes(draft.variant)));
}

export function currentWorkDraft(stored: WorkDraft | undefined, seeded: WorkDraft, sessionId: string | null): WorkDraft {
  if (!stored) return seeded;
  if (sessionId !== null || stored.selectionOrigin === "explicit") return stored;
  return { ...stored, providerId: seeded.providerId, modelId: seeded.modelId, variant: seeded.variant, selectionOrigin: "defaults" };
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
    if (nativeModel) Object.assign(draft, { providerId: nativeModel.providerID, modelId: nativeModel.id, variant: nativeModel.variant ?? "", selectionOrigin: "native" });
  } else if (defaults) Object.assign(draft, { ...defaults, variant: defaults.variant ?? "", selectionOrigin: "defaults" });
  return draft;
}

export function newWorkDraft(defaults: { providerId: string; modelId: string; variant?: string } | null, models: WorkModel[]): { draft: WorkDraft; unsupportedVariant: string | null } {
  const draft = initialWorkDraft(null, undefined, defaults);
  const unsupportedVariant = draft.variant && !models.find((model) => model.providerId === draft.providerId && model.modelId === draft.modelId)?.variants?.includes(draft.variant)
    ? draft.variant : null;
  if (unsupportedVariant) draft.variant = "";
  return { draft, unsupportedVariant };
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

export interface WorkFeature { label: string; href: string; description: string; adminOnly?: boolean }
export const workFeatures: readonly WorkFeature[] = [
  { label: "Chat", href: "/chat", description: "Open ordinary Chat" },
  { label: "Tasks", href: "/tasks", description: "Track work and its status" },
  { label: "Files and editor", href: "/vscode", description: "Browse, search and edit workspace files" },
  { label: "Terminal", href: "/opencode?mode=cli", description: "Open the authorized workspace terminal" },
  { label: "Documents", href: "/docs", description: "Read and edit project documentation" },
  { label: "Mail", href: "/mail", description: "Open the existing mail workspace" },
  { label: "Plugins", href: "/customize/plugins", description: "Manage integrations and capabilities" },
  { label: "Skills", href: "/skills", description: "Inspect reusable instructions" },
  { label: "Agents", href: "/agents", description: "Inspect available agent profiles" },
  { label: "Memory and context", href: "/context", description: "Inspect saved context and provenance" },
  { label: "Jobs", href: "/jobs", description: "Inspect queued operations and outcomes" },
  { label: "Projects", href: "/projects", description: "Inspect the project catalog" },
  { label: "Organizations", href: "/organizations", description: "Inspect organization membership" },
  { label: "Observations", href: "/observations", description: "Inspect observed evidence" },
  { label: "Personality", href: "/personality", description: "Inspect personality configuration" },
  { label: "Pipeline", href: "/pipeline", description: "Inspect learning and synthesis pipelines" },
  { label: "MCP Servers", href: "/mcp-servers", description: "Inspect server status and tool configuration" },
  { label: "Usage", href: "/usage", description: "Inspect reported usage" },
  { label: "Secrets", href: "/secrets", description: "Open authorized credential management" },
  { label: "Account", href: "/account", description: "Inspect the current account" },
  { label: "Backups", href: "/backups", description: "Inspect backup and recovery operations", adminOnly: true },
  { label: "Logs", href: "/logs", description: "Inspect installation logs", adminOnly: true },
  { label: "Status", href: "/status", description: "Inspect installation health", adminOnly: true },
  { label: "Config", href: "/config", description: "Inspect installation configuration", adminOnly: true },
  { label: "Settings", href: "/settings", description: "Configure Veyra" },
] as const;

export function visibleWorkFeatures(installationAdmin: boolean): readonly WorkFeature[] {
  return workFeatures.filter((feature) => !feature.adminOnly || installationAdmin);
}
