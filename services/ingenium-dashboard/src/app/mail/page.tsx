"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import FolderSidebar from "./components/FolderSidebar";
import EmailList from "./components/EmailList";
import EmailReader from "./components/EmailReader";
import EmptyState from "./components/EmptyState";
import AccountSetup from "./components/AccountSetup";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";
const PROJECT = "gh-llm-bootstrap";

/**
 * Inbox page — 3-pane layout: FolderSidebar | EmailList | EmailReader
 * Fetches accounts on mount, then emails for the selected folder.
 */
export default function MailPage() {
  const router = useRouter();

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

  // Fetch emails when account/folder/page/search changes
  useEffect(() => {
    if (!selectedAccount) return;

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
          setEmails(data.data || []);
          setTotal(data.total || 0);
        } else {
          setEmails([]);
          setTotal(0);
        }
      } catch {
        setEmails([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    };
    fetchEmails();
  }, [selectedAccount, selectedFolder, page, searchQuery]);

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
    router.push("/mail/compose");
  }, [router]);

  const handleDelete = useCallback(async () => {
    if (!selectedEmail) return;
    try {
      await fetch(`${API_BASE}/emails/${selectedEmail.uid}?project=${PROJECT}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: selectedAccount }),
      });
      setSelectedEmail(null);
      // Refresh list
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
      setPage(1);
    } catch {
      // Silently fail
    }
  }, [selectedEmail, selectedAccount]);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    setPage(1);
  }, []);

  const handleSelectFolder = useCallback((folder: string) => {
    setSelectedFolder(folder);
    setSelectedEmail(null);
    setPage(1);
    setSearchQuery("");
  }, []);

  // No accounts — show empty / setup state
  if (accounts.length === 0 && !showAccountSetup) {
    const loadDemoAccount = async () => {
      try {
        const res = await fetch(`${API_BASE}/emails/accounts?project=${PROJECT}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: "demo@example.com",
            name: "Demo Account",
            provider: "custom",
            authType: "app_password",
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
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Mail</h1>
        <EmptyState
          message="No email accounts configured"
          action={{ label: "Add Account", onClick: () => setShowAccountSetup(true) }}
        />
        <div className="text-center">
          <button
            onClick={loadDemoAccount}
            className="text-xs text-gray-400 hover:text-gray-600 underline"
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
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Mail</h1>
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
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Mail</h1>

      <div className="flex h-[calc(100vh-180px)] border border-gray-200 rounded bg-white overflow-hidden">
        {/* Folder sidebar */}
        <FolderSidebar
          accounts={accounts}
          selectedAccount={selectedAccount}
          selectedFolder={selectedFolder}
          onSelectFolder={handleSelectFolder}
          onCompose={handleCompose}
          onAddAccount={() => setShowAccountSetup(true)}
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
    </div>
  );
}
