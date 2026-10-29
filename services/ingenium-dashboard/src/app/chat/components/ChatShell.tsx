"use client";

import { useState, useCallback, useEffect, useRef, useId, useMemo, useLayoutEffect } from "react";
import Link from "next/link";
import ChatSessionSidebar from "./ChatSessionSidebar";
import ChatHeader from "./ChatHeader";
import ChatMessages from "./ChatMessages";
import ChatInput, { type Attachment, type SendOptions } from "./ChatInput";
import ActivityDrawer from "./ActivityDrawer";
import EdgeDrawer from "../../components/EdgeDrawer";
import type { ActivitySelection } from "./chat-activity";
import MCPDrawer from "./MCPDrawer";
import {
  isSafeProjectName,
  normalizeMcpServers,
  type McpServerView,
} from "./mcp-status";
import { useOpenCodeSessions } from "../../../lib/use-opencode-sessions";
import { useOpenCodeChat } from "../../../lib/use-opencode-chat";
import { api, ApiError, type ChatConfigResponse, type ExplicitMemoryReceipt, type TaskCaptureResult } from "../../../lib/api";
import { useProject } from "../../../lib/ProjectContext";
import { useOpenCodeClient, useRuntime } from "../../../lib/RuntimeContext";
import TaskCaptureModal from "../../tasks/components/TaskCaptureModal";
import {
  CHAT_CONTEXT_MAX_SOURCES,
  CHAT_CONTEXT_QUERY_MAX_CHARS,
  buildProjectContext,
  combineReferenceContext,
  unrequestedGrounding,
} from "../../../lib/chat-grounding";
import { buildExplicitMemoryContext, memoryWorkspaceId, newExplicitMemoryOperationId } from "../../../lib/explicit-memory";
import { useMemoryCapabilities } from "./use-memory-capabilities";
import Select from "../../components/Select";
import ProjectDropdown from "../../components/ProjectDropdown";
import { FreshConversationStart } from "../../../lib/fresh-conversation-start";

type ComposerSnapshot = { attachments: Attachment[]; providerId: string; modelId: string; agentName: string };
type HomePrompt = { text: string; options?: SendOptions; draft: ComposerSnapshot };

type MemorySaveInput = {
  operationId: string;
  workspaceId: string;
  content: string;
  tags: string[];
};

type MemoryNotice = {
  status: "saving" | "saved" | "failed";
  message: string;
} | {
  status: "queued";
  message: string;
  checkedUnknown: boolean;
  project: string;
  input: MemorySaveInput;
};

/* ------------------------------------------------------------------ */
/*  ChatShell — main layout orchestrator for the Chat mode            */
/* ------------------------------------------------------------------ */

/**
 * ChatShell — main layout orchestrator for the Chat mode.
 *
 * Renders a collapsible sidebar, main chat area with header, messages,
 * and composer. Uses real OpenCode API hooks for sessions, chat, and
 * provider/model/agent selection.
 *
 * Responsive: on mobile (<768px) the sidebar becomes an overlay drawer.
 */
