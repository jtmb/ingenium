"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
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
import { availableWorkSelection, canSendWork, currentWorkDraft, initialWorkDraft, newWorkDraft, workAttachmentError, workDraftKey, workModels, type WorkDraft, type WorkIdentity } from "./work-state";
import { FreshConversationStart } from "@/lib/fresh-conversation-start";
import { useWorkChatConfig } from "./useWorkChatConfig";
import { workControlBindingMatches, type WorkContextSlots } from "./work-context";
import { workConversationNavigation, workLocationMatches } from "./work-navigation";

type FirstWorkInput = { draft: WorkDraft; originalKey: string; identity: WorkIdentity };

function readAttachment(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Attachment could not be read."));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onabort = () => reject(new Error(`Reading ${file.name} was interrupted.`));
    reader.readAsDataURL(file);
  });
}

export default function WorkRuntime({ initialSessionId, requestedRuntime, requestedProject, webQualification = null, admissionControl, submissionBlockedReason = null, contextSlots = null, projectPicker, routeError = null, projectRefId, projectDisplayName }: {
  initialSessionId: string | null; requestedRuntime: string | null; requestedProject: string | null;
  webQualification?: WorkWebQualification | null;
  admissionControl?: ReactNode;
  submissionBlockedReason?: string | null;
  contextSlots?: WorkContextSlots | null;
  projectPicker?: ReactNode;
  routeError?: string | null;
  projectRefId?: string | null;
  projectDisplayName?: string;
}) {
  const runtime = useRuntime();
  const project = useProject();
  const auth = useAuth();
  const unavailable = (notice?: string) => <WorkShell projectLabel={projectDisplayName ?? (projectRefId === null ? "No project" : runtime.projectName ?? project)} projects={[]} conversations={[]} activeId={null}
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
    contextSlots={contextSlots} projectPicker={projectPicker} projectRefId={projectRefId} projectDisplayName={projectDisplayName} />;
}

