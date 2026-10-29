"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useRuntime } from "@/lib/RuntimeContext";
import { useAuth } from "@/lib/AuthContext";
import { useOrganization } from "@/lib/OrganizationContext";
import { useProject } from "@/lib/ProjectContext";
import { useOpenCodeSessions } from "@/lib/use-opencode-sessions";
import { useOpenCodeChat } from "@/lib/use-opencode-chat";
import type { ChatConfigResponse } from "@/lib/api";
import RuntimeWorkspacePicker from "../RuntimeWorkspacePicker";
import OpenCodeFrame from "../OpenCodeFrame";
import ChatMessages from "../../chat/components/ChatMessages";
import ActivityDrawer from "../../chat/components/ActivityDrawer";
import type { ActivitySelection } from "../../chat/components/chat-activity";
import WorkShell from "./WorkShell";
import WorkComposer from "./WorkComposer";
import { canSendWork, initialWorkDraft, workAttachmentError, workDraftKey, type WorkDraft } from "./work-state";

function readAttachment(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Attachment could not be read."));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was interrupted.`));
    reader.readAsDataURL(file);
  });
}

export default function WorkRuntime({ initialSessionId, requestedRuntime, requestedProject }: {
  initialSessionId: string | null; requestedRuntime: string | null; requestedProject: string | null;
}) {
  const runtime = useRuntime();
  const project = useProject();
  if (!runtime.client) return <RuntimeWorkspacePicker controller={runtime.workspace} product="Veyra Work" />;
  if ((requestedRuntime !== null && requestedRuntime !== (runtime.runtimeId ?? "compatibility"))
    || (requestedProject !== null && requestedProject !== (runtime.projectName ?? project))) {
    return <div><p role="alert">This conversation belongs to another workspace. Select its project and runtime before opening it.</p>
      <RuntimeWorkspacePicker controller={runtime.workspace} product="Veyra Work" /></div>;
  }
  return <BoundWorkRuntime key={JSON.stringify([runtime.runtimeId, runtime.projectName, runtime.workspace.confirmedWorkspaceId])}
    initialSessionId={initialSessionId} />;
}

