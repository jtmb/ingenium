"use client";

import { useState, useEffect, useCallback } from "react";
import FolderSidebar from "./components/FolderSidebar";
import EmailList from "./components/EmailList";
import EmailReader from "./components/EmailReader";
import EmptyState from "./components/EmptyState";
import AccountSetup from "./components/AccountSetup";
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

interface SyncFolderStatus {
  folder: string;
  cachedCount: number;
  bodyCount: number;
  lastSyncedAt: string | null;
  syncing: boolean;
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
  const [emailError, setEmailError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [folders, setFolders] = useState<any[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [deleteAccountId, setDeleteAccountId] = useState<string | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);

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
      .then(d => { if (d?.data) setFolders(d.data.filter((f: any) => f.name !== "[Gmail]")); })
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

  const handleSelectEmail = useCallback(async (uid: number) => {
    setSelectedEmailLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/emails/${uid}?project=${project}&account=${selectedAccount}&folder=${encodeURIComponent(selectedFolder)}`
      );
      if (res.ok) {
        const data = await res.json();
        setSelectedEmail(data.data);
      }
    } catch {
      // Keep current selection
    } finally {
      setSelectedEmailLoading(false);
    }
  }, [selectedAccount, selectedFolder, project]);

  const handleCompose = useCallback(() => {
    setShowCompose(true);
  }, []);

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
  }, []);

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
    }
  }, [selectedAccount, selectedFolder, page, searchQuery, project]);

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

      {/* Sync progress banner */}
      {syncStatus && syncStatus.overall === "syncing" && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded text-sm text-blue-800">
          <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <span>
            Syncing {syncStatus.syncingFolders} of {syncStatus.totalFolders} folders...
          </span>
          <span className="text-blue-500">
            ({syncStatus.totalCached} messages cached so far)
          </span>
        </div>
      )}

      {/* Sync complete banner (transient — only when just finished and cache has data) */}
      {syncStatus && syncStatus.overall === "done" && syncStatus.totalCached > 0 && syncStatus.syncingFolders === 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-green-50 border border-green-200 rounded text-sm text-green-800">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>
            Cache ready — {syncStatus.totalCached} messages across {syncStatus.totalFolders} folders
            {syncStatus.totalBodies > 0 && ` (${syncStatus.totalBodies} bodies precached)`}
          </span>
        </div>
      )}

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

        {/* Email reader */}
        <EmailReader
          email={selectedEmail}
          loading={selectedEmailLoading}
          accountId={selectedAccount}
          onReply={handleCompose}
          onForward={handleCompose}
          onDelete={handleDelete}
          onArchive={handleArchive}
        />
      </div>

      {/* Compose overlay */}
      <Overlay
        isOpen={showCompose}
        onClose={handleComposeCancel}
        title="Compose"
        fullScreen
      >
        <EmailComposer
          accounts={accounts}
          onSend={handleComposeSend}
          onSave={handleComposeSave}
          onCancel={handleComposeCancel}
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
    </div>
  );
}
