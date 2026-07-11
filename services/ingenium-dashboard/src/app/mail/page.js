"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect, useCallback } from "react";
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
    const [accounts, setAccounts] = useState([]);
    const [selectedAccount, setSelectedAccount] = useState("");
    const [selectedFolder, setSelectedFolder] = useState("INBOX");
    const [selectedEmail, setSelectedEmail] = useState(null);
    const [selectedEmailLoading, setSelectedEmailLoading] = useState(false);
    const [emails, setEmails] = useState([]);
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [searchQuery, setSearchQuery] = useState("");
    const [showAccountSetup, setShowAccountSetup] = useState(false);
    const [showCompose, setShowCompose] = useState(false);
    const [sending, setSending] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
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
            }
            catch {
                // API not available — show empty state
            }
        };
        fetchAccounts();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // Fetch emails when account/folder/page/search changes
    useEffect(() => {
        if (!selectedAccount)
            return;
        const fetchEmails = async () => {
            setLoading(true);
            try {
                let url;
                if (searchQuery) {
                    url = `${API_BASE}/emails/search?project=${PROJECT}&q=${encodeURIComponent(searchQuery)}&account=${selectedAccount}`;
                }
                else {
                    url = `${API_BASE}/emails?project=${PROJECT}&folder=${encodeURIComponent(selectedFolder)}&account=${selectedAccount}&page=${page}&limit=50`;
                }
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    setEmails(data.data || []);
                    setTotal(data.total || 0);
                }
                else {
                    setEmails([]);
                    setTotal(0);
                }
            }
            catch {
                setEmails([]);
                setTotal(0);
            }
            finally {
                setLoading(false);
            }
        };
        fetchEmails();
    }, [selectedAccount, selectedFolder, page, searchQuery, refreshKey]);
    const handleSelectEmail = useCallback(async (uid) => {
        setSelectedEmailLoading(true);
        try {
            const res = await fetch(`${API_BASE}/emails/${uid}?project=${PROJECT}&account=${selectedAccount}`);
            if (res.ok) {
                const data = await res.json();
                setSelectedEmail(data.data);
            }
        }
        catch {
            // Keep current selection
        }
        finally {
            setSelectedEmailLoading(false);
        }
    }, [selectedAccount]);
    const handleCompose = useCallback(() => {
        setShowCompose(true);
    }, []);
    const handleComposeSend = useCallback(async (data) => {
        setSending(true);
        try {
            const body = { account: data.accountId, subject: data.subject };
            if (data.to)
                body.to = data.to.split(",").map((s) => ({ address: s.trim() })).filter((s) => s.address);
            if (data.cc)
                body.cc = data.cc.split(",").map((s) => ({ address: s.trim() })).filter((s) => s.address);
            if (data.bcc)
                body.bcc = data.bcc.split(",").map((s) => ({ address: s.trim() })).filter((s) => s.address);
            if (data.body)
                body.text = data.body;
            const res = await fetch(`${API_BASE}/emails?project=${PROJECT}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                setShowCompose(false);
                setRefreshKey(k => k + 1);
            }
            else {
                const errData = await res.json().catch(() => ({ error: { message: "Send failed" } }));
                alert(errData.error?.message || "Failed to send");
            }
        }
        catch (err) {
            alert(err.message || "Failed to send");
        }
        finally {
            setSending(false);
        }
    }, []);
    const handleComposeSave = useCallback(async (data) => {
        try {
            const body = { account: data.accountId, subject: data.subject };
            if (data.to)
                body.to = data.to.split(",").map((s) => ({ address: s.trim() })).filter((s) => s.address);
            if (data.cc)
                body.cc = data.cc.split(",").map((s) => ({ address: s.trim() })).filter((s) => s.address);
            if (data.bcc)
                body.bcc = data.bcc.split(",").map((s) => ({ address: s.trim() })).filter((s) => s.address);
            if (data.body)
                body.text = data.body;
            const res = await fetch(`${API_BASE}/emails/draft?project=${PROJECT}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                setShowCompose(false);
                setRefreshKey(k => k + 1);
            }
            else {
                const errData = await res.json().catch(() => ({ error: { message: "Save failed" } }));
                alert(errData.error?.message || "Failed to save draft");
            }
        }
        catch (err) {
            alert(err.message || "Failed to save draft");
        }
    }, []);
    const handleComposeCancel = useCallback(() => {
        setShowCompose(false);
    }, []);
    const handleDelete = useCallback(async () => {
        if (!selectedEmail)
            return;
        try {
            await fetch(`${API_BASE}/emails/${selectedEmail.uid}?project=${PROJECT}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ account: selectedAccount }),
            });
            setSelectedEmail(null);
            // Refresh list
            setPage(1);
        }
        catch {
            // Silently fail
        }
    }, [selectedEmail, selectedAccount]);
    const handleArchive = useCallback(async () => {
        if (!selectedEmail)
            return;
        try {
            await fetch(`${API_BASE}/emails/${selectedEmail.uid}/move?project=${PROJECT}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ account: selectedAccount, fromFolder: selectedFolder, toFolder: "Archive" }),
            });
            setSelectedEmail(null);
            setPage(1);
        }
        catch {
            // Silently fail
        }
    }, [selectedEmail, selectedAccount]);
    const handleSearch = useCallback((q) => {
        setSearchQuery(q);
        setPage(1);
    }, []);
    const handleSelectFolder = useCallback((folder) => {
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
                }
                else {
                    const data = await res.json();
                    alert(data.error?.message || "Failed to create demo account");
                }
            }
            catch (err) {
                alert("Failed to create demo account: " + (err.message || "Unknown error"));
            }
        };
        return (_jsxs("div", { className: "space-y-4", children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-6", children: "Mail" }), _jsx(EmptyState, { message: "No email accounts configured", action: { label: "Add Account", onClick: () => setShowAccountSetup(true) } }), _jsx("div", { className: "text-center", children: _jsx("button", { onClick: loadDemoAccount, className: "text-xs text-gray-400 hover:text-gray-600 underline", children: "Load demo account for UI testing" }) })] }));
    }
    if (showAccountSetup) {
        return (_jsxs("div", { className: "space-y-4", children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-6", children: "Mail" }), _jsx(AccountSetup, { onComplete: async () => {
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
                        }
                        catch { }
                    }, onCancel: () => setShowAccountSetup(false) })] }));
    }
    return (_jsxs("div", { className: "space-y-4", children: [_jsx("h1", { className: "text-3xl font-bold text-gray-900 mb-6", children: "Mail" }), _jsxs("div", { className: "flex h-[calc(100vh-180px)] border border-gray-200 rounded bg-white overflow-hidden", children: [_jsx(FolderSidebar, { accounts: accounts, selectedAccount: selectedAccount, selectedFolder: selectedFolder, onSelectFolder: handleSelectFolder, onCompose: handleCompose, onAddAccount: () => setShowAccountSetup(true) }), _jsx(EmailList, { emails: emails, selectedUid: selectedEmail?.uid, onSelect: handleSelectEmail, onPageChange: setPage, total: total, page: page, loading: loading, onSearch: handleSearch }), _jsx(EmailReader, { email: selectedEmail, loading: selectedEmailLoading, accountId: selectedAccount, onReply: handleCompose, onForward: handleCompose, onDelete: handleDelete, onArchive: handleArchive })] }), _jsxs(Overlay, { isOpen: showCompose, onClose: handleComposeCancel, title: "New Message", children: [_jsx(EmailComposer, { accounts: accounts, onSend: handleComposeSend, onSave: handleComposeSave, onCancel: handleComposeCancel }), sending && (_jsx("p", { className: "text-sm text-gray-500 text-center mt-4", children: "Sending..." }))] })] }));
}
