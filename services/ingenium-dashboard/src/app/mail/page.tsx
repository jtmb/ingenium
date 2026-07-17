"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import FolderSidebar from "./components/FolderSidebar";
import EmailList from "./components/EmailList";
import EmailReader from "./components/EmailReader";
import EmptyState from "./components/EmptyState";
import AccountSetup from "./components/AccountSetup";
import SyncProgress from "./components/SyncProgress";
import Overlay from "../components/Overlay";
import EmailComposer from "./components/EmailComposer";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";

/**
 * 🔴 Mail is always global — resolve the global project for all API calls.
 * The dashboard's active project selector does NOT affect mail.
 * This hook fetches the `is_global` project from the API on mount and
 * falls back to "global-default" if the API is unreachable.
 */
function useMailProject(): string {
  const [project, setProject] = useState("global-default");

  useEffect(() => {
    const API_URL = "http://localhost:4097/api/v1";
    fetch(`${API_URL}/projects`)
      .then(r => r.json())
      .then(data => {
        const global = data?.data?.find((p: any) => p.is_global);
        if (global?.name) setProject(global.name);
      })
      .catch(() => { /* fallback to global-default */ });
  }, []);

  return project;
}

interface EngineFolderState {
  bodiesCached: number;
  bodiesWindow: number;
}

interface SyncFolderStatus {
  folder: string;
  cachedCount: number;
  bodyCount: number;
  lastSyncedAt: string | null;
  syncing: boolean;
  engineState?: EngineFolderState;
}

interface SyncStatus {
  overall: "idle" | "syncing" | "done";
  account: string;
  totalFolders: number;
  syncingFolders: number;
  totalCached: number;
  totalBodies: number;
  folders: SyncFolderStatus[];
  engine?: any; // Raw EngineStatus from /sync-status response
}

/**
 * Inbox page — 3-pane layout: FolderSidebar | EmailList | EmailReader
 * Fetches accounts on mount, then emails for the selected folder.
 * Polls sync-status every 2s to show cache-warming progress.
 */