export default function ChatShell({ presentation = "chat", onConversationStarted, onActiveSessionChange, navigationPending = false, initialSessionId }: {
  presentation?: "chat" | "home";
  onConversationStarted?: (sessionId: string) => void;
  onActiveSessionChange?: (sessionId: string | null) => void;
  navigationPending?: boolean;
  initialSessionId?: string | null;
} = {}) {
  const opencode = useOpenCodeClient();
  const runtime = useRuntime();
  const selectedProject = useProject();
  const homeStart = useMemo(() => new FreshConversationStart<HomePrompt>(), [opencode, selectedProject, runtime.runtimeId]);
  const [homePending, setHomePending] = useState(false);
  const [homeReview, setHomeReview] = useState<string | null>(null);
  const [homeAccepted, setHomeAccepted] = useState(false);
  const homeSelection = useRef({ providerId: "", modelId: "", allowed: false });
  useLayoutEffect(() => homeStart.activate(), [homeStart]);
  /* ---- Layout state ---- */
  const [collapsed, setCollapsed] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const mobileDrawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [contextSearchError, setContextSearchError] = useState<string | null>(null);
  const [memoryNotice, setMemoryNotice] = useState<MemoryNotice | null>(null);
  const homeMemoryOutcome = useRef<MemoryNotice | null>(null);
  const [memoryStatusPending, setMemoryStatusPending] = useState(false);
  const [shareState, setShareState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [compactState, setCompactState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [compactError, setCompactError] = useState<string | null>(null);
  const [taskCaptureOpen, setTaskCaptureOpen] = useState(false);
  const [taskCaptureSessionId, setTaskCaptureSessionId] = useState<string | null>(null);
  const [taskCaptureNotice, setTaskCaptureNotice] = useState<{ title: string } | null>(null);

  /* ---- Auto-collapse sidebar on smaller screens ---- */
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches) setCollapsed(true);
    };
    handler(mq);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  /* ---- MCP drawer state ---- */
  const drawerRef = useRef<HTMLDivElement>(null);
  const drawerTitleId = useId();

  const [mcpDrawerOpen, setMcpDrawerOpen] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerView[]>([]);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpRefreshing, setMcpRefreshing] = useState(false);
  const [mcpLastRefreshedAt, setMcpLastRefreshedAt] = useState<number | null>(null);
  const [mcpActionPending, setMcpActionPending] = useState<string | null>(null);

  /* ---- Activity drawer state ---- */
  const [activityOpen, setActivityOpen] = useState(false);
  const [activitySelection, setActivitySelection] = useState<ActivitySelection | null>(null);

  const handleMobileMenuOpen = useCallback((trigger: HTMLButtonElement) => {
    mobileDrawerTriggerRef.current = trigger;
    setMobileDrawerOpen(true);
  }, []);

  const handleMobileDrawerClosed = useCallback(() => {
    const trigger = mobileDrawerTriggerRef.current;
    mobileDrawerTriggerRef.current = null;
    if (!trigger?.isConnected) return;

    const activeElement = document.activeElement;
    const drawer = drawerRef.current;
    const focusMovedOutside = activeElement
      && activeElement !== document.body
      && !drawer?.contains(activeElement);
    if (focusMovedOutside) return;

    trigger.focus();
  }, []);

  /* ---- OpenCode hooks ---- */
  const {
    sessions,
    archivedSessions = [],
    activeId,
    create,
    rename,
    remove: removeSession,
    select,
    fork,
    share,
    isLoading: sessionsLoading,
    error: sessionsError,
    autoCreated = false,
    isCreating = false,
    refresh: refreshSessions,
  } = useOpenCodeSessions({ initialSelection: presentation === "home" ? "none" : "recent", initialSessionId });

  useLayoutEffect(() => {
    if (presentation !== "chat" || sessionsLoading || isCreating || navigationPending) return;
    // An unavailable explicit link must keep its identity and error. A confirmed
    // selection (or an empty catalog after removal) can update the route.
    if (activeId !== null || !sessionsError) onActiveSessionChange?.(activeId);
  }, [activeId, isCreating, navigationPending, onActiveSessionChange, presentation, sessionsError, sessionsLoading]);

  const activeSession = sessions.find((session) => session.id === activeId);
  const memoryProject = selectedProject;
  const savedMemoryWorkspaceId = memoryWorkspaceId(
    selectedProject,
    runtime.workspace.confirmedProjectName,
    runtime.workspace.confirmedWorkspaceId,
  );
  const memoryCapabilities = useMemoryCapabilities(memoryProject, savedMemoryWorkspaceId, mcpLastRefreshedAt);
  const chat = useOpenCodeChat(activeId, activeId ? {
    project: runtime.projectName ?? selectedProject,
    runtimeId: runtime.runtimeId,
    title: activeSession?.title ?? "New conversation",
  } : undefined);

  const openActivity = useCallback((messageId: string, partId: string) => {
    setActivitySelection({ messageId, partId });
    setActivityOpen(true);
  }, []);

  const closeActivity = useCallback(() => {
    setActivityOpen(false);
    setActivitySelection(null);
  }, []);

  // A selection belongs to one session and one turn. Do not let an old
  // selected tool remain visible while a new session is loading.
  useEffect(() => {
    closeActivity();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMemoryNotice((current) => current?.status === "queued" ? current : null);
  }, [activeId, closeActivity, memoryProject, savedMemoryWorkspaceId]);

  /** Reset dismissed error when error changes to something new. */
  const displayError =
    chat.error && chat.error !== dismissedError ? chat.error : null;
  useEffect(() => {
    if (chat.error) setDismissedError(null);
  }, [chat.error]);

  const handleDismissError = useCallback(() => {
    setDismissedError(chat.error);
  }, [chat.error]);

  /* ---- Chat config — Settings-backed provider/agent selection ---- */
  const [chatConfig, setChatConfig] = useState<ChatConfigResponse | null>(null);
  const chatConfigProject = isSafeProjectName(chatConfig?.project) ? chatConfig.project : null;
  const [chatConfigLoading, setChatConfigLoading] = useState(true);
  const [chatConfigError, setChatConfigError] = useState<string | null>(null);
  // The catalog is not ready until the selection-recovery effect has resolved
  // the current provider/model pair. This prevents a valid delayed catalog
  // from briefly looking like an empty one between renders.
  const [chatConfigReady, setChatConfigReady] = useState(false);

  /* ---- Rate-limit recovery ---- */
  const [rateLimitSeconds, setRateLimitSeconds] = useState<number | null>(null);
  const [rateLimitMessage, setRateLimitMessage] = useState<string>("");
  const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Clear the rate-limit timer and reset state. */
  const clearRateLimit = useCallback(() => {
    if (rateLimitTimerRef.current) {
      clearInterval(rateLimitTimerRef.current);
      rateLimitTimerRef.current = null;
    }
    setRateLimitSeconds(null);
    setRateLimitMessage("");
  }, []);

  /* ---- Provider / Model / Agent selection ---- */
  const [selection, setSelection] = useState({ providerId: "", modelId: "" });
  const { providerId, modelId } = selection;
  const [agentName, setAgentName] = useState("ingenium-chat");
  // Server writes are serialized so a rapid A → B selection cannot arrive at
  // the API as B → A and leave Docs AI with an obsolete persisted selection.
  const selectionSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  // Fetch sanitized chat config from the API

  const fetchChatConfig = useCallback(async (isRetry = false) => {
    try {
      setChatConfigLoading(true);
      setChatConfigReady(false);
      if (!isRetry) setChatConfigError(null);
      const result = await opencode.chat.config();
      setChatConfig(result);
      // Success clears any active rate-limit state
      clearRateLimit();
      return result;
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        const retryAfter = err.retryAfterSeconds ?? 5;
        setRateLimitSeconds(retryAfter);
        setRateLimitMessage(err.message);
        // Don't set generic chatConfigError — the rate-limit banner handles it
        if (!isRetry) setChatConfigError(null);
        return null;
      }
      clearRateLimit();
      setChatConfigError(err instanceof Error ? err.message : "Failed to load chat config");
      return null;
    } finally {
      setChatConfigLoading(false);
    }
  }, [clearRateLimit, opencode]);

  // Countdown effect — decrement rateLimitSeconds every second
  useEffect(() => {
    if (rateLimitSeconds === null || rateLimitSeconds <= 0) return;
    rateLimitTimerRef.current = setInterval(() => {
      setRateLimitSeconds((prev) => {
        if (prev === null || prev <= 1) {
          // Countdown expired — clear the timer and signal auto-retry
          if (rateLimitTimerRef.current) {
            clearInterval(rateLimitTimerRef.current);
            rateLimitTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (rateLimitTimerRef.current) {
        clearInterval(rateLimitTimerRef.current);
        rateLimitTimerRef.current = null;
      }
    };
  }, [rateLimitSeconds !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-retry when countdown reaches 0
  useEffect(() => {
    if (rateLimitSeconds === 0) {
      fetchChatConfig(true);
    }
  }, [rateLimitSeconds, fetchChatConfig]);

  const handleRateLimitRetry = useCallback(() => {
    clearRateLimit();
    fetchChatConfig(true);
  }, [clearRateLimit, fetchChatConfig]);

  useEffect(() => {
    void fetchChatConfig();
  }, [fetchChatConfig]);

  // Recover a usable pair whenever a refreshed catalog invalidates the current
  // selection. Provider and model share one state update so a provider switch
  // cannot render or persist a transient cross-provider model pairing.
  useEffect(() => {
    if (!chatConfig || chatConfigLoading || chatConfigError || rateLimitSeconds !== null) return;
    const currentProvider = chatConfig.providers.find((candidate) => candidate.providerId === providerId);
    if (currentProvider?.models.some((model) => model.id === modelId)) {
      setChatConfigReady(true);
      return;
    }
    const preferred = chatConfig.defaultSelection
      ?? (chatConfig.configured && chatConfig.primary
        ? { providerId: chatConfig.primary.providerId, modelId: chatConfig.primary.modelId }
        : null);
    const provider = chatConfig.providers.find((candidate) => candidate.providerId === preferred?.providerId)
      ?? chatConfig.providers.find((candidate) => candidate.models.length > 0);
    if (!provider) {
      if (providerId || modelId) setSelection({ providerId: "", modelId: "" });
      setChatConfigReady(true);
      return;
    }
    const preferredModelId = provider.providerId === preferred?.providerId ? preferred.modelId : undefined;
    const nextModelId = provider.models.some((model) => model.id === preferredModelId)
      ? preferredModelId!
      : provider.models.some((model) => model.id === provider.defaultModel)
        ? provider.defaultModel
        : provider.models[0]!.id;
    if (providerId !== provider.providerId || modelId !== nextModelId) {
      setSelection({ providerId: provider.providerId, modelId: nextModelId });
    }
    setChatConfigReady(true);
  }, [chatConfig, chatConfigError, chatConfigLoading, modelId, providerId, rateLimitSeconds]);

  /* ---- Attachment state ---- */
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const attachmentOwner = useRef(activeId);
  useLayoutEffect(() => {
    if (presentation !== "home" && attachmentOwner.current !== activeId) setAttachments([]);
    attachmentOwner.current = activeId;
  }, [activeId, presentation]);

  /* ---- Derived provider data from chat config ---- */
  const availableProviders = (chatConfig?.providers ?? []).map((p) => ({
    id: p.providerId,
    label: p.label,
    source: p.source,
  }));

  /** For the current provider, show its models from the providers[] array. */
  const currentModels = (() => {
    const provider = (chatConfig?.providers ?? []).find(
      (p) => p.providerId === providerId,
    );
    return provider?.models ?? [];
  })();

  /** Lock agent selector to ingenium-chat only. */
  const availableAgents = chatConfig?.agents.map((a) => ({
    name: a.name,
    label: a.label,
  })) ?? [];

  /** A prompt can run only when the selected provider exposes the selected model. */
  const hasSelectableModel = currentModels.some((model) => model.id === modelId);

  /** Persist a manually selected catalog pair for global Docs AI resolution. */
  const saveChatSelection = useCallback((nextProviderId: string, nextModelId: string) => {
    const provider = (chatConfig?.providers ?? []).find((candidate) => candidate.providerId === nextProviderId);
    if (!provider?.models.some((model) => model.id === nextModelId)) return;
    const persist = async () => {
      try {
        await opencode.chat.saveSelection({ providerId: nextProviderId, modelId: nextModelId });
      } catch {
        // The local Chat turn remains usable. Docs AI will use the last
        // validated server selection or server-derived default until a later
        // queued selection succeeds.
      }
    };
    selectionSaveQueueRef.current = selectionSaveQueueRef.current.then(persist, persist);
  }, [chatConfig, opencode]);

  /** Provider recovery remains available when only the selected model is stale. */
  // A missing default must not disable recovery when the catalog still offers
  // providers. Only an empty catalog disables the provider and agent selectors.
  const selectorsDisabled = !chatConfigReady || chatConfigLoading || !!chatConfigError
    || rateLimitSeconds !== null || availableProviders.length === 0 || (presentation === "chat" && (navigationPending || isCreating));
  useLayoutEffect(() => {
    homeSelection.current = { providerId, modelId, allowed: !selectorsDisabled && hasSelectableModel };
  }, [providerId, modelId, selectorsDisabled, hasSelectableModel]);

  const handleProviderChange = useCallback((nextProviderId: string) => {
    const provider = (chatConfig?.providers ?? []).find((candidate) => candidate.providerId === nextProviderId);
    if (!provider || provider.models.length === 0) {
      setSelection({ providerId: nextProviderId, modelId: "" });
      return;
    }
    const nextModelId = provider.models.some((model) => model.id === provider.defaultModel)
      ? provider.defaultModel
      : provider.models[0]!.id;
    setSelection({ providerId: nextProviderId, modelId: nextModelId });
    saveChatSelection(nextProviderId, nextModelId);
  }, [chatConfig, saveChatSelection]);

  const handleModelChange = useCallback((nextModelId: string) => {
    setSelection((current) => ({ ...current, modelId: nextModelId }));
    saveChatSelection(providerId, nextModelId);
  }, [providerId, saveChatSelection]);

  /** Task capture is identity-only and waits for the hook's session validation. */
  const taskCaptureDisabled = !activeId || !activeSession || sessionsLoading || chat.isLoading || chat.isStreaming;

  const handleCreateTask = useCallback(() => {
    if (taskCaptureDisabled) return;
    setTaskCaptureNotice(null);
    setTaskCaptureSessionId(activeId);
    setTaskCaptureOpen(true);
  }, [activeId, taskCaptureDisabled]);

  const handleTaskCaptureClose = useCallback(() => {
    setTaskCaptureOpen(false);
    setTaskCaptureSessionId(null);
  }, []);

  const handleTaskCaptured = useCallback((result: TaskCaptureResult) => {
    setTaskCaptureNotice({ title: result.task.title });
  }, []);

  /** Track whether this was the first message (for title rename). */
  const wasFirstMessage = useRef(chat.messages.length === 0);
  useEffect(() => {
    if (chat.messages.length > 0) {
      wasFirstMessage.current = false;
    } else {
      wasFirstMessage.current = true;
    }
  }, [chat.messages.length]);

  /* ---- MCP status ---- */

  /** Fetch MCP server status from OpenCode and derive drawer shape. */
  const refreshMcpStatus = useCallback(async (clearError = true): Promise<boolean> => {
    if (clearError) setMcpError(null);
    setMcpRefreshing(true);
    try {
      const raw = await opencode.mcp.status();
      const servers = normalizeMcpServers(raw);
      if (!servers) throw new Error("invalid MCP status response");
      setMcpServers(servers);
      setMcpLastRefreshedAt(Date.now());
      return true;
    } catch {
      setMcpError("MCP status is unavailable. Verify OpenCode is running, then retry.");
      return false;
    } finally {
      setMcpRefreshing(false);
    }
  }, []);

  const handleMcpRefresh = useCallback(
    () => refreshMcpStatus(),
    [refreshMcpStatus],
  );

  const changeMcpConnection = useCallback(async (name: string, action: "connect" | "disconnect") => {
    setMcpActionPending(name);
    setMcpError(null);
    try {
      if (action === "connect") await opencode.mcp.connect(name);
      else await opencode.mcp.disconnect(name);
    } catch {
      setMcpError(
        action === "connect"
          ? `Unable to connect to ${name}. Try again.`
          : `Unable to disconnect from ${name}. Try again.`,
      );
    } finally {
      // Refresh after every mutation, including an upstream failure: the remote
      // operation may have completed even if the response was interrupted.
      await refreshMcpStatus(false);
      setMcpActionPending(null);
    }
  }, [refreshMcpStatus]);

  const handleMcpOpen = useCallback(() => {
    setMcpDrawerOpen(true);
  }, []);

  /** Auto-focus the first focusable element in the mobile drawer when it opens. */
  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const drawer = drawerRef.current;
      if (!drawer) return;
      const firstFocusable = drawer.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mobileDrawerOpen]);

  /* ---- Session handlers ---- */

  const handleNew = useCallback(async () => {
    if (isCreating || navigationPending) return;
    closeActivity();
    await create("New conversation");
    setMobileDrawerOpen(false);
  }, [closeActivity, create, isCreating, navigationPending]);

  const handleSelect = useCallback(
    (id: string) => {
      closeActivity();
      select(id);
      setMobileDrawerOpen(false);
    },
    [closeActivity, select],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (id === activeId) closeActivity();
      await removeSession(id);
    },
    [activeId, closeActivity, removeSession],
  );

  const handleRename = useCallback(
    async (title: string) => {
      if (!activeId) return;
      await rename(activeId, title);
    },
    [activeId, rename],
  );

  /* ---- Chat handlers ---- */

  const handleSend = useCallback(
    async (text: string, options?: SendOptions, intentCurrent?: () => boolean, draft?: ComposerSnapshot): Promise<boolean> => {
      if (intentCurrent && !intentCurrent()) return false;
      if (presentation === "chat" && (isCreating || navigationPending)) return false;
      if (!activeId) return false;
      if (!hasSelectableModel || !providerId || !modelId) return false;
      const sendProvider = draft?.providerId ?? providerId;
      const sendModel = draft?.modelId ?? modelId;
      const sendAgent = draft?.agentName ?? agentName;
      if (sendProvider !== providerId || sendModel !== modelId) return false;
      homeMemoryOutcome.current = null;

      setContextSearchError(null);
      const shouldRename =
        wasFirstMessage.current &&
        activeSession?.title === "New conversation";

      let grounding = unrequestedGrounding();
      const referenceContexts: string[] = [];
      if ((options?.useSavedMemory && !memoryCapabilities.canRead) || (options?.saveToMemory && !memoryCapabilities.canSave)) {
        setMemoryNotice({ status: "failed", message: memoryCapabilities.reason ?? "Memory capability is unavailable." });
        return false;
      }
      if (options?.useSavedMemory && savedMemoryWorkspaceId) {
        try {
          const result = await api.memory.list(memoryProject, savedMemoryWorkspaceId);
          const memoryContext = buildExplicitMemoryContext(result.data, memoryProject, savedMemoryWorkspaceId);
          if (result.data.items.length > 0 && !memoryContext) throw new Error("invalid saved-memory context");
          if (memoryContext) referenceContexts.push(memoryContext);
        } catch {
          setMemoryNotice({ status: "failed", message: "Saved memory is unavailable. Try sending again." });
          return false;
        }
      }
      if (options?.useProjectContext) {
        try {
          const result = await api.context.rag.search(
            text.slice(0, CHAT_CONTEXT_QUERY_MAX_CHARS),
            selectedProject,
            CHAT_CONTEXT_MAX_SOURCES,
          );
          const context = buildProjectContext(selectedProject, result.data);
          grounding = context.grounding;
          if (context.referenceContext) referenceContexts.push(context.referenceContext);
        } catch {
          setContextSearchError("Project context search is unavailable. Try sending again.");
          return false;
        }
      }
      const context = combineReferenceContext(...referenceContexts);

      // Build parts array: text part + file parts from attachments
      const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }> = [
        { type: "text", text },
      ];

      for (const att of draft?.attachments ?? attachments) {
        if (att.pending || att.error || !att.dataUrl) {
          setContextSearchError("Wait for attachments to finish reading, or remove an unreadable file before sending.");
          return false;
        }
        parts.push({
          type: "file",
          mime: att.mime,
          url: att.dataUrl,
          filename: att.name,
        });
      }

      try {
        if (intentCurrent && !intentCurrent()) return false;
        const accepted = await chat.send(parts, {
          model: { providerID: sendProvider, modelID: sendModel },
          agent: sendAgent,
          context,
          grounding,
        });
        if (!accepted) return false;
      } catch {
        // send() handles its own error dispatch
        return false;
      }

      if (options?.saveToMemory && savedMemoryWorkspaceId) {
        setMemoryNotice({ status: "saving", message: "Saving this message to memory…" });
        try {
          const input: MemorySaveInput = {
            operationId: newExplicitMemoryOperationId(),
            workspaceId: savedMemoryWorkspaceId,
            content: text,
            tags: ["chat"],
          };
          const result = await api.memory.save(memoryProject, input);
          const nextNotice: MemoryNotice = "status" in result.data
            ? {
              status: "queued",
              message: `Memory save outcome is pending (${input.operationId}). Check its status before retrying.`,
              checkedUnknown: false,
              project: memoryProject,
              input,
            }
            : { status: "saved", message: `Saved to memory as version ${result.data.receipt.version}. Receipt ${result.data.receipt.receiptId}.` };
          homeMemoryOutcome.current = nextNotice;
          setMemoryNotice(nextNotice);
        } catch {
          const failure: MemoryNotice = { status: "failed", message: "This message was not saved to memory. Try again." };
          homeMemoryOutcome.current = failure;
          setMemoryNotice(failure);
        }
      }

      // The prompt contract accepted this send; only now may local composer state change.
      setAttachments([]);

      // Update session title from first message (best-effort - do not block)
      if (shouldRename) {
        const title =
          text.length > 50 ? `${text.slice(0, 47)}...` : text;
        rename(activeId, title).catch(() => {});
      }

      return true;
    },
    [activeId, activeSession, chat, rename, attachments, providerId, modelId, agentName, hasSelectableModel,
      memoryProject, savedMemoryWorkspaceId, selectedProject, memoryCapabilities, presentation, isCreating, navigationPending],
  );

  useLayoutEffect(() => {
    homeStart.publish({
      sessionId: activeId,
      ready: chat.sessionReady === true && !chat.isLoading,
      error: chat.error,
      send: (input, current) => handleSend(input.text, input.options, () => current()
        && homeSelection.current.allowed
        && homeSelection.current.providerId === input.draft.providerId
        && homeSelection.current.modelId === input.draft.modelId, input.draft),
    });
  }, [activeId, chat.sessionReady, chat.isLoading, chat.error, handleSend, homeStart]);

  const handleHomeSend = useCallback(async (text: string, options?: SendOptions): Promise<boolean> => {
    if (homePending || homeReview || sessionsLoading || sessionsError || selectorsDisabled || !hasSelectableModel) return false;
    setHomePending(true);
    try {
      const result = await homeStart.start(() => create("New conversation"), {
        text, options: options ? { ...options } : undefined,
        draft: { attachments: attachments.map(item => ({ ...item })), providerId, modelId, agentName },
      }, [...sessions, ...archivedSessions].map(item => item.id));
      if (!homeStart.isActive()) return false;
      if (result.kind === "accepted") {
        if (homeMemoryOutcome.current?.status === "queued" || homeMemoryOutcome.current?.status === "failed") {
          setHomeAccepted(true);
          setHomeReview(result.sessionId);
        } else onConversationStarted?.(result.sessionId);
        return true;
      }
      if (result.kind === "review") setHomeReview(result.sessionId);
      return false;
    } finally { setHomePending(false); }
  }, [homePending, homeReview, sessionsLoading, sessionsError, selectorsDisabled, hasSelectableModel,
    homeStart, create, attachments, providerId, modelId, agentName, sessions, archivedSessions, onConversationStarted]);

  const memorySavedNotice = useCallback((receipt: ExplicitMemoryReceipt): MemoryNotice => ({
    status: "saved",
    message: `Saved to memory as version ${receipt.version}. Receipt ${receipt.receiptId}.`,
  }), []);

  const handleMemoryStatus = useCallback(async () => {
    if (memoryNotice?.status !== "queued" || memoryStatusPending) return;
    const queued = memoryNotice;
    setMemoryStatusPending(true);
    try {
      const result = await api.memory.operationStatus(queued.project, queued.input.workspaceId, queued.input.operationId);
      setMemoryNotice(result.data.status === "committed"
        ? memorySavedNotice(result.data.receipt)
        : {
          ...queued,
          checkedUnknown: true,
          message: `Memory save outcome is still unknown (${queued.input.operationId}). It has not been reported as committed.`,
        });
    } catch {
      setMemoryNotice({ ...queued, message: `Unable to check memory save status. The original outcome remains unknown (${queued.input.operationId}).` });
    } finally {
      setMemoryStatusPending(false);
    }
  }, [memoryNotice, memorySavedNotice, memoryStatusPending]);

  const handleMemoryReplay = useCallback(async () => {
    if (memoryNotice?.status !== "queued" || !memoryNotice.checkedUnknown || memoryStatusPending) return;
    const queued = memoryNotice;
    setMemoryStatusPending(true);
    try {
      const result = await api.memory.save(queued.project, queued.input);
      setMemoryNotice("status" in result.data
        ? { ...queued, checkedUnknown: false, message: `Memory save outcome is pending (${queued.input.operationId}). Check its status before retrying.` }
        : memorySavedNotice(result.data.receipt));
    } catch {
      setMemoryNotice({ ...queued, message: `The identical save could not be replayed. The original outcome remains unknown (${queued.input.operationId}).` });
    } finally {
      setMemoryStatusPending(false);
    }
  }, [memoryNotice, memorySavedNotice, memoryStatusPending]);

  const handleStop = useCallback(async () => {
    await chat.stop();
  }, [chat]);

  const handleFork = useCallback(async () => {
    if (!activeId) return;
    // Fork from the last assistant message, if any
    const lastAssistant = [...chat.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    await fork(activeId, lastAssistant?.id);
  }, [activeId, chat.messages, fork]);

  const handleShare = useCallback(async () => {
    if (!activeId) return;
    setShareState("loading");
    setShareError(null);
    try {
      const url = await share(activeId);
      if (url) {
        setShareUrl(url);
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          // Clipboard API unavailable — silent
        }
        setShareState("success");
      } else {
        setShareState("error");
        setShareError("Failed to share session — no URL returned");
      }
    } catch (err) {
      setShareState("error");
      setShareError(
        err instanceof Error ? err.message : "Failed to share session",
      );
    }
    // Auto-reset after 5 seconds
    setTimeout(() => {
      setShareState("idle");
      setShareError(null);
    }, 5000);
  }, [activeId, share]);

  const handleCompact = useCallback(async () => {
    if (!activeId) return;
    setCompactState("loading");
    setCompactError(null);
    try {
      await opencode.sessions.compact(activeId, {
        providerID: providerId,
        modelID: modelId,
      });
      setCompactState("success");
    } catch (err) {
      setCompactState("error");
      setCompactError(
        err instanceof Error ? err.message : "Failed to compact session",
      );
    }
    // Auto-reset after 5 seconds
    setTimeout(() => {
      setCompactState("idle");
      setCompactError(null);
    }, 5000);
  }, [activeId, providerId, modelId]);

  const handleRetry = useCallback(async () => {
    closeActivity();
    await chat.retry();
  }, [chat, closeActivity]);

  const handleRevert = useCallback(
    async (messageId: string, partId?: string) => {
      await chat.revert(messageId, partId);
    },
    [chat],
  );

  /* ---- Rendering ---- */

  if (presentation === "home") return <section className="veyra-home-chat" aria-label="Start a new conversation">
    <fieldset disabled={homePending || !!homeReview || sessionsLoading || !!sessionsError} className="min-w-0 border-0 p-0 m-0">
      <ChatInput variant="home" onSend={handleHomeSend} onStop={handleStop} isLoading={false}
        providerId={providerId} modelId={modelId} agentName={agentName}
        attachments={attachments} onAttachmentsChange={setAttachments}
        hasSelectableModel={!selectorsDisabled && hasSelectableModel}
        projectContextProject={selectedProject} memoryWorkspaceId={savedMemoryWorkspaceId}
        memoryCanRead={memoryCapabilities.canRead} memoryCanSave={memoryCapabilities.canSave}
        memoryUnavailableReason={memoryCapabilities.reason} memorySavePending={memoryNotice?.status === "queued"}
        projectControl={<ProjectDropdown />} onOpenTools={() => setMcpDrawerOpen(true)}
        modelControl={<Select aria-label="Home chat model" value={JSON.stringify([providerId, modelId])}
          disabled={selectorsDisabled}
          onChange={event => {
            const candidate = (chatConfig?.providers ?? []).flatMap(provider => provider.models.map(model => ({ provider, model })))
              .find(({ provider, model }) => JSON.stringify([provider.providerId, model.id]) === event.target.value);
            if (!candidate) return;
            setSelection({ providerId: candidate.provider.providerId, modelId: candidate.model.id });
            saveChatSelection(candidate.provider.providerId, candidate.model.id);
          }} className="veyra-home-model text-sm">
          {!hasSelectableModel && <option value={JSON.stringify([providerId, modelId])}>No model available</option>}
          {(chatConfig?.providers ?? []).map(provider => <optgroup key={provider.providerId} label={provider.label}>
            {provider.models.map(model => <option key={model.id} value={JSON.stringify([provider.providerId, model.id])}>{provider.label} · {model.label}</option>)}
          </optgroup>)}
        </Select>}/>
    </fieldset>
    {homePending && <p role="status">Preparing your new conversation…</p>}
    {homePending && chat.isStreaming && <button type="button" onClick={() => void handleStop()}>Stop generating</button>}
    {sessionsError && <div role="alert"><p>{sessionsError}</p><button type="button" onClick={() => void refreshSessions()}>Retry conversation catalog</button></div>}
    {chatConfigError && <div role="alert"><p>{chatConfigError}</p><button type="button" onClick={() => void handleRateLimitRetry()}>Retry model catalog</button></div>}
    {chat.error && <p role="alert">{chat.error}</p>}
    {contextSearchError && <p role="alert">{contextSearchError}</p>}
    {memoryNotice && <p role="status">{memoryNotice.message}</p>}
    {memoryNotice?.status === "queued" && <div>
      <button type="button" disabled={memoryStatusPending} onClick={() => void handleMemoryStatus()}>Check memory save</button>
      {memoryNotice.checkedUnknown && <button type="button" disabled={memoryStatusPending} onClick={() => void handleMemoryReplay()}>Retry original memory save</button>}
    </div>}
    {homeReview && <div role="alert"><p>{homeAccepted
      ? "Your message was sent. Review its memory-save result above before continuing."
      : "Review this conversation before sending again. Your draft is retained here."}</p>
      <button type="button" disabled={memoryNotice?.status === "queued"} onClick={() => onConversationStarted?.(homeReview)}>{homeAccepted ? "Open conversation" : "Review conversation"}</button></div>}
    <MCPDrawer isOpen={mcpDrawerOpen} onClose={() => setMcpDrawerOpen(false)} servers={mcpServers} error={mcpError}
      isRefreshing={mcpRefreshing} lastRefreshedAt={mcpLastRefreshedAt} project={chatConfigProject} pendingServerName={mcpActionPending}
      onRefresh={handleMcpRefresh} onConnect={name => changeMcpConnection(name, "connect")} onDisconnect={name => changeMcpConnection(name, "disconnect")}/>
  </section>;

  return (
    <div className="veyra-chat flex h-full min-h-0" data-empty={chat.messages.length === 0 && !chat.isLoading && !chat.error}>
      {/* Sidebar — hidden on mobile, visible as drawer overlay instead */}
      <div className={collapsed ? "hidden" : "hidden md:flex"}>
        <ChatSessionSidebar
          sessions={sessions}
          activeId={activeId}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onNew={handleNew}
          newDisabled={isCreating}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          isLoading={sessionsLoading}
          sessionsError={sessionsError}
        />
      </div>

      {/* Mobile drawer overlay */}
      <EdgeDrawer
        open={mobileDrawerOpen}
        side="left"
        className="md:hidden fixed inset-0 z-40 flex"
        panelRef={drawerRef}
        panelClassName="relative z-50 w-[280px] h-full bg-[var(--color-nav-bg)] shadow-xl"
        panelProps={{
          role: "dialog",
          "aria-modal": "true",
          "aria-label": "Chat sessions",
        }}
        backdropProps={{ "data-testid": "chat-session-drawer-backdrop" }}
        onBackdropClick={() => setMobileDrawerOpen(false)}
        onClosed={handleMobileDrawerClosed}
      >
        <ChatSessionSidebar
          sessions={sessions}
          activeId={activeId}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onNew={handleNew}
          newDisabled={isCreating}
          collapsed={false}
          onToggle={() => setMobileDrawerOpen(false)}
          isDrawer={mobileDrawerOpen}
          isLoading={sessionsLoading}
          sessionsError={sessionsError}
        />
      </EdgeDrawer>

      {/* Main chat area */}
      <div className="veyra-chat-main flex-1 flex-col min-w-0 min-h-0 flex">
        <div className="flex items-center gap-2 px-4 py-2">
          <button type="button" onClick={() => setCollapsed((value) => !value)} className="hidden md:inline-flex rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]" aria-expanded={!collapsed}>History</button>
          <button type="button" onClick={handleNew} disabled={isCreating || navigationPending} className="rounded-lg px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50">New conversation</button>
        </div>

        {contextSearchError && (
          <div
            className="flex shrink-0 items-center gap-2 px-4 py-2 text-sm text-[var(--color-error-text)]"
            role="alert"
            data-testid="chat-project-context-error"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="shrink-0"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6" />
              <path strokeLinecap="round" d="M8 5v3M8 10.5v.5" />
            </svg>
            <span>{contextSearchError}</span>
          </div>
        )}
        {memoryNotice && (
          <div
            className={`flex shrink-0 flex-wrap items-center gap-2 px-4 py-2 text-sm ${memoryNotice.status === "failed" ? "text-[var(--color-error-text)]" : "text-[var(--color-text-secondary)]"}`}
            role={memoryNotice.status === "failed" ? "alert" : "status"}
            data-testid="chat-memory-notice"
          >
            <span className="min-w-0 flex-1">{memoryNotice.message}</span>
            {memoryNotice.status === "queued" && (
              <>
                <button type="button" onClick={() => void handleMemoryStatus()} disabled={memoryStatusPending} className="shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50">
                  {memoryStatusPending ? "Checking…" : "Check status"}
                </button>
                {memoryNotice.checkedUnknown && (
                  <button type="button" onClick={() => void handleMemoryReplay()} disabled={memoryStatusPending} className="shrink-0 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs font-medium text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] disabled:cursor-not-allowed disabled:opacity-50">
                    Retry identical save
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {/* No-LLM-configured warning */}
        {chatConfigReady && !hasSelectableModel && !chatConfigLoading && !chatConfigError && (
          <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950 border-b border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2 shrink-0">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="shrink-0"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6" />
              <path strokeLinecap="round" d="M8 5v2.5M8 10.5h.005" />
            </svg>
            <span className="truncate">
              No model is available. Go to{" "}
              <Link href="/chat?settings=providers" className="font-medium underline hover:no-underline">
                Settings → Providers
              </Link>{" "}
              to configure a provider.
            </span>
          </div>
        )}
        {chatConfigError && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-center gap-2 shrink-0">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="shrink-0"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6" />
              <path strokeLinecap="round" d="M8 5v2.5M8 10.5h.005" />
            </svg>
            <span className="truncate">Failed to load chat config: {chatConfigError}</span>
          </div>
        )}
        {/* Rate-limit recovery banner — countdown + manual retry */}
        {rateLimitSeconds !== null && !chatConfigError && (
          <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2 shrink-0">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="shrink-0 animate-spin"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6.5" strokeOpacity="0.3" />
              <path strokeLinecap="round" d="M8 1.5a6.5 6.5 0 016.5 6.5" />
            </svg>
            <span className="flex-1 truncate">
              {rateLimitMessage || "Rate limited"}{" "}
              {rateLimitSeconds > 0 && (
                <span className="font-mono tabular-nums">
                  — retrying in {rateLimitSeconds}s
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={handleRateLimitRetry}
              disabled={chatConfigLoading}
              className="shrink-0 px-3 py-1 rounded-md text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
            >
              Retry Now
            </button>
          </div>
        )}
        {/* Inline error banner for share/compact failures */}
        {(shareError || compactError) && (
          <div className="px-4 py-2 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300 flex items-center gap-2 shrink-0">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="shrink-0"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6" />
              <path strokeLinecap="round" d="M8 5v2.5M8 10.5h.005" />
            </svg>
            <span className="truncate">
              {shareError ? `Share failed: ${shareError}` : `Compact failed: ${compactError}`}
            </span>
          </div>
        )}
        {taskCaptureNotice && (
          <div
            data-testid="chat-task-capture-status"
            role="status"
            aria-live="polite"
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded border border-[var(--color-success-border)] bg-[var(--color-success-bg)] px-4 py-2 text-sm text-[var(--color-success-text)] shadow-lg"
          >
            Task created: {" "}
            <Link href="/tasks" className="font-medium underline hover:no-underline">
              {taskCaptureNotice.title}
            </Link>
          </div>
        )}
        {autoCreated ? (
          <>
            <ChatMessages
              messages={chat.messages}
              isLoading={chat.isLoading}
              isStreaming={chat.isStreaming}
              streamActivity={chat.streamActivity}
              error={displayError}
              onRetry={handleRetry}
              onRevert={handleRevert}
              onDismissError={handleDismissError}
              permissions={chat.permissions}
              replyPermission={chat.replyPermission}
              questions={chat.questions}
              replyQuestion={chat.replyQuestion}
              onActivityOpen={openActivity}
              activitySelection={activitySelection}
              mcpProject={chatConfigProject}
            />
            {/* Disabled composer — waiting for auto-created session */}
            <div className="shrink-0 w-full overflow-y-auto [scrollbar-gutter:stable] px-4 pb-4 pt-2">
              <div className="max-w-3xl mx-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] shadow-sm px-4 py-3">
                <p className="text-sm text-[var(--color-text-muted)] text-center">
                  Starting conversation...
                </p>
              </div>
            </div>
          </>
        ) : !activeId && !sessionsLoading && sessionsError ? (
          /* Auto-create failure — sessionsError is set, no active conversation */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm px-4">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="mx-auto mb-4 text-red-500"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856C20.06 19 21 17.921 21 16.645V7.355C21 6.079 20.06 5 18.918 5H8.92A3 3 0 006 7.355L4.083 16.053C3.698 17.691 4.963 19 6.643 19"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01"
                  strokeWidth="2"
                />
              </svg>
              <p className="text-sm text-red-600 dark:text-red-400 font-medium mb-2">
                Failed to create conversation
              </p>
              <p className="text-xs text-[var(--color-text-muted)] mb-4 max-h-20 overflow-y-auto">
                {sessionsError ?? "An unknown error occurred."}
              </p>
              <button
                type="button"
                onClick={handleNew}
                disabled={isCreating || navigationPending}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors disabled:cursor-wait disabled:opacity-50"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 3.33v9.34M3.33 8h9.34"
                  />
                </svg>
                Retry
              </button>
            </div>
          </div>
        ) : !activeId && !sessionsLoading && !sessionsError ? (
          /* Missing session — no conversation exists yet */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-sm px-4">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="mx-auto mb-4 text-[var(--color-text-muted)]"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
              <p className="text-sm text-[var(--color-text-secondary)] mb-4">
                No conversation available. Please create one.
              </p>
              <button
                type="button"
                onClick={handleNew}
                disabled={isCreating || navigationPending}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors disabled:cursor-wait disabled:opacity-50"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 3.33v9.34M3.33 8h9.34"
                  />
                </svg>
                New Conversation
              </button>
            </div>
          </div>
        ) : (
          <>
            <ChatMessages
              messages={chat.messages}
              isLoading={chat.isLoading}
              isStreaming={chat.isStreaming}
              streamActivity={chat.streamActivity}
              error={displayError}
              onRetry={handleRetry}
              onRevert={handleRevert}
              onDismissError={handleDismissError}
              permissions={chat.permissions}
              replyPermission={chat.replyPermission}
              questions={chat.questions}
              replyQuestion={chat.replyQuestion}
              onActivityOpen={openActivity}
              activitySelection={activitySelection}
              mcpProject={chatConfigProject}
            />
            {!activeId || !chat.sessionReady ? (
              <p role="status" className="px-4 pb-4 text-sm text-[var(--color-text-secondary)]">
                {chat.error ? "Conversation could not be loaded. Reload or choose another conversation before sending."
                  : sessionsLoading || isCreating || activeId ? "Loading conversation…" : "Choose or create a conversation to send a message."}
              </p>
            ) : <fieldset disabled={isCreating || navigationPending} className="contents" aria-label="Chat composer">
            <ChatInput
              projectControl={<ProjectDropdown placement="composer" />}
              renderConversationOptions={close => <>
                <ChatHeader presentation="menu" onAction={close}
                  sessionTitle={activeSession?.title ?? "Chat"}
                  onRename={handleRename}
                  onFork={handleFork}
                  onShare={handleShare}
                  onCompact={handleCompact}
                  shareState={shareState}
                  compactState={compactState}
                  providerId={providerId}
                  modelId={modelId}
                  agentName={agentName}
                  onProviderChange={handleProviderChange}
                  onModelChange={handleModelChange}
                  onAgentChange={setAgentName}
                  providers={availableProviders}
                  agents={availableAgents}
                  availableModels={currentModels}
                  isBusy={chat.isStreaming || chat.isLoading}
                  disabled={selectorsDisabled}
                  modelDisabled={!hasSelectableModel}
                  onMobileMenuOpen={handleMobileMenuOpen}
                  onMcpOpen={handleMcpOpen}
                  permissionCount={chat.permissions.length}
                  onCreateTask={handleCreateTask}
                  createTaskDisabled={taskCaptureDisabled}
                />
                {chatConfigProject && (
                  <div
                    className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-1.5 text-xs text-[var(--color-text-muted)]"
                    data-testid="chat-global-project"
                  >
                    <span>Chat tools run through global project:</span>
                    <code className="truncate font-mono text-[var(--color-text-secondary)]">{chatConfigProject}</code>
                  </div>
                )}
              </>}
              key={activeId}
              onSend={handleSend}
              onStop={handleStop}
              isLoading={chat.isStreaming || chat.isLoading}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              hasSelectableModel={hasSelectableModel}
              projectContextProject={selectedProject}
              memoryWorkspaceId={savedMemoryWorkspaceId}
              memoryCanRead={memoryCapabilities.canRead}
              memoryCanSave={memoryCapabilities.canSave}
              memoryUnavailableReason={memoryCapabilities.reason}
              memorySavePending={memoryNotice?.status === "queued"}
              showSuggestions={chat.messages.length === 0}
              modelControl={<Select aria-label="Chat model" value={modelId} onChange={(event) => handleModelChange(event.target.value)} disabled={selectorsDisabled || !hasSelectableModel} wrapperClassName="veyra-composer-model-wrap" className="veyra-composer-model">
                {!hasSelectableModel && <option value="">No model available</option>}
                {currentModels.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
              </Select>}
            />
            </fieldset>}
          </>
        )}
      </div>

      {/* MCP drawer */}
      <MCPDrawer
        isOpen={mcpDrawerOpen}
        onClose={() => setMcpDrawerOpen(false)}
        servers={mcpServers}
        error={mcpError}
        isRefreshing={mcpRefreshing}
        lastRefreshedAt={mcpLastRefreshedAt}
        project={chatConfigProject}
        pendingServerName={mcpActionPending}
        onRefresh={handleMcpRefresh}
        onConnect={(name) => changeMcpConnection(name, "connect")}
        onDisconnect={(name) => changeMcpConnection(name, "disconnect")}
      />
      <ActivityDrawer
        isOpen={activityOpen}
        selection={activitySelection}
        messages={chat.messages}
        onClose={closeActivity}
      />
      {activeId && (
        <TaskCaptureModal
          isOpen={taskCaptureOpen && taskCaptureSessionId === activeId}
          source={{ source_type: "chat", session_id: activeId }}
          onClose={handleTaskCaptureClose}
          onCaptured={handleTaskCaptured}
        />
      )}
    </div>
  );
}