function BoundWorkRuntime({ initialSessionId, webQualification, admissionControl, submissionBlockedReason, contextSlots, projectPicker, projectRefId, projectDisplayName }: {
  initialSessionId: string | null; webQualification: WorkWebQualification | null; admissionControl?: ReactNode; submissionBlockedReason: string | null;
  contextSlots: WorkContextSlots | null; projectPicker?: ReactNode;
  projectRefId: string | null | undefined;
  projectDisplayName?: string;
}) {
  const runtime = useRuntime();
  const { user, installationAdmin } = useAuth();
  const organization = useOrganization();
  const project = useProject();
  const routeProject = runtime.projectName ?? project;
  const projectLabel = projectDisplayName ?? (projectRefId === null ? "No project" : routeProject);
  const router = useRouter();
  const params = useSearchParams();
  const committedLocation = useRef(params.toString());
  useLayoutEffect(() => { committedLocation.current = params.toString(); });
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
  const [firstSendPending, setFirstSendPending] = useState(false);
  const [navigationPending, startNavigation] = useTransition();
  const [unconfirmed, setUnconfirmed] = useState<Record<string, string>>({});
  const [creationUnknown, setCreationUnknown] = useState<string | null>(null);
  const [freshEpoch, setFreshEpoch] = useState(0);
  const freshStart = useMemo(() => new FreshConversationStart<FirstWorkInput>(),
    [runtime.client, user.id, organization.active?.id, routeProject, projectRefId, freshEpoch]);
  useLayoutEffect(() => freshStart.activate(), [freshStart]);
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
  const identity = { instanceId: "authenticated-dashboard", ownerId: user.id, organizationId: organization.active?.id ?? "unresolved", projectId: projectRefId === undefined ? routeProject : projectRefId,
    runtimeId: runtime.runtimeId ?? "compatibility", workspaceId: runtime.workspace.confirmedWorkspaceId ?? "", sessionId: initialSessionId };
  const draftKey = workDraftKey(identity);
  const slotBinding = { ownerId: user.id, organizationId: organization.active?.id ?? null, projectId: projectRefId ?? null, runtimeId: runtime.runtimeId,
    workspaceId: runtime.workspace.confirmedWorkspaceId, sessionId: activeId };
  const slotSelectionResolved = projectRefId !== undefined && projectRefId !== "" && (initialSessionId === null || activeId !== null);
  const slots = slotSelectionResolved && contextSlots && workControlBindingMatches(contextSlots.binding, slotBinding) ? contextSlots : null;
  const models = useMemo(() => workModels(config?.providers ?? []), [config]);
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
      sessionId: activeId, runtimeId: identity.runtimeId, project: routeProject, intent: "canonicalize" });
    if (navigation.action === "replace") router.replace(navigation.href, { scroll: false });
  }, [activeId, identity.runtimeId, navigationPending, params, routeProject, router, sessions.isLoading]);

  const select = (id: string) => {
    const navigation = workConversationNavigation({ search: committedLocation.current, hash: window.location.hash,
      sessionId: id, runtimeId: identity.runtimeId, project: routeProject, intent: "select" });
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
    const existingIds = [...sessions.sessions, ...(sessions.archivedSessions ?? [])].map((session) => session.id);
    if (initialSessionId === null) setDrafts((current) => ({ ...current, [originalKey]: original }));
    sendLock.current = true; setPending(true);
    try {
      const id = await sessions.create("New conversation");
      if (id) {
        if (!freshStart.isActive()) {
          setCreationUnknown(`Conversation ${id} was created on the original binding. Review it before continuing; nothing was sent.`);
          return;
        }
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
  const submitOriginal = useCallback(async (original: WorkDraft, originalKey: string, current: () => boolean): Promise<boolean> => {
    if (!current() || submissionBlockedReason || configLoading || configError || !chat.sessionReady || chat.isStreaming || chat.sessionStatus === "busy" || chat.error || !availableWorkSelection(original, models)) return false;
    try {
      const accepted = await chat.send([
        ...(original.text.trim() ? [{ type: "text" as const, text: original.text }] : []),
        ...original.attachments.map((item) => ({ type: "file" as const, mime: item.mime, url: item.url, filename: item.name })),
      ], { model: { providerID: original.providerId, modelID: original.modelId }, ...(original.variant ? { variant: original.variant } : {}) });
      if (accepted) {
        setDrafts((current) => ({ ...current, [originalKey]: { ...original, text: "", attachments: [] } }));
        setUnconfirmed((current) => { const next = { ...current }; delete next[originalKey]; return next; });
      } else setUnconfirmed((current) => ({ ...current, [originalKey]: current[originalKey] ?? "The runtime did not confirm prompt admission." }));
      return accepted;
    } catch (error: unknown) {
      const failure = error instanceof Error ? error.message : "The prompt admission outcome is unknown.";
      setUnconfirmed((current) => ({ ...current, [originalKey]: current[originalKey] ?? failure }));
      return false;
    }
  }, [chat.send, chat.sessionReady, chat.isStreaming, chat.sessionStatus, chat.error, configLoading, configError, models, submissionBlockedReason]);

  useLayoutEffect(() => {
    freshStart.publish({ sessionId: activeId, ready: !rehydrate && !configLoading && chat.sessionReady === true && !chat.isLoading && !chat.isStreaming && chat.sessionStatus !== "busy",
      error: chat.error ?? configError ?? submissionBlockedReason, send: (input, current) => submitOriginal(input.draft,
        workDraftKey({ ...input.identity, sessionId: activeId }), current) });
  }, [activeId, chat.error, chat.isLoading, chat.isStreaming, chat.sessionStatus, chat.sessionReady, configError, configLoading, freshStart, rehydrate, submissionBlockedReason, submitOriginal]);

  const send = async () => {
    const first = initialSessionId === null;
    const ready = first ? creationAvailable && !sessions.isLoading && !sessions.error : !rehydrate && chat.sessionReady && !chat.error;
    if (sendLock.current || submissionBlockedReason || protectedDraft || configLoading || configError || !modelAvailable || !canSendWork({ ready, pending: pending || navigationPending || chat.isStreaming, draft })) return;
    sendLock.current = true; setPending(true);
    if (first) setFirstSendPending(true);
    const original = { ...draft, attachments: draft.attachments.map((item) => ({ ...item })), skillIds: [...draft.skillIds] };
    const originalKey = draftKey;
    setDrafts((current) => ({ ...current, [originalKey]: original }));
    try {
      if (!first) { await submitOriginal(original, originalKey, () => freshStart.isActive()); return; }
      let creationFailure: string | null = null;
      const existingIds = [...sessions.sessions, ...(sessions.archivedSessions ?? [])].map((session) => session.id);
      const result = await freshStart.start(async () => {
        let id: string | null;
        try { id = await sessions.create("New conversation"); }
        catch (error: unknown) { creationFailure = error instanceof Error ? error.message : "Creation outcome is unknown."; throw error; }
        if (id && freshStart.isActive() && !workLocationMatches(committedLocation.current, { sessionId: initialSessionId, runtimeId: identity.runtimeId, project: routeProject })) {
          creationFailure = `Conversation ${id} was created on the original target, but navigation changed. The captured first draft was retained and no prompt was submitted.`;
          throw new Error(creationFailure);
        }
        if (id && !existingIds.includes(id) && freshStart.isActive()) {
          const nextKey = workDraftKey({ ...identity, sessionId: id });
          setDrafts((current) => ({ ...current, [nextKey]: original }));
          select(id);
        }
        return id;
      }, { draft: original, originalKey, identity: { ...identity } }, existingIds);
      if (result.kind === "accepted") {
        setDrafts((current) => { const next = { ...current }; delete next[originalKey]; return next; });
        setFreshEpoch((value) => value + 1);
      } else if (result.kind === "review") {
        setCreationUnknown(`First-send admission needs review in conversation ${result.sessionId}. The original draft is retained; nothing will be resent automatically.`);
      } else if (result.kind !== "busy") {
        setCreationUnknown(creationFailure ?? "First-send creation or preparation was not confirmed. The original draft is retained; review admission before trying again.");
      }
    } finally { sendLock.current = false; setPending(false); if (first) setFirstSendPending(false); }
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
  return <WorkShell projectLabel={projectLabel} projects={identity.projectId === null ? [] : [{ id: identity.projectId, label: projectLabel, conversations }]}
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
      {firstSendPending && <p role="status">Preparing the selected conversation and its captured first prompt…</p>}
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
      ready={!submissionBlockedReason && !protectedDraft && !configLoading && !configError && modelAvailable
        && (initialSessionId === null ? creationAvailable && !sessions.isLoading && !sessions.error : !rehydrate && chat.sessionReady && !chat.error)}
      pending={pending || navigationPending || protectedDraft} streaming={chat.isStreaming}
      projectControl={slots?.projectControl ?? projectPicker ?? <span>▱ {projectLabel}</span>}
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
      <h1 className="text-xl font-medium">{projectRefId === null ? "What should we build?" : `What should we build in ${projectLabel}?`}</h1>
      <p className="text-xs text-neutral-400">Send a message to start a new chat, or choose an existing conversation.</p>
    </div> : <ChatMessages messages={chat.messages} isLoading={chat.isLoading} isStreaming={chat.isStreaming}
      streamActivity={chat.streamActivity} error={chat.error} permissions={chat.permissions} replyPermission={chat.replyPermission}
      questions={chat.questions} replyQuestion={chat.replyQuestion}
      onActivityOpen={(messageId, partId) => { if (activeId) setActivity({ sessionId: activeId, selection: { messageId, partId } }); }}
      activitySelection={activity?.sessionId === activeId ? activity.selection : null} />}
    <ActivityDrawer isOpen={presentation === "work" && activity !== null && activity.sessionId === activeId} selection={activity?.sessionId === activeId ? activity.selection : null}
      messages={chat.messages} onClose={() => setActivity(null)} />
  </WorkShell>;
}