function BoundWorkRuntime({ initialSessionId }: { initialSessionId: string | null }) {
  const runtime = useRuntime();
  const { user } = useAuth();
  const organization = useOrganization();
  const project = useProject();
  const router = useRouter();
  const params = useSearchParams();
  const sessions = useOpenCodeSessions({ initialSelection: "none" });
  const active = sessions.sessions.find((session) => session.id === initialSessionId);
  const activeId = active?.id ?? null;
  const chat = useOpenCodeChat(activeId, activeId ? {
    project: runtime.projectName ?? project, runtimeId: runtime.runtimeId, title: active?.title ?? "New conversation",
  } : undefined);
  const [config, setConfig] = useState<ChatConfigResponse | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, WorkDraft>>({});
  const [pending, setPending] = useState(false);
  const [navigationPending, startNavigation] = useTransition();
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  const sendLock = useRef(false);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [diff, setDiff] = useState<{ sessionId: string; text: string } | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffPending, setDiffPending] = useState(false);
  const [activity, setActivity] = useState<{ sessionId: string; selection: ActivitySelection } | null>(null);
  const identity = { instanceId: "authenticated-dashboard", ownerId: user.id, organizationId: organization.active?.id ?? "unresolved", projectId: runtime.projectName ?? project,
    runtimeId: runtime.runtimeId ?? "compatibility", workspaceId: runtime.workspace.confirmedWorkspaceId ?? "", sessionId: initialSessionId };
  const draftKey = workDraftKey(identity);
  const defaultDraft = initialWorkDraft(initialSessionId, active?.model, config?.defaultSelection ?? null);
  const draft = drafts[draftKey] ?? defaultDraft;
  const models = config?.providers.flatMap((provider) => provider.models.map((model) => ({
    providerId: provider.providerId, modelId: model.id, label: `${provider.label} / ${model.label}`,
  }))) ?? [];
  const modelAvailable = models.some((model) => model.providerId === draft.providerId && model.modelId === draft.modelId);

  useEffect(() => {
    let current = true;
    runtime.client!.chat.config().then((value) => { if (current) setConfig(value); })
      .catch((error: unknown) => { if (current) setConfigError(error instanceof Error ? error.message : "Model configuration unavailable"); });
    return () => { current = false; };
  }, [runtime.client]);

  const select = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("session", id); next.set("runtime", identity.runtimeId); next.set("project", identity.projectId);
    startNavigation(() => router.push(`/work?${next.toString()}`, { scroll: false }));
  };
  const create = async () => {
    if (sendLock.current || sessions.isCreating || navigationPending) return;
    const originalKey = draftKey;
    const original = draft;
    sendLock.current = true; setPending(true);
    try {
      const id = await sessions.create("New conversation");
      if (id) {
        if (initialSessionId === null) {
          const nextKey = workDraftKey({ ...identity, sessionId: id });
          setDrafts((current) => {
            const next = { ...current, [nextKey]: original };
            delete next[originalKey];
            return next;
          });
        }
        select(id);
      }
    } finally { sendLock.current = false; setPending(false); }
  };
  const send = async () => {
    if (sendLock.current || !modelAvailable || !canSendWork({ ready: chat.sessionReady, pending: pending || navigationPending || chat.isStreaming, draft })) return;
    sendLock.current = true;
    setPending(true);
    const original = draft;
    const originalKey = draftKey;
    try {
      const accepted = await chat.send([
        ...(original.text.trim() ? [{ type: "text" as const, text: original.text }] : []),
        ...original.attachments.map((item) => ({ type: "file" as const, mime: item.mime, url: item.url, filename: item.name })),
      ], { model: { providerID: original.providerId, modelID: original.modelId }, ...(original.variant ? { variant: original.variant } : {}) });
      if (accepted) {
        setDrafts((current) => ({ ...current, [originalKey]: { ...original, text: "", attachments: [] } }));
        setUnconfirmed((current) => current === originalKey ? null : current);
      } else setUnconfirmed(originalKey);
    } finally { sendLock.current = false; setPending(false); }
  };
  const attach = async (files: File[]) => {
    if (!files.length || sendLock.current || pending || navigationPending || chat.isStreaming) return;
    const error = workAttachmentError(draft.attachments.length, files);
    setAttachmentError(error);
    if (error) return;
    const original = draft;
    const originalKey = draftKey;
    sendLock.current = true; setPending(true);
    try {
      const attachments = await Promise.all(files.map(async (file) => ({ id: crypto.randomUUID(), name: file.name, mime: file.type, url: await readAttachment(file) })));
      setDrafts((current) => ({ ...current, [originalKey]: { ...original, attachments: [...original.attachments, ...attachments] } }));
    } catch (failure: unknown) { setAttachmentError(failure instanceof Error ? failure.message : "Attachments could not be read."); }
    finally { sendLock.current = false; setPending(false); }
  };
  const loadDiff = async () => {
    const sessionId = activeId;
    if (!sessionId || diffPending) return;
    setReview(true); setDiffPending(true); setDiffError(null);
    try {
      const value = await runtime.client!.sessions.diff(sessionId);
      setDiff({ sessionId, text: JSON.stringify(value, null, 2) });
    } catch (error: unknown) { setDiffError(error instanceof Error ? error.message : "Changes unavailable"); }
    finally { setDiffPending(false); }
  };
  const conversations = sessions.sessions.map((session) => ({ id: session.id, title: session.title }));
  return <WorkShell projectLabel={runtime.projectName ?? project} projects={[{ id: identity.projectId, label: identity.projectId, conversations }]}
    conversations={conversations} activeId={activeId} onSelect={select} onNew={() => { void create(); }}
    newPending={sessions.isCreating || sessions.isLoading || navigationPending}
    tools={<button type="button" disabled={!activeId || diffPending} onClick={() => { void loadDiff(); }} className="rounded border border-white/10 px-3 py-1 text-xs disabled:opacity-40">Review changes</button>}
    status={<div aria-live="polite" className="px-4 text-xs text-neutral-400">
      {sessions.isLoading && <p>Loading conversations…</p>}
      {navigationPending && <p>Opening the selected conversation…</p>}
      {!sessions.isLoading && initialSessionId && !active && <p role="alert">The requested conversation is unavailable in this workspace.</p>}
      {(sessions.error || configError) && <p role="alert">{sessions.error ?? configError}</p>}
      {attachmentError && <p role="alert">{attachmentError}</p>}
      {unconfirmed === draftKey && <p role="alert">This submission was not confirmed. Inspect the conversation history before sending again. Veyra has retained the original and will not resend automatically.</p>}
      {!config && !configError && <p>Loading model configuration…</p>}
      {config && !modelAvailable && <p>Select an available model before sending. Saved defaults have not been changed.</p>}
    </div>}
    web={<><p className="border-b border-white/10 px-4 py-2 text-xs text-neutral-400">
      Upstream OpenCode Web. Select the same conversation there{active ? `: ${active.title} (${active.id})` : "."}
      . Automatic session linking is awaiting protocol verification. Your Work draft and selection are retained.
    </p><div className="relative min-h-0 flex-1"><OpenCodeFrame mode="web" cliMounted={false} /></div></>}
    composer={<><input ref={attachmentInput} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown" className="hidden" aria-label="Choose Work attachments"
      onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void attach(files); }} />
    <WorkComposer key={draftKey} draft={draft} onChange={(value) => setDrafts((current) => ({ ...current, [draftKey]: value }))}
      onAttach={() => attachmentInput.current?.click()}
      onSend={() => { void send(); }} onStop={() => { void chat.stop(); }} models={models}
      ready={chat.sessionReady && modelAvailable} pending={pending || navigationPending} streaming={chat.isStreaming}
      projectControl={<span>▱ {runtime.projectName ?? project}</span>}
      environmentControl={<span>{runtime.workspace.mode === "compatibility" ? "Compatibility workspace" : "Isolated runtime"}</span>}
      permissionControl={<span>Runtime permissions</span>} /></>}
  >
    {review && <section aria-label="Conversation changes" className="m-4 rounded-xl border border-white/10 p-4">
      <div className="flex items-center justify-between"><h2 className="text-sm">Conversation changes</h2><button type="button" onClick={() => setReview(false)} aria-label="Close changes">×</button></div>
      {diffPending ? <p role="status">Loading changes…</p> : diffError ? <p role="alert">{diffError}</p>
        : diff?.sessionId === activeId ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{diff.text}</pre> : <p>Select Review changes to load this conversation.</p>}
    </section>}
    {!activeId ? <div className="flex h-full min-h-64 flex-col items-center justify-center gap-5 px-6 text-center">
      <Image src="/veyra-blue.png" alt="" width={48} height={48} />
      <h1 className="text-xl font-medium">What should we build in {runtime.projectName ?? project}?</h1>
      <p className="text-xs text-neutral-400">Choose a conversation or start a new chat.</p>
    </div> : <ChatMessages messages={chat.messages} isLoading={chat.isLoading} isStreaming={chat.isStreaming}
      streamActivity={chat.streamActivity} error={chat.error} permissions={chat.permissions} replyPermission={chat.replyPermission}
      questions={chat.questions} replyQuestion={chat.replyQuestion}
      onActivityOpen={(messageId, partId) => { if (activeId) setActivity({ sessionId: activeId, selection: { messageId, partId } }); }}
      activitySelection={activity?.sessionId === activeId ? activity.selection : null} />}
    <ActivityDrawer isOpen={activity !== null && activity.sessionId === activeId} selection={activity?.sessionId === activeId ? activity.selection : null}
      messages={chat.messages} onClose={() => setActivity(null)} />
  </WorkShell>;
}
