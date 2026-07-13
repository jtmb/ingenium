"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import FolderSidebar from "./components/FolderSidebar";
import EmailList from "./components/EmailList";
import EmailReader from "./components/EmailReader";
import EmptyState from "./components/EmptyState";
import AccountSetup from "./components/AccountSetup";
import Overlay from "../components/Overlay";
import EmailComposer from "./components/EmailComposer";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";
const PROJECT = "gh-llm-bootstrap";

/**
 * Inbox page — 3-pane layout: FolderSidebar | EmailList | EmailReader
 * Fetches accounts on mount, then emails for the selected folder.
 */
export default function MailPage() {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [selectedFolder, setSelectedFolder] = useState("INBOX");
  const [selectedEmail, setSelectedEmail] = useState<any>(null);
  const [selectedEmailLoading, setSelectedEmailLoading] = useState(false);
  const [emails, setEmails] = useState<any[]>([]);
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
  const emailCache = useRef<Map<string, { emails: any[]; total: number }>>(new Map());

  // Fetch accounts on mount
  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const res = await fetch(`${API_BASE}/emails/accounts?project=${PROJECT}`);
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
      }
    };
    fetchAccounts();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch folder list when account changes
  useEffect(() => {
    if (!selectedAccount) return;
    fetch(`${API_BASE}/emails/folders?project=${PROJECT}&account=${selectedAccount}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.data) setFolders(d.data); })
      .catch(() => setFolders([]));
  }, [selectedAccount, refreshKey]);

  // Fetch emails when account/folder/page/search changes
  useEffect(() => {
    if (!selectedAccount) return;

    const cacheKey = `${selectedAccount}:${selectedFolder}:${page}:${searchQuery}`;
    const cached = !searchQuery ? emailCache.current.get(cacheKey) : null;
    if (cached) {
      setEmails(cached.emails);
      setTotal(cached.total);
      setEmailError(null);
      setLoading(false);
      return;
    }

    const fetchEmails = async () => {
      setLoading(true);
      try {
        let url: string;
        if (searchQuery) {
          url = `${API_BASE}/emails/search?project=${PROJECT}&q=${encodeURIComponent(searchQuery)}&account=${selectedAccount}`;
        } else {
          url = `${API_BASE}/emails?project=${PROJECT}&folder=${encodeURIComponent(selectedFolder)}&account=${selectedAccount}&page=${page}&limit=50`;
        }
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const list = data.data || [];
          const tot = data.total || 0;
          setEmails(list);
          setTotal(tot);
          setEmailError(null);
          if (!searchQuery) {
            emailCache.current.set(cacheKey, { emails: list, total: tot });
          }
        } else {
          const errData = await res.json().catch(() => ({ error: { message: "Failed to load emails" } }));
          setEmails([]);
          setTotal(0);
          setEmailError(errData.error?.message || "Failed to load emails");
        }
      } catch {
        setEmails([]);
        setTotal(0);
        setEmailError("Failed to load emails");
      } finally {
        setLoading(false);
      }
    };
    fetchEmails();
  }, [selectedAccount, selectedFolder, page, searchQuery, refreshKey]);

  const handleSelectEmail = useCallback(async (uid: number) => {
    setSelectedEmailLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/emails/${uid}?project=${PROJECT}&account=${selectedAccount}`
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
  }, [selectedAccount]);

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

      const res = await fetch(`${API_BASE}/emails?project=${PROJECT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowCompose(false);
        emailCache.current.clear();
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
  }, []);

  const handleComposeSave = useCallback(async (data: any) => {
    try {
      const body: Record<string, any> = { account: data.accountId, subject: data.subject };
      if (data.to) body.to = data.to.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
      if (data.cc) body.cc = data.cc.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
      if (data.bcc) body.bcc = data.bcc.split(",").map((s: string) => ({ address: s.trim() })).filter((s: any) => s.address);
      if (data.body) body.text = data.body;

      const res = await fetch(`${API_BASE}/emails/draft?project=${PROJECT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setShowCompose(false);
        emailCache.current.clear();
        setRefreshKey(k => k + 1);
      } else {
        const errData = await res.json().catch(() => ({ error: { message: "Save failed" } }));
        alert(errData.error?.message || "Failed to save draft");
      }
    } catch (err: any) {
      alert(err.message || "Failed to save draft");
    }
  }, []);

  const handleComposeCancel = useCallback(() => {
    setShowCompose(false);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!selectedEmail) return;
    try {
      await fetch(`${API_BASE}/emails/${selectedEmail.uid}?project=${PROJECT}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: selectedAccount }),
      });
      setSelectedEmail(null);
      emailCache.current.clear();
      setRefreshKey(k => k + 1);
      setPage(1);
    } catch {
      // Silently fail
    }
  }, [selectedEmail, selectedAccount]);

  const handleArchive = useCallback(async () => {
    if (!selectedEmail) return;
    try {
      await fetch(`${API_BASE}/emails/${selectedEmail.uid}/move?project=${PROJECT}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: selectedAccount, fromFolder: selectedFolder, toFolder: "Archive" }),
      });
      setSelectedEmail(null);
      emailCache.current.clear();
      setRefreshKey(k => k + 1);
    } catch {
      // Silently fail
    }
  }, [selectedEmail, selectedAccount]);

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

  const handleSelectFolder = useCallback((folder: string) => {
    setSelectedFolder(folder);
    setSelectedEmail(null);
    setPage(1);
    setSearchQuery("");
    setEmailError(null);
  }, []);

  // No accounts — show empty / setup state
  if (accounts.length === 0 && !showAccountSetup) {
    const loadDemoAccount = async () => {
      try {
        const res = await fetch(`${API_BASE}/emails/accounts?project=${PROJECT}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "demo@ingenium.local",
            name: "Demo Account",
            provider: "custom",
            authType: "app_password",
            imapHost: "imap",
            imapPort: 3143,
            smtpHost: "imap",
            smtpPort: 3025,
            appPassword: "password",
          }),
        });
        if (res.ok) {
          // Refresh accounts to trigger 3-pane render
          const acctsRes = await fetch(`${API_BASE}/emails/accounts?project=${PROJECT}`);
          if (acctsRes.ok) {
            const data = await acctsRes.json();
            const accts = data.data || [];
            setAccounts(accts);
            if (accts.length > 0) {
              setSelectedAccount(accts[0].id);
            }
          }
        } else {
          const data = await res.json();
          alert(data.error?.message || "Failed to create demo account");
        }
      } catch (err: any) {
        alert("Failed to create demo account: " + (err.message || "Unknown error"));
      }
    };

    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-6">Mail</h1>
        <EmptyState
          message="No email accounts configured"
          action={{ label: "Add Account", onClick: () => setShowAccountSetup(true) }}
        />
        <div className="text-center">
          <button
            onClick={loadDemoAccount}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] underline"
          >
            Load demo account for UI testing
          </button>
        </div>
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
              const res = await fetch(`${API_BASE}/emails/accounts?project=${PROJECT}`);
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
    </div>
  );
}
