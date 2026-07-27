"use client";

import { useState, useCallback, useEffect, useRef, useId } from "react";
import Link from "next/link";
import ChatSessionSidebar from "./ChatSessionSidebar";
import ChatHeader from "./ChatHeader";
import ChatMessages from "./ChatMessages";
import ChatInput, { type Attachment } from "./ChatInput";
import MCPDrawer from "./MCPDrawer";
import {
  normalizeMcpServers,
  type McpServerView,
} from "./mcp-status";
import { useOpenCodeSessions } from "../../../lib/use-opencode-sessions";
import { useOpenCodeChat } from "../../../lib/use-opencode-chat";
import { opencode } from "../../../lib/opencode";
import { api, ApiError, type ChatConfigResponse } from "../../../lib/api";

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
export default function ChatShell() {
  /* ---- Layout state ---- */
  const [collapsed, setCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [shareState, setShareState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [compactState, setCompactState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [compactError, setCompactError] = useState<string | null>(null);

  /* ---- Auto-collapse sidebar on smaller screens ---- */
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279px)");
    const handler = (e: MediaQueryListEvent | MediaQueryList) =>
      setCollapsed(e.matches);
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
  const [mcpActionPending, setMcpActionPending] = useState<string | null>(null);

  /* ---- OpenCode hooks ---- */
  const {
    sessions,
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
  } = useOpenCodeSessions();

  const chat = useOpenCodeChat(activeId);

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
  const [chatConfigLoading, setChatConfigLoading] = useState(true);
  const [chatConfigError, setChatConfigError] = useState<string | null>(null);

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
      if (!isRetry) setChatConfigError(null);
      const result = await api.settings.chatConfig();
      setChatConfig(result.data);
      // Success clears any active rate-limit state
      clearRateLimit();
      return result.data;
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
  }, [clearRateLimit]);

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
    fetchChatConfig();
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recover a usable pair whenever a refreshed catalog invalidates the current
  // selection. Provider and model share one state update so a provider switch
  // cannot render or persist a transient cross-provider model pairing.
  useEffect(() => {
    if (!chatConfig || chatConfigLoading) return;
    const currentProvider = chatConfig.providers.find((candidate) => candidate.providerId === providerId);
    if (currentProvider?.models.some((model) => model.id === modelId)) return;
    const preferred = chatConfig.defaultSelection
      ?? (chatConfig.configured && chatConfig.primary
        ? { providerId: chatConfig.primary.providerId, modelId: chatConfig.primary.modelId }
        : null);
    const provider = chatConfig.providers.find((candidate) => candidate.providerId === preferred?.providerId)
      ?? chatConfig.providers.find((candidate) => candidate.models.length > 0);
    if (!provider) {
      if (providerId || modelId) setSelection({ providerId: "", modelId: "" });
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
  }, [chatConfig, chatConfigLoading, modelId, providerId]);

  /* ---- Attachment state ---- */
  const [attachments, setAttachments] = useState<Attachment[]>([]);

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
        await api.settings.saveChatSelection({ providerId: nextProviderId, modelId: nextModelId });
      } catch {
        // The local Chat turn remains usable. Docs AI will use the last
        // validated server selection or server-derived default until a later
        // queued selection succeeds.
      }
    };
    selectionSaveQueueRef.current = selectionSaveQueueRef.current.then(persist, persist);
  }, [chatConfig]);

  /** Provider recovery remains available when only the selected model is stale. */
  // A missing default must not disable recovery when the catalog still offers
  // providers. Only an empty catalog disables the provider and agent selectors.
  const selectorsDisabled = chatConfigLoading || !!chatConfigError
    || rateLimitSeconds !== null || availableProviders.length === 0;

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

  /* ---- Derived session data ---- */
  const activeSession = sessions.find((s) => s.id === activeId);

  /** Sessions in the sidebar-compatible shape. */
  const sidebarSessions = sessions.map((s) => ({
    id: s.id,
    title: s.title,
    updatedAt: s.time.updated,
  }));

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
      return true;
    } catch {
      setMcpError("Unable to refresh MCP server status. Try again.");
      return false;
    } finally {
      setMcpRefreshing(false);
    }
  }, []);

  // Refresh on mount and after drawer closes (covers connect/disconnect)
  useEffect(() => {
    void refreshMcpStatus();
  }, [refreshMcpStatus]);

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

  /** Auto-focus the first focusable element in the mobile drawer when it opens. */
  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const timer = setTimeout(() => {
      const drawer = drawerRef.current;
      if (!drawer) return;
      const firstFocusable = drawer.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      firstFocusable?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [mobileDrawerOpen]);

  /* ---- Session handlers ---- */

  const handleNew = useCallback(async () => {
    await create("New conversation");
    setMobileDrawerOpen(false);
  }, [create]);

  const handleSelect = useCallback(
    (id: string) => {
      select(id);
      setMobileDrawerOpen(false);
    },
    [select],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await removeSession(id);
    },
    [removeSession],
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
    async (text: string, _systemPrompt: string): Promise<boolean> => {
      if (!activeId) return false;
      if (!hasSelectableModel || !providerId || !modelId) return false;

      const shouldRename =
        wasFirstMessage.current &&
        activeSession?.title === "New conversation";

      // Build parts array: text part + file parts from attachments
      const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; url: string; filename?: string }> = [
        { type: "text", text },
      ];

      for (const att of attachments) {
        parts.push({
          type: "file",
          mime: att.mime,
          url: att.dataUrl || `file:///workspace/uploads/${att.name}`,
          filename: att.name,
        });
      }

      try {
        await chat.send(parts, {
          model: { providerID: providerId, modelID: modelId },
          agent: agentName,
        });
      } catch {
        // send() handles its own error dispatch
      }

      // Clear attachments after successful send
      setAttachments([]);

      // Update session title from first message (best-effort - do not block)
      if (shouldRename) {
        const title =
          text.length > 50 ? `${text.slice(0, 47)}...` : text;
        rename(activeId, title).catch(() => {});
      }

      return true;
    },
    [activeId, activeSession, chat, rename, attachments, providerId, modelId, agentName, hasSelectableModel],
  );

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
    await chat.retry();
  }, [chat]);

  /** Send a reply to the agent's structured question as a regular prompt. */
  const handleSendReply = useCallback(
    async (text: string) => {
      if (!activeId) return;
      const parts: Array<{ type: "text"; text: string }> = [
        { type: "text", text },
      ];
      await chat.send(parts, {
        model: { providerID: providerId, modelID: modelId },
        agent: agentName,
      });
    },
    [activeId, chat, providerId, modelId, agentName],
  );

  const handleRevert = useCallback(
    async (messageId: string, partId?: string) => {
      await chat.revert(messageId, partId);
    },
    [chat],
  );

  /* ---- Rendering ---- */

  return (
    <div className="flex h-full min-h-0">
      {/* Sidebar — hidden on mobile, visible as drawer overlay instead */}
      <div className="hidden md:flex">
        <ChatSessionSidebar
          sessions={sidebarSessions}
          activeId={activeId}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onNew={handleNew}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          isLoading={sessionsLoading}
          sessionsError={sessionsError}
        />
      </div>

      {/* Mobile drawer overlay */}
      {mobileDrawerOpen && (
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Chat sessions"
          className="md:hidden fixed inset-0 z-40 flex"
        >
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileDrawerOpen(false)}
            aria-hidden="true"
          />
          <div className="relative z-50 w-[280px] h-full bg-[var(--color-nav-bg)] shadow-xl">
            <ChatSessionSidebar
              sessions={sidebarSessions}
              activeId={activeId}
              onSelect={handleSelect}
              onDelete={handleDelete}
              onNew={handleNew}
              collapsed={false}
              onToggle={() => setMobileDrawerOpen(false)}
              isDrawer
              isLoading={sessionsLoading}
              sessionsError={sessionsError}
            />
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex-col min-w-0 min-h-0 flex">
        <ChatHeader
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
          onMobileMenuOpen={() => setMobileDrawerOpen(true)}
          onMcpOpen={() => setMcpDrawerOpen(true)}
          permissionCount={chat.permissions.length}
        />
        {/* No-LLM-configured warning */}
        {!hasSelectableModel && !chatConfigLoading && !chatConfigError && (
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
              onSendReply={handleSendReply}
            />
            {/* Disabled composer — waiting for auto-created session */}
            <div className="shrink-0 px-4 pb-4 pt-2 w-full">
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
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
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
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors"
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
              onSendReply={handleSendReply}
            />
            <ChatInput
              onSend={handleSend}
              onStop={handleStop}
              isLoading={chat.isStreaming || chat.isLoading}
              attachments={attachments}
              onAttachmentsChange={setAttachments}
              hasSelectableModel={hasSelectableModel}
            />
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
        pendingServerName={mcpActionPending}
        onRefresh={() => refreshMcpStatus()}
        onConnect={(name) => changeMcpConnection(name, "connect")}
        onDisconnect={(name) => changeMcpConnection(name, "disconnect")}
      />
    </div>
  );
}
