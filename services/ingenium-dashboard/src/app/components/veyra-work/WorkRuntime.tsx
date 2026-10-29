"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRuntime } from "@/lib/RuntimeContext";
import { useAuth } from "@/lib/AuthContext";
import { useOrganization } from "@/lib/OrganizationContext";
import { useProject } from "@/lib/ProjectContext";
import { useOpenCodeSessions } from "@/lib/use-opencode-sessions";
import { useOpenCodeChat } from "@/lib/use-opencode-chat";
import RuntimeWorkspacePicker from "../RuntimeWorkspacePicker";
import WorkWebFrame, { type WorkWebQualification } from "./WorkWebFrame";
import ChatMessages from "../../chat/components/ChatMessages";
import ActivityDrawer from "../../chat/components/ActivityDrawer";
import type { ActivitySelection } from "../../chat/components/chat-activity";
import WorkShell from "./WorkShell";
import WorkComposer from "./WorkComposer";
import WorkChanges from "./WorkChanges";
import WorkArtifacts from "./WorkArtifacts";
import { collectWorkArtifacts } from "./work-artifacts";
import { workSuggestions } from "./work-suggestions";
import { availableWorkSelection, canSendWork, currentWorkDraft, initialWorkDraft, newWorkDraft, workAttachmentError, workDraftKey, workModels, type WorkDraft } from "./work-state";
import { useWorkChatConfig } from "./useWorkChatConfig";
import { workControlBindingMatches, type WorkContextSlots } from "./work-context";
import { workConversationNavigation } from "./work-navigation";

function readAttachment(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Attachment could not be read."));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was interrupted.`));
    reader.readAsDataURL(file);
  });
}

export default function WorkRuntime({ initialSessionId, requestedRuntime, requestedProject, webQualification = null, admissionControl, submissionBlockedReason = null, contextSlots = null, projectPicker, routeError = null }: {
  initialSessionId: string | null; requestedRuntime: string | null; requestedProject: string | null;
  webQualification?: WorkWebQualification | null;
  admissionControl?: ReactNode;
  submissionBlockedReason?: string | null;
  contextSlots?: WorkContextSlots | null;
  projectPicker?: ReactNode;
  routeError?: string | null;
}) {
  const runtime = useRuntime();
  const project = useProject();
  const auth = useAuth();
  const unavailable = (notice?: string) => <WorkShell projectLabel={runtime.projectName ?? project} projects={[]} conversations={[]} activeId={null}
    installationAdmin={auth.installationAdmin}
    onSelect={() => undefined} onNew={() => undefined} newPending composer={null}
    web={<p role="status" className="p-6 text-sm">Connect the selected workspace before opening a Web conversation.</p>}>
    {notice && <p role="alert" className="p-4 text-sm">{notice}</p>}
    {routeError && <Link href="/work" className="m-4 text-sm text-blue-300 underline">Choose a conversation in Work</Link>}
    {submissionBlockedReason && <p role="status" className="p-4 text-sm">{submissionBlockedReason}</p>}{admissionControl}
    {projectPicker}
    <RuntimeWorkspacePicker controller={runtime.workspace} product="Veyra Work" />
  </WorkShell>;
  if (routeError) return unavailable(routeError);
  if (!runtime.client) return unavailable();
  if ((requestedRuntime !== null && requestedRuntime !== (runtime.runtimeId ?? "compatibility"))
    || (requestedProject !== null && requestedProject !== (runtime.projectName ?? project))) {
    return unavailable("This conversation belongs to another workspace. Select its project and runtime before opening it.");
  }
  return <BoundWorkRuntime key={JSON.stringify([runtime.runtimeId, runtime.projectName, runtime.workspace.confirmedWorkspaceId])}
    initialSessionId={initialSessionId} webQualification={webQualification} admissionControl={admissionControl} submissionBlockedReason={submissionBlockedReason}
    contextSlots={contextSlots} projectPicker={projectPicker} />;
}