export default function MailPage() {
  const project = useMailProject();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [selectedFolder, setSelectedFolder] = useState("INBOX");
  const [selectedEmail, setSelectedEmail] = useState<any>(null);
  const [selectedEmailLoading, setSelectedEmailLoading] = useState(false);
  const [emails, setEmails] = useState<any[]>([]);
  const [emailSource, setEmailSource] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAccountSetup, setShowAccountSetup] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [sending, setSending] = useState(false);
  const [composeInitialData] = useState<{ to?: string; subject?: string; body?: string } | undefined>(undefined);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [folders, setFolders] = useState<any[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [emailPending, setEmailPending] = useState(false);
  const [emailDownloadError, setEmailDownloadError] = useState<string | null>(null);
  const [pendingEmailUid, setPendingEmailUid] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Resizable EmailList panel state
  const [listWidth, setListWidth] = useState(350);
  const [isResizing, setIsResizing] = useState(false);
  const handleRef = useRef<HTMLDivElement>(null);
  const listStartRef = useRef<{ startX: number; startWidth: number }>({ startX: 0, startWidth: 0 });

  // Resizable reply composer panel state (persisted in localStorage)
  const [replyWidth, setReplyWidth] = useState(420);

  useEffect(() => {
    const saved = localStorage.getItem("mail-list-width");
    if (saved) setListWidth(Math.min(720, Math.max(240, Number(saved))));
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("mail-reply-width");
    if (saved) {
      const val = Number(saved);
      setReplyWidth(val > 0 ? val : 420);
    }
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    handleRef.current?.setPointerCapture(e.pointerId);
    listStartRef.current = { startX: e.clientX, startWidth: listWidth };
    setIsResizing(true);
  }, [listWidth]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isResizing) return;
    const deltaX = e.clientX - listStartRef.current.startX;
    const newWidth = Math.max(240, Math.min(720, listStartRef.current.startWidth + deltaX));
    setListWidth(newWidth);
  }, [isResizing]);

  const onPointerUp = useCallback(() => {
    setIsResizing(false);
    setListWidth((w) => {
      localStorage.setItem("mail-list-width", String(w));
      return w;
    });
  }, []);

  // Fetch accounts on mount
  useEffect(() => {
    const fetchAccounts = async () => {
      setAccountsLoading(true);
      try {
        const res = await fetch(`${API_BASE}/emails/accounts?project=${project}&include_hidden=true`);
        if (res.ok) {
          const data = await res.json();
          const accts = data.data || [];
          setAccounts(accts);
          if (accts.length > 0 && !selectedAccount) {
            // Auto-select first visible (non-hidden) account
            const firstVisible = accts.find((a: any) => !a.hidden);
            if (firstVisible) {
              setSelectedAccount(firstVisible.id);
            }
          }
        }
      } catch {
        // API not available — show empty state
      } finally {
        setAccountsLoading(false);
      }
    };
    if (project) fetchAccounts();
  }, [project]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch folder list when account changes
  useEffect(() => {
    if (!selectedAccount || !project) return;
    fetch(`${API_BASE}/emails/folders?project=${project}&account=${selectedAccount}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data) setFolders(d.data.filter((f: any) => !f.flags?.some((fl: string) => /noselect/i.test(fl)) && f.name !== "[Gmail]")); })
      .catch(() => setFolders([]));
  }, [selectedAccount, project]);

  // Poll sync status every 2 seconds
  useEffect(() => {
    if (!selectedAccount) {
      setSyncStatus(null);
      return;
    }

    const pollSync = async () => {
      try {
        const res = await fetch(
          `${API_BASE}/emails/sync-status?project=${project}&account=${selectedAccount}`,
        );
        if (res.ok) {
          const data = await res.json();
          setSyncStatus(data.data);
        }
      } catch {
        // Silently fail — sync status is non-critical
      }
    };

    pollSync(); // Immediate first poll
    const interval = setInterval(pollSync, 2000);
    return () => clearInterval(interval);
  }, [selectedAccount, project]);

  // Cleanup polling interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  // Fetch emails when account/folder/page/search changes
  // Server-side DB cache serves sub-2ms — no need for in-memory cache
  useEffect(() => {
    if (!selectedAccount) return;

    const fetchEmails = async () => {
      setLoading(true);
      try {
        let url: string;
        if (searchQuery) {
          url = `${API_BASE}/emails/search?project=${project}&q=${encodeURIComponent(searchQuery)}&account=${selectedAccount}`;
        } else {
          url = `${API_BASE}/emails?project=${project}&folder=${encodeURIComponent(selectedFolder)}&account=${selectedAccount}&page=${page}&limit=50`;
        }
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setEmails(data.data || []);
          setTotal(data.total || 0);
          setEmailSource(data.source || "");
          setEmailError(null);
        } else {
          const errData = await res.json().catch(() => ({ error: { message: "Failed to load emails" } }));
          setEmails([]);
          setTotal(0);
          setEmailSource("");
          setEmailError(errData.error?.message || "Failed to load emails");
        }
      } catch {
        setEmails([]);
        setTotal(0);
        setEmailSource("");
        setEmailError("Failed to load emails");
      } finally {
        setLoading(false);
      }
    };
    fetchEmails();
  }, [selectedAccount, selectedFolder, page, searchQuery, refreshKey, project]);

  // Re-fetch emails when sync status shows selected folder transitioned from syncing → done/error
  useEffect(() => {
    const status = syncStatus?.folders?.find((f: any) => f.folder === selectedFolder);
    if (!status) return;
    if (emailSource === "pending" && !status.syncing) {
      setRefreshKey(k => k + 1);
    }
  }, [syncStatus, selectedFolder, emailSource]);

  const handleSelectEmail = useCallback(async (uid: string) => {
    // Guard: re-clicking the already-open email must not reset state
    // Prevents a flash when the user clicks the same email again.
    if (selectedEmail?.uid === uid) return;

    // Cancel any existing poll
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    setSelectedEmailLoading(true);
    setEmailPending(false);
    setEmailDownloadError(null);
    setSelectedEmail(null);
    setPendingEmailUid(uid);

    try {
      const url = `${API_BASE}/emails/${uid}?project=${project}&account=${selectedAccount}&folder=${encodeURIComponent(selectedFolder)}`;
      const res = await fetch(url);

      if (res.status === 202) {
        // Email body not cached yet — poll until it is
        setSelectedEmailLoading(false);
        setEmailPending(true);

        const pollStart = Date.now();
        const MAX_POLL_MS = 20000;

        pollRef.current = setInterval(async () => {
          try {
            const pollRes = await fetch(url);
            if (pollRes.ok) {
              const pollData = await pollRes.json();
              setSelectedEmail(pollData.data);
              setEmailPending(false);
              setPendingEmailUid(null);
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
              return;
            }
          } catch {
            // Retry on next tick
          }

          if (Date.now() - pollStart >= MAX_POLL_MS) {
            setEmailPending(false);
            setEmailDownloadError("Could not load this email — try again later");
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
          }
        }, 1500);

        return;
      }

      if (res.ok) {
        const data = await res.json();
        setSelectedEmail(data.data);
        setPendingEmailUid(null);
      }
    } catch {
      setEmailDownloadError("Could not load this email — try again later");
    } finally {
      setSelectedEmailLoading(false);
    }
  }, [selectedAccount, selectedFolder, project]);

  const handleCompose = useCallback(() => {
    setShowCompose(true);
  }, []);

  // handleReply and handleDraft removed — EmailReader now handles reply/draft inline (FIX 2)
  // composeInitialData stays undefined (always; kept for modal JXS identity but unused)

  const handleComposeSend = useCallback(async (data: any) => {
    setSending(true);
    try {
      const body: Record<string, any> = { account: data.accountId, subject: data.subject };
      if (data.to) body.to = data.to.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
      if (data.cc) body.cc = data.cc.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
      if (data.bcc) body.bcc = data.bcc.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
      if (data.html) body.html = data.html;
      if (data.text) body.text = data.text;

      const res = await fetch(`${API_BASE}/emails?project=${project}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowCompose(false);
        setRefreshKey(k => k + 1);
      } else {
        const errData = await res.json().catch(() => ({ error: { message: "Send failed" } }));
        alert(errData.error?.message || "Failed to send");
      }
    } catch (err: any) {
      alert(err.message || "Failed to send");
    } finally {
      setSending(false);
    }
  }, [selectedAccount, project]);

  const handleComposeSave = useCallback(async (data: any) => {
    try {
      const body: Record<string, any> = { account: data.accountId, subject: data.subject };
      if (data.to) body.to = data.to.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
      if (data.cc) body.cc = data.cc.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
      if (data.bcc) body.bcc = data.bcc.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
      if (data.html) body.html = data.html;
      if (data.text) body.text = data.text;

      const res = await fetch(`${API_BASE}/emails/draft?project=${project}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowCompose(false);
        setRefreshKey(k => k + 1);
      } else {
        const errData = await res.json().catch(() => ({ error: { message: "Save failed" } }));
        alert(errData.error?.message || "Failed to save draft");
      }
    } catch (err: any) {
      alert(err.message || "Failed to save draft");
    }
  }, [project]);

  const handleComposeCancel = useCallback(() => {
    setShowCompose(false);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!selectedEmail) return;
    try {
      await fetch(`${API_BASE}/emails/${selectedEmail.uid}?project=${project}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: selectedAccount }),
      });
      setSelectedEmail(null);
      setRefreshKey(k => k + 1);
      setPage(1);
    } catch {
      // Silently fail
    }
  }, [selectedEmail, selectedAccount, project]);

  const handleArchive = useCallback(async () => {
    if (!selectedEmail) return;
    try {
      await fetch(`${API_BASE}/emails/${selectedEmail.uid}/move?project=${project}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: selectedAccount, fromFolder: selectedFolder, toFolder: "Archive" }),
      });
      setSelectedEmail(null);
      setRefreshKey(k => k + 1);
    } catch {
      // Silently fail
    }
  }, [selectedEmail, selectedAccount, project]);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    setPage(1);
  }, []);

  const handleSelectAccount = useCallback((accountId: string) => {
    setSelectedAccount(accountId);
    setSelectedFolder("INBOX");
    setSelectedEmail(null);
    setPage(1);
    setSearchQuery("");
    setEmailError(null);
  }, []);

  const handleDeleteAccount = useCallback(async (accountId: string) => {
    setDeleteAccountId(accountId);
  }, []);

  const handleHideAccount = useCallback(async (accountId: string) => {
    try {
      await fetch(`${API_BASE}/emails/accounts/${accountId}?project=${project}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: true }),
      });
      // Refresh account list
      const res = await fetch(`${API_BASE}/emails/accounts?project=${project}&include_hidden=true`);
      if (res.ok) {
        const data = await res.json();
        const accts = data.data || [];
        setAccounts(accts);
        // If the hidden account was selected, auto-select the next visible account
        if (selectedAccount === accountId) {
          const nextVisible = accts.find((a: any) => !a.hidden);
          if (nextVisible) {
            setSelectedAccount(nextVisible.id);
          } else {
            setSelectedAccount("");
          }
          setSelectedEmail(null);
          setEmails([]);
        }
      }
    } catch { /* non-fatal */ }
  }, [selectedAccount, project]);

  const handleShowAccount = useCallback(async (accountId: string) => {
    try {
      await fetch(`${API_BASE}/emails/accounts/${accountId}?project=${project}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: false }),
      });
      // Refresh account list
      const res = await fetch(`${API_BASE}/emails/accounts?project=${project}&include_hidden=true`);
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.data || []);
        // Select the newly-shown account
        setSelectedAccount(accountId);
        setSelectedFolder("INBOX");
        setSelectedEmail(null);
        setPage(1);
        setSearchQuery("");
        setEmailError(null);
      }
    } catch { /* non-fatal */ }
  }, [project]);

  const confirmDeleteAccount = useCallback(async () => {
    if (!deleteAccountId) return;
    setDeletingAccount(true);
    try {
      await fetch(`${API_BASE}/emails/accounts/${deleteAccountId}?project=${project}`, { method: "DELETE" });
      // Refresh account list with hidden included
      const accountsRes = await fetch(`${API_BASE}/emails/accounts?project=${project}&include_hidden=true`);
      if (accountsRes.ok) {
        const data = await accountsRes.json();
        const accts = data.data || [];
        setAccounts(accts);
        if (selectedAccount === deleteAccountId) {
          // Auto-select next visible account
          const nextVisible = accts.find((a: any) => !a.hidden);
          setSelectedAccount(nextVisible ? nextVisible.id : "");
          setSelectedEmail(null);
          setEmails([]);
        }
      }
      // Also refresh health status — trigger a service status re-fetch
      fetch(`${API_BASE}/services/status?project=${project}`).catch(() => {});
    } catch { /* non-fatal */ }
    setDeletingAccount(false);
    setDeleteAccountId(null);
  }, [deleteAccountId, selectedAccount, project]);

  const handleSelectFolder = useCallback((folder: string) => {
    setSelectedFolder(folder);
    setSelectedEmail(null);
    setPage(1);
    setSearchQuery("");
    setEmailError(null);

    // Fire-and-forget cache boost hint — the /sync route calls boostFolder internally
    fetch(`${API_BASE}/emails/sync?project=${project}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account: selectedAccount, folder }),
    }).catch(() => {});
  }, [selectedAccount, project]);

  const handleRefresh = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true);
    try {
      const url = searchQuery
        ? `${API_BASE}/emails/search?project=${project}&q=${encodeURIComponent(searchQuery)}&account=${selectedAccount}&refresh=true`
        : `${API_BASE}/emails?project=${project}&folder=${encodeURIComponent(selectedFolder)}&account=${selectedAccount}&page=${page}&limit=50&refresh=true`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setEmails(data.data || []);
        setTotal(data.total || 0);
        setEmailSource(data.source || "");
        setEmailError(null);
      } else {
        const errData = await res.json().catch(() => ({ error: { message: "Refresh failed" } }));
        setEmailError(errData.error?.message || "Refresh failed");
      }
    } catch {
      setEmailError("Refresh failed");
    } finally {
      setLoading(false);
      setRefreshKey(prev => prev + 1);
    }
  }, [selectedAccount, selectedFolder, page, searchQuery, project, setRefreshKey]);

  // Derived computed values for cold-state gating and folder sync indicators
  const syncingFolders = syncStatus?.folders?.filter((f: any) => f.syncing).map((f: any) => f.folder) ?? [];
  const inboxFolderStatus = syncStatus?.folders?.find((f: any) => f.folder === "INBOX");
  const isInboxCold = syncStatus !== null && syncStatus.overall === "syncing" && inboxFolderStatus?.cachedCount === 0;
  const selectedFolderStatus = syncStatus?.folders?.find((f: any) => f.folder === selectedFolder);
  const isColdFolder = !loading && emails.length === 0 && selectedFolderStatus?.cachedCount === 0 && selectedFolderStatus?.syncing === true;

  // Detect auth errors from the engine's raw status
  const engineFolders = syncStatus?.engine?.accounts?.[0]?.folders ?? [];
  const hasAuthError = engineFolders.some((f: any) =>
    f.state === "error" && (
      typeof f.lastError === "string" &&
      /auth|re-authenticat|credential.*(decrypt|reconn)/i.test(f.lastError)
    )
  ) || (
    syncStatus !== null &&
    (syncStatus.folders?.length ?? 0) > 0 &&
    syncStatus.folders!.every((f: any) => f.engineState === "error") &&
    syncStatus.folders!.every((f: any) => f.cachedCount === 0)
  );

  const handleReconnect = useCallback(() => {
    setShowAccountSetup(true);
  }, []);

  // Loading — accounts are still being fetched
  if (accountsLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-6">Mail</h1>
        <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Loading accounts…</span>
        </div>
      </div>
    );
  }

  // No accounts — show empty / setup state
  if (accounts.length === 0 && !showAccountSetup && !accountsLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-6">Mail</h1>
        <EmptyState
          message="No email accounts configured"
          action={{ label: "Add Account", onClick: () => setShowAccountSetup(true) }}
        />
      </div>
    );
  }

  if (showAccountSetup) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-6">Mail</h1>
        <AccountSetup
          onComplete={async () => {
            setShowAccountSetup(false);
            try {
              const res = await fetch(`${API_BASE}/emails/accounts?project=${project}&include_hidden=true`);
              if (res.ok) {
                const data = await res.json();
                setAccounts(data.data || []);
                if (data.data?.length > 0) {
                  // Auto-select first visible account
                  const firstVisible = data.data.find((a: any) => !a.hidden);
                  if (firstVisible) setSelectedAccount(firstVisible.id);
                }
              }
            } catch {}
          }}
          onCancel={() => setShowAccountSetup(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-6">Mail</h1>

      {/* Show progress view until cache has data, then show mail UI */}
      {syncStatus && syncStatus.totalCached === 0 ? (
        <SyncProgress
          folders={syncStatus.folders.map((f: any) => ({
            folder: f.folder,
            cachedCount: f.engineState?.headersSynced ?? f.cachedCount ?? 0,
            bodyCount: f.engineState?.bodiesCached ?? f.bodyCount ?? 0,
            syncing: f.syncing,
            headersTotal: f.engineState?.headersTotal ?? f.engineState?.headersSynced ?? f.cachedCount ?? 0,
            headersSynced: f.engineState?.headersSynced ?? f.cachedCount ?? 0,
            bodiesCached: f.engineState?.bodiesCached ?? f.bodyCount ?? 0,
            bodiesWindow: f.engineState?.bodiesWindow ?? 200,
            state: f.engineState?.state ?? (f.syncing ? "syncing-headers" : (f.bodyCount > 0 ? "complete" : "idle")),
          }))}
          syncingFolders={syncStatus.syncingFolders}
          totalCached={syncStatus.totalCached}
          hasAuthError={hasAuthError}
          onReconnect={handleReconnect}
        />
      ) : (
        <>
          {/* Auth error banner — visible above the mail UI when account needs reconnection */}
          {hasAuthError && (
            <div className="p-4 border border-amber-300 bg-amber-50 rounded-lg flex items-center justify-between">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 text-amber-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-amber-800">
                    Your email account needs re-authentication.
                  </p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    The stored credentials could not be decrypted. Please reconnect your account.
                  </p>
                </div>
              </div>
              <button
                onClick={handleReconnect}
                className="shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Reconnect
              </button>
            </div>
          )}
          <div className="flex h-[calc(100dvh-180px)] border border-[var(--color-border)] rounded bg-[var(--color-surface)] overflow-hidden">
          {/* Folder sidebar */}
          <FolderSidebar
            accounts={accounts}
            selectedAccount={selectedAccount}
            selectedFolder={selectedFolder}
            onSelectFolder={handleSelectFolder}
            onSelectAccount={handleSelectAccount}
            onCompose={handleCompose}
            onAddAccount={() => setShowAccountSetup(true)}
            onDeleteAccount={handleDeleteAccount}
            onHideAccount={handleHideAccount}
            onShowAccount={handleShowAccount}
            folders={folders}
            syncingFolders={syncingFolders}
            folderSyncStatuses={syncStatus?.folders ?? []}
          />

            {/* Email list + reader — resizable split */}
            <div className="flex items-stretch relative flex-1 min-w-0">
              <EmailList
                emails={emails}
                selectedUid={selectedEmail?.uid}
                onSelect={handleSelectEmail}
                onPageChange={setPage}
                total={total}
                page={page}
                loading={loading}
                onSearch={handleSearch}
                error={emailError}
                onRefresh={handleRefresh}
                source={emailSource}
                width={listWidth}
              />

              {/* Resize handle */}
              <div
                ref={handleRef}
                role="separator"
                aria-valuenow={listWidth}
                aria-valuemin={240}
                aria-valuemax={720}
                aria-label="Resize email list"
                tabIndex={0}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onKeyDown={(e) => {
                  if (e.key === "ArrowRight") {
                    setListWidth(w => { const nw = Math.min(720, w + 20); localStorage.setItem("mail-list-width", String(nw)); return nw; });
                  }
                  if (e.key === "ArrowLeft") {
                    setListWidth(w => { const nw = Math.max(240, w - 20); localStorage.setItem("mail-list-width", String(nw)); return nw; });
                  }
                }}
                className={`w-2 cursor-col-resize hover:bg-blue-200 active:bg-blue-400 transition-colors shrink-0 ${isResizing ? "bg-blue-400" : "bg-transparent"}`}
              />

              {/* Email reader — inline reply/draft + summarise (FIX 2/3/4) */}
              <EmailReader
                email={selectedEmail}
                loading={selectedEmailLoading}
                downloading={emailPending}
                downloadError={emailDownloadError}
                onRetry={() => {
                  if (pendingEmailUid) handleSelectEmail(pendingEmailUid);
                }}
                accountId={selectedAccount}
                project={project}
                onForward={handleCompose}
                onDelete={handleDelete}
                onArchive={handleArchive}
                accounts={accounts}
                selectedAccount={selectedAccount}
                onComposeSend={handleComposeSend}
                onComposeSave={handleComposeSave}
                replyWidth={replyWidth}
                onReplyWidthChange={(w) => {
                  setReplyWidth(w);
                  localStorage.setItem("mail-reply-width", String(w));
                }}
              />
            </div>
          </div>

          {/* Compose overlay — for New/Forward ONLY (Reply/Draft now inline in EmailReader) */}
          <Overlay
            isOpen={showCompose}
            onClose={handleComposeCancel}
            title="Compose"
            fullScreen
          >
            <EmailComposer
              accounts={accounts}
              initialAccountId={selectedAccount}
              initialData={composeInitialData}
              onSend={handleComposeSend}
              onSave={handleComposeSave}
              onCancel={handleComposeCancel}
              project={project}
            />
            {sending && (
              <p className="text-sm text-[var(--color-text-muted)] text-center mt-4">Sending...</p>
            )}
          </Overlay>

          {/* Delete account confirmation */}
          <Overlay
            isOpen={deleteAccountId !== null}
            onClose={() => setDeleteAccountId(null)}
            title="Remove Account"
            subtitle="This cannot be undone."
          >
            {deleteAccountId && (
              <div className="space-y-4">
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Are you sure you want to remove{' '}
                  <strong>{accounts.find((a: any) => a.id === deleteAccountId)?.email || deleteAccountId}</strong>?
                  {' '}All cached emails for this account will be removed.
                </p>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setDeleteAccountId(null)} className="px-4 py-2 border border-[var(--color-border)] rounded text-sm hover:bg-[var(--color-surface-hover)]">
                    Cancel
                  </button>
                  <button
                    onClick={confirmDeleteAccount}
                    disabled={deletingAccount}
                    className={`px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700 ${deletingAccount ? "opacity-60 cursor-not-allowed" : ""}`}
                  >
                    {deletingAccount ? "Removing..." : "Remove"}
                  </button>
                </div>
              </div>
            )}
          </Overlay>
        </>
      )}
    </div>
  );
}
