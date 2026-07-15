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
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [emailPending, setEmailPending] = useState(false);
  const [emailDownloadError, setEmailDownloadError] = useState<string | null>(null);
  const [pendingEmailUid, setPendingEmailUid] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch accounts on mount
  useEffect(() => {
    const fetchAccounts = async () => {
      setAccountsLoading(true);
      try {
        const res = await fetch(`${API_BASE}/emails/accounts?project=${project}`);
        if (res.ok) {
          const data = await res.json();
          const accts = data.data || [];
          setAccounts(accts);
          if (accts.length > 0 && !selectedAccount) {
            setSelectedAccount(accts[0].id);
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

  const handleSelectEmail = useCallback(async (uid: string) => {
    // DP#32: guard — re-clicking the already-open email must not reset state
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
      if (data.body) body.text = data.body;

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
      if (data.body) body.text = data.body;

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

  const confirmDeleteAccount = useCallback(async () => {
    if (!deleteAccountId) return;
    try {
      await fetch(`${API_BASE}/emails/accounts/${deleteAccountId}?project=${project}`, { method: "DELETE" });
      // Refresh account list
      const accountsRes = await fetch(`${API_BASE}/emails/accounts?project=${project}`);
      if (accountsRes.ok) {
        const data = await accountsRes.json();
        const accts = data.data || [];
        setAccounts(accts);
        if (selectedAccount === deleteAccountId) {
          setSelectedAccount(accts.length > 0 ? accts[0].id : "");
        }
      }
    } catch { /* non-fatal */ }
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
              const res = await fetch(`${API_BASE}/emails/accounts?project=${project}`);
              if (res.ok) {
                const data = await res.json();
                setAccounts(data.data || []);
                if (data.data?.length > 0) {
                  setSelectedAccount(data.data[0].id);
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
        />
      ) : (
        <>
          <div className="flex h-[calc(100vh-180px)] border border-[var(--color-border)] rounded bg-[var(--color-surface)] overflow-hidden">
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
              folders={folders}
              syncingFolders={syncingFolders}
              folderSyncStatuses={syncStatus?.folders ?? []}
            />

            {/* Email list */}
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
            />
          </div>

          {/* Compose overlay — for New/Forward ONLY (Reply/Draft now inline in EmailReader) */}
          <Overlay
            isOpen={showCompose}
            onClose={handleComposeCancel}
            title="Compose"
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
                  <button onClick={confirmDeleteAccount} className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700">
                    Remove
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