function BoundWorkRuntime({ initialSessionId, webQualification, admissionControl, submissionBlockedReason, contextSlots, projectPicker }: {
  initialSessionId: string | null; webQualification: WorkWebQualification | null; admissionControl?: ReactNode; submissionBlockedReason: string | null;
  contextSlots: WorkContextSlots | null; projectPicker?: ReactNode;
}) {
  const runtime = useRuntime();
  const { user, installationAdmin } = useAuth();
  const organization = useOrganization();
  const project = useProject();
  const router = useRouter();
  const params = useSearchParams();
  const sessions = useOpenCodeSessions({ initialSelection: "none" });
  const active = sessions.sessions.find((session) => session.id === initialSessionId);
  const activeId = active?.id ?? null;
  const [rehydrate, setRehydrate] = useState(false);
  const chat = useOpenCodeChat(rehydrate ? null : activeId, !rehydrate && activeId ? {
    project: runtime.projectName ?? project, runtimeId: runtime.runtimeId, title: active?.title ?? "New conversation",
  } : undefined);
  useEffect(() => {
    if (!rehydrate) return;
    let current = true;
    // Let the existing controller reset its loaded scope before reopening the
    // same session. Its normal hydration path also recovers native busy state.
    queueMicrotask(() => { if (current) setRehydrate(false); });
    return () => { current = false; };
  }, [rehydrate]);
  const { config, loading: configLoading, error: configError, refresh: refreshConfig } = useWorkChatConfig(runtime.client!);
  const [drafts, setDrafts] = useState<Record<string, WorkDraft>>({});
  const [pending, setPending] = useState(false);
  const [navigationPending, startNavigation] = useTransition();
  const [unconfirmed, setUnconfirmed] = useState<Record<string, string>>({});
  const [creationUnknown, setCreationUnknown] = useState<string | null>(null);
  const sendLock = useRef(false);
  const attachmentInput = useRef<HTMLInputElement>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [review, setReview] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [diff, setDiff] = useState<{ sessionId: string; value: unknown } | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [diffPending, setDiffPending] = useState(false);
  const [activity, setActivity] = useState<{ sessionId: string; selection: ActivitySelection } | null>(null);
  const [presentation, setPresentation] = useState<"work" | "web">("work");
  const identity = { instanceId: "authenticated-dashboard", ownerId: user.id, organizationId: organization.active?.id ?? "unresolved", projectId: runtime.projectName ?? project,
    runtimeId: runtime.runtimeId ?? "compatibility", workspaceId: runtime.workspace.confirmedWorkspaceId ?? "", sessionId: initialSessionId };
  const draftKey = workDraftKey(identity);
  const slotBinding = { ownerId: user.id, organizationId: organization.active?.id ?? null, runtimeId: runtime.runtimeId,
    workspaceId: runtime.workspace.confirmedWorkspaceId, sessionId: activeId };
  const slotSelectionResolved = initialSessionId === null || activeId !== null;
  const slots = slotSelectionResolved && contextSlots && workControlBindingMatches(contextSlots.binding, slotBinding) ? contextSlots : null;
  const models = workModels(config?.providers ?? []);
  const freshDefault = newWorkDraft(config?.defaultSelection ?? null, models);
  const defaultDraft = initialSessionId === null ? freshDefault.draft : initialWorkDraft(initialSessionId, active?.model, null);
  const protectedDraft = pending || Boolean(unconfirmed[draftKey]) || creationUnknown !== null;
  const draft = protectedDraft ? drafts[draftKey] ?? defaultDraft : currentWorkDraft(drafts[draftKey], defaultDraft, initialSessionId);
  const modelAvailable = availableWorkSelection(draft, models);
  const createDraft = initialSessionId === null ? draft : freshDefault.draft;
  const creationAvailable = !submissionBlockedReason && !configLoading && !configError && availableWorkSelection(createDraft, models) && creationUnknown === null;

  useEffect(() => {
    if (!activeId || sessions.isLoading || navigationPending) return;
    const navigation = workConversationNavigation({ search: params.toString(), hash: window.location.hash,
      sessionId: activeId, runtimeId: identity.runtimeId, project: identity.projectId, intent: "canonicalize" });
    if (navigation.action === "replace") router.replace(navigation.href, { scroll: false });
  }, [activeId, identity.projectId, identity.runtimeId, navigationPending, params, router, sessions.isLoading]);

  const select = (id: string) => {
    const navigation = workConversationNavigation({ search: params.toString(), hash: window.location.hash,
      sessionId: id, runtimeId: identity.runtimeId, project: identity.projectId, intent: "select" });
    if (navigation.action === "none") return;
    startNavigation(() => {
      if (navigation.action === "replace") router.replace(navigation.href, { scroll: false });
      else router.push(navigation.href, { scroll: false });
    });
  };
  const create = async () => {
    if (sendLock.current || sessions.isCreating || navigationPending || !creationAvailable) return;
    const originalKey = draftKey;
    const original = createDraft;
    const existingIds = sessions.sessions.map((session) => session.id);
    if (initialSessionId === null) setDrafts((current) => ({ ...current, [originalKey]: original }));
    sendLock.current = true; setPending(true);
    try {
      const id = await sessions.create("New conversation");
      if (id) {
        if (existingIds.includes(id)) {
          setCreationUnknown("Creation returned an existing conversation identity. Its history and your original draft are protected; review native admission before continuing.");
          return;
        }
        const nextKey = workDraftKey({ ...identity, sessionId: id });
        setDrafts((current) => {
          const next = { ...current, [nextKey]: original };
          if (initialSessionId === null) delete next[originalKey];
          return next;
        });
        select(id);
      } else setCreationUnknown("New conversation creation was not confirmed. Review the native admission record before trying again. Your original draft is retained.");
    } catch (error: unknown) {
      setCreationUnknown(error instanceof Error ? `New conversation creation is unconfirmed: ${error.message}` : "New conversation creation is unconfirmed. Its original remains protected.");
    } finally { sendLock.current = false; setPending(false); }
  };
  const send = async () => {
    if (sendLock.current || submissionBlockedReason || protectedDraft || configLoading || configError || !modelAvailable || !canSendWork({ ready: !rehydrate && chat.sessionReady && !chat.error, pending: pending || navigationPending || chat.isStreaming, draft })) return;
    sendLock.current = true;
    setPending(true);
    const original = draft;
    const originalKey = draftKey;
    setDrafts((current) => ({ ...current, [originalKey]: original }));
    try {
      const accepted = await chat.send([
        ...(original.text.trim() ? [{ type: "text" as const, text: original.text }] : []),
        ...original.attachments.map((item) => ({ type: "file" as const, mime: item.mime, url: item.url, filename: item.name })),
      ], { model: { providerID: original.providerId, modelID: original.modelId }, ...(original.variant ? { variant: original.variant } : {}) });
      if (accepted) {
        setDrafts((current) => ({ ...current, [originalKey]: { ...original, text: "", attachments: [] } }));
        setUnconfirmed((current) => { const next = { ...current }; delete next[originalKey]; return next; });
      } else setUnconfirmed((current) => ({ ...current, [originalKey]: current[originalKey] ?? "The runtime did not confirm prompt admission." }));
    } catch (error: unknown) {
      const failure = error instanceof Error ? error.message : "The prompt admission outcome is unknown.";
      setUnconfirmed((current) => ({ ...current, [originalKey]: current[originalKey] ?? failure }));
    } finally { sendLock.current = false; setPending(false); }
  };
  const attach = async (files: File[]) => {
    if (!files.length || protectedDraft || sendLock.current || pending || navigationPending || chat.isStreaming) return;
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
      setDiff({ sessionId, value });
    } catch (error: unknown) { setDiffError(error instanceof Error ? error.message : "Changes unavailable"); }
    finally { setDiffPending(false); }
  };
  const conversations = sessions.sessions.map((session) => ({ id: session.id, title: session.title }));
  const artifacts = collectWorkArtifacts(chat.messages);
  const suggestions = workSuggestions({ hasSession: activeId !== null, hasFiles: artifacts.length > 0,
    hasChanges: diff !== null && diff.sessionId === activeId && Array.isArray(diff.value) && diff.value.length > 0, hasError: Boolean(chat.error) });
  return <WorkShell projectLabel={runtime.projectName ?? project} projects={[{ id: identity.projectId, label: identity.projectId, conversations }]}
    installationAdmin={installationAdmin}
    conversations={conversations} activeId={activeId} onSelect={select} onNew={() => { void create(); }}
    dot={slots?.dot}
    onPresentationChange={(view) => { setPresentation(view); if (view === "work") setRehydrate(true); }}
    newPending={pending || sessions.isCreating || sessions.isLoading || navigationPending || !creationAvailable}
    tools={<><button type="button" disabled={!activeId} onClick={() => setFilesOpen(!filesOpen)} aria-expanded={filesOpen} className="rounded border border-white/10 px-3 py-1 text-xs disabled:opacity-40">Files</button>
      <button type="button" disabled={!activeId || diffPending} onClick={() => { void loadDiff(); }} className="rounded border border-white/10 px-3 py-1 text-xs disabled:opacity-40">Review changes</button>{slots?.tools}</>}
    status={<div aria-live="polite" className="px-4 text-xs text-neutral-400">
      {sessions.isLoading && <p>Loading conversations…</p>}
      {navigationPending && <p>Opening the selected conversation…</p>}
      {!sessions.isLoading && initialSessionId && !active && <p role="alert">The requested conversation is unavailable in this workspace.</p>}
      {(sessions.error || configError) && <p role="alert">{sessions.error ?? configError}</p>}
      {configError && <button type="button" onClick={() => { void refreshConfig(); }} className="my-2 rounded border border-white/10 px-3 py-2">Reload model configuration</button>}
      {creationUnknown && <p role="alert">{creationUnknown}</p>}
      {submissionBlockedReason && <p role="status">{submissionBlockedReason}</p>}{admissionControl}
      {contextSlots && !slots && <p role="status">Waiting for controls for the selected workspace and conversation.</p>}
      {slots?.status}
      {attachmentError && <p role="alert">{attachmentError}</p>}
      {unconfirmed[draftKey] && <p role="alert">This submission was not confirmed: {unconfirmed[draftKey]} Inspect the conversation history before sending again. Veyra has retained the original and will not resend automatically.</p>}
      {configLoading && <p>Loading model configuration…</p>}
      {config && !modelAvailable && <p>Select an available model and supported effort before sending. The exact existing selection is retained; saved defaults have not been changed.</p>}
      {config && !creationAvailable && !configLoading && !configError && !creationUnknown && !submissionBlockedReason && <p>New chats need an available installation default or an explicit new-draft selection. Review the default in Settings General.</p>}
      {freshDefault.unsupportedVariant && initialSessionId === null && draft.selectionOrigin !== "explicit" && <p>Saved default effort {freshDefault.unsupportedVariant} is unavailable. This new conversation will use model-default reasoning; saved settings are unchanged.</p>}
    </div>}
    web={<><p className="border-b border-white/10 px-4 py-2 text-xs text-neutral-400">
      Unchanged upstream OpenCode Web{active ? ` · ${active.title}` : ""}. The selected Work conversation is linked using the pinned 2.0.11 session route.
    </p><WorkWebFrame sessionId={activeId} qualification={webQualification} /></>}
    composer={<>{!draft.text && !protectedDraft && !pending && !navigationPending && !chat.isStreaming && <nav aria-label="Suggested next steps" className="mx-auto flex w-full max-w-[740px] flex-wrap gap-2 px-4 pb-3">
      {suggestions.map((suggestion) => <button key={suggestion.id} type="button" title={suggestion.reason}
        onClick={() => setDrafts((current) => ({ ...current, [draftKey]: { ...draft, text: suggestion.prompt } }))}
        className="rounded-full border border-white/10 px-3 py-2 text-xs text-neutral-400 hover:bg-white/5 focus-visible:outline-blue-400">{suggestion.label}</button>)}
    </nav>}<input ref={attachmentInput} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown" className="hidden" aria-label="Choose Work attachments"
      onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void attach(files); }} />
    <WorkComposer key={draftKey} draft={draft} onChange={(value) => { if (!protectedDraft) setDrafts((current) => ({ ...current, [draftKey]: value })); }}
      onAttach={() => attachmentInput.current?.click()}
      onSend={() => { void send(); }} onStop={() => { void chat.stop(); }} models={models}
      ready={!submissionBlockedReason && !protectedDraft && !rehydrate && !configLoading && !configError && chat.sessionReady && !chat.error && modelAvailable} pending={pending || navigationPending || protectedDraft} streaming={chat.isStreaming}
      projectControl={slots?.projectControl ?? projectPicker ?? <span>▱ {runtime.projectName ?? project}</span>}
      environmentControl={slots?.environmentControl ?? <span>{runtime.workspace.mode === "compatibility" ? "Compatibility workspace" : "Isolated runtime"}</span>}
      permissionControl={slots?.permissionControl ?? <span>Runtime permissions</span>}
      memoryControl={slots?.memoryControl} voiceControl={slots?.voiceControl} /></>}
  >
    {slots?.panels}
    {filesOpen && <section aria-label="Conversation artifacts" className="m-4 rounded-xl border border-white/10 p-4">
      <div className="flex items-center justify-between"><h2 className="text-sm">Conversation files</h2><button type="button" onClick={() => setFilesOpen(false)} aria-label="Close files">×</button></div>
      <WorkArtifacts key={activeId} artifacts={artifacts} />
    </section>}
    {review && <section aria-label="Conversation changes" className="m-4 rounded-xl border border-white/10 p-4">
      <div className="flex items-center justify-between"><h2 className="text-sm">Conversation changes</h2><button type="button" onClick={() => setReview(false)} aria-label="Close changes">×</button></div>
      {diffPending ? <p role="status">Loading changes…</p> : diffError ? <p role="alert">{diffError}</p>
        : diff?.sessionId === activeId ? <WorkChanges value={diff.value} /> : <p>Select Review changes to load this conversation.</p>}
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
    <ActivityDrawer isOpen={presentation === "work" && activity !== null && activity.sessionId === activeId} selection={activity?.sessionId === activeId ? activity.selection : null}
      messages={chat.messages} onClose={() => setActivity(null)} />
  </WorkShell>;
}
