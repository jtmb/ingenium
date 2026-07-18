"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import ChatSessionSidebar from "./ChatSessionSidebar";
import ChatHeader from "./ChatHeader";
import ChatMessages from "./ChatMessages";
import ChatInput, { type Attachment } from "./ChatInput";
import MCPDrawer from "./MCPDrawer";
import { useOpenCodeSessions } from "../../../lib/use-opencode-sessions";
import { useOpenCodeChat } from "../../../lib/use-opencode-chat";
import { opencode } from "../../../lib/opencode";
import { api, type ChatConfigResponse } from "../../../lib/api";

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
  const [mcpDrawerOpen, setMcpDrawerOpen] = useState(false);
  const [mcpServers, setMcpServers] = useState<
    Array<{ name: string; connected: boolean; toolCount?: number }>
  >([]);

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

  /* ---- Provider / Model / Agent selection ---- */
  const [providerId, setProviderId] = useState<string>("");
  const [modelId, setModelId] = useState<string>("");
  const [agentName, setAgentName] = useState("ingenium-chat");

  // Fetch sanitized chat config from the API
  const providersInitialized = useRef(false);
  useEffect(() => {
    let cancelled = false;
    async function loadChatConfig() {
      try {
        setChatConfigLoading(true);
        setChatConfigError(null);
        const result = await api.settings.chatConfig();
        if (cancelled) return;
        setChatConfig(result.data);
      } catch (err) {
        if (cancelled) return;
        setChatConfigError(err instanceof Error ? err.message : "Failed to load chat config");
      } finally {
        if (!cancelled) setChatConfigLoading(false);
      }
    }
    loadChatConfig();
    return () => { cancelled = true; };
  }, []);

  // Initialize provider/model from chat config once loaded
  useEffect(() => {
    if (providersInitialized.current) return;
    if (!chatConfig || chatConfigLoading) return;
    providersInitialized.current = true;

    if (chatConfig.defaultSelection) {
      setProviderId(chatConfig.defaultSelection.providerId);
      setModelId(chatConfig.defaultSelection.modelId);
    } else if (chatConfig.configured && chatConfig.primary) {
      // Fallback to legacy primary for backward compat
      setProviderId(chatConfig.primary.providerId);
      setModelId(chatConfig.primary.modelId);
    }
  }, [chatConfig, chatConfigLoading]);

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

  /** Disable selectors during loading, errors, or when no selectable model. */
  const selectorsDisabled = chatConfigLoading || !!chatConfigError || !hasSelectableModel;

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
  const refreshMcpStatus = useCallback(async () => {
    try {
      const raw = await opencode.mcp.status();
      if (!raw || Object.keys(raw).length === 0) {
        setMcpServers([]);
        return;
      }
      const servers = Object.entries(raw).map(([name, info]) => {
        const serverInfo = info as Record<string, unknown>;
        return {
          name,
          connected: Boolean(serverInfo.connected),
          toolCount:
            typeof serverInfo.tools === "number"
              ? serverInfo.tools
              : typeof serverInfo.toolCount === "number"
                ? serverInfo.toolCount
                : undefined,
        };
      });
      setMcpServers(servers);
    } catch {
      // MCP endpoint may not be available — silently ignore
    }
  }, []);

  // Refresh on mount and after drawer closes (covers connect/disconnect)
  useEffect(() => {
    refreshMcpStatus();
  }, [refreshMcpStatus]);

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
    async (text: string, _systemPrompt: string) => {
      if (!activeId) return;
      if (!hasSelectableModel || !providerId || !modelId) return;

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

      await chat.send(parts, {
        model: { providerID: providerId, modelID: modelId },
        agent: agentName,
      });

      // Clear attachments after successful send
      setAttachments([]);

      // Update session title from first message
      if (shouldRename) {
        const title =
          text.length > 50 ? `${text.slice(0, 47)}...` : text;
        await rename(activeId, title);
      }
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
        <div className="md:hidden fixed inset-0 z-40 flex">
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
      <div className="flex-1 flex-col min-w-0 flex">
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
          onProviderChange={(p) => {
            setProviderId(p);
            const provider = (chatConfig?.providers ?? []).find(
              (pr) => pr.providerId === p,
            );
            if (provider && provider.models.length > 0) {
              setModelId(provider.defaultModel || provider.models[0]!.id);
            }
          }}
          onModelChange={setModelId}
          onAgentChange={setAgentName}
          providers={availableProviders}
          agents={availableAgents}
          availableModels={currentModels}
          isBusy={chat.isStreaming || chat.isLoading}
          disabled={selectorsDisabled}
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
        <ChatMessages
          messages={chat.messages}
          isLoading={chat.isLoading}
          isStreaming={chat.isStreaming}
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
      </div>

      {/* MCP drawer */}
      <MCPDrawer
        isOpen={mcpDrawerOpen}
        onClose={() => setMcpDrawerOpen(false)}
        servers={mcpServers}
        onConnect={async (name) => {
          try {
            await opencode.mcp.connect(name);
          } catch {
            // Best-effort — non-fatal
          }
          await refreshMcpStatus();
        }}
        onDisconnect={async (name) => {
          try {
            await opencode.mcp.disconnect(name);
          } catch {
            // Best-effort — non-fatal
          }
          await refreshMcpStatus();
        }}
      />
    </div>
  );
}
