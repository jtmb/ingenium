"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import FolderSidebar from "./components/FolderSidebar";
import EmailList from "./components/EmailList";
import EmailReader from "./components/EmailReader";
import AccountSetup from "./components/AccountSetup";
import SyncProgress from "./components/SyncProgress";
import Overlay from "../components/Overlay";
import EmailComposer from "./components/EmailComposer";
import TaskCaptureModal from "../tasks/components/TaskCaptureModal";
import { dashboardFetch, getApiBase, type EmailTaskCaptureSource, type TaskCaptureResult } from "@/lib/api";
import { useGlobalProject } from "../../lib/ProjectContext";

const API_BASE = getApiBase();

type MailContext = {
  project: string | null;
  account: string;
  folder: string;
  uid: string | null;
  generation: number;
};

type MailRequestKey = MailContext;

function matchesMailContext(key: MailRequestKey, current: MailContext): boolean {
  return key.generation === current.generation
    && key.project === current.project
    && key.account === current.account
    && key.folder === current.folder
    && key.uid === current.uid;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
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
  const {
    project,
    loading: projectLoading,
    error: projectError,
  } = useGlobalProject();
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
  const [taskCaptureSource, setTaskCaptureSource] = useState<EmailTaskCaptureSource | null>(null);
  const [taskCaptureNotice, setTaskCaptureNotice] = useState<{ title: string } | null>(null);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [accountsProject, setAccountsProject] = useState<string | null>(null);
  const [accountsRetryKey, setAccountsRetryKey] = useState(0);
  const [messageRequestKey, setMessageRequestKey] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const requestControllersRef = useRef(new Set<AbortController>());
  const contextRef = useRef<MailContext>({
    project: null,
    account: "",
    folder: "INBOX",
    uid: null,
    generation: 0,
  });

  const renderedSelectedUid = pendingEmailUid
    ?? (selectedEmail?.uid !== undefined && selectedEmail?.uid !== null ? String(selectedEmail.uid) : null);
  if (contextRef.current.project !== project) {
    contextRef.current = {
      ...contextRef.current,
      project,
      account: "",
      folder: "INBOX",
      uid: null,
    };
  } else {
    contextRef.current.account = selectedAccount;
    contextRef.current.folder = selectedFolder;
    contextRef.current.uid = renderedSelectedUid;
  }

  const invalidateMailRequests = useCallback(() => {
    contextRef.current.generation += 1;
    for (const controller of requestControllersRef.current) controller.abort();
    requestControllersRef.current.clear();
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (syncPollRef.current) {
      clearInterval(syncPollRef.current);
      syncPollRef.current = null;
    }
  }, []);

  const changeMailContext = useCallback((patch: Partial<Omit<MailContext, "generation">>) => {
    contextRef.current = { ...contextRef.current, ...patch };
    invalidateMailRequests();
  }, [invalidateMailRequests]);

  const captureRequestKey = useCallback((): MailRequestKey => ({ ...contextRef.current }), []);
  const isCurrentRequest = useCallback(
    (key: MailRequestKey) => matchesMailContext(key, contextRef.current),
    [],
  );

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

  useEffect(() => {
    invalidateMailRequests();
  }, [project, selectedAccount, selectedFolder, renderedSelectedUid, invalidateMailRequests]);

  useEffect(() => () => invalidateMailRequests(), [invalidateMailRequests]);

  // Fetch accounts only after the canonical global project has resolved.
  useEffect(() => {
    if (projectLoading || !project) return;

    if (accountsProject !== project) {
      setAccountsProject(null);
      setSelectedAccount("");
      setSelectedFolder("INBOX");
      setSelectedEmail(null);
      setSelectedEmailLoading(false);
      setEmailPending(false);
      setEmailDownloadError(null);
      setPendingEmailUid(null);
      setEmails([]);
      setTotal(0);
      setEmailSource("");
      setFolders([]);
      setSyncStatus(null);
    }

    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const requestKey = captureRequestKey();
    const fetchAccounts = async () => {
      setAccountsLoading(true);
      setAccountsError(null);
      try {
        const res = await fetch(
          `${API_BASE}/emails/accounts?project=${project}&include_hidden=true`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: { message: "Failed to load email accounts" } }));
          throw new Error(errData.error?.message || "Failed to load email accounts");
        }
        const data = await res.json();
        if (!isCurrentRequest(requestKey)) return;
        const accts = Array.isArray(data.data) ? data.data : [];
        setAccounts(accts);
        setAccountsProject(project);
        setAccountsError(null);
        setAccountsLoading(false);

        const firstVisible = accts.find((a: any) => !a.hidden);
        if (firstVisible && !contextRef.current.account) {
          changeMailContext({ account: firstVisible.id, folder: "INBOX", uid: null });
          setSelectedAccount(firstVisible.id);
          setSelectedFolder("INBOX");
        }
      } catch (error: unknown) {
        if (!isCurrentRequest(requestKey) || isAbortError(error)) return;
        setAccountsProject(project);
        setAccountsError(error instanceof Error ? error.message : "Failed to load email accounts");
      } finally {
        requestControllersRef.current.delete(controller);
        if (isCurrentRequest(requestKey)) setAccountsLoading(false);
      }
    };
    void fetchAccounts();

    return () => {
      controller.abort();
      requestControllersRef.current.delete(controller);
    };
  // The account selection is intentionally not a dependency: changing it does
  // not require reloading the account catalog.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, projectLoading, accountsRetryKey, captureRequestKey, changeMailContext, isCurrentRequest]);

  // Fetch folder list when account changes.
  useEffect(() => {
    if (projectLoading || !project || !selectedAccount || accountsProject !== project) return;

    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const requestKey = captureRequestKey();
    fetch(
      `${API_BASE}/emails/folders?project=${project}&account=${selectedAccount}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load email folders");
        return response.json();
      })
      .then((data) => {
        if (!isCurrentRequest(requestKey) || !data?.data) return;
        setFolders(data.data.filter((f: any) => !f.flags?.some((fl: string) => /noselect/i.test(fl)) && f.name !== "[Gmail]"));
      })
      .catch((error: unknown) => {
        if (!isCurrentRequest(requestKey) || isAbortError(error)) return;
        setFolders([]);
      })
      .finally(() => {
        requestControllersRef.current.delete(controller);
      });

    return () => {
      controller.abort();
      requestControllersRef.current.delete(controller);
    };
  }, [selectedAccount, selectedFolder, project, projectLoading, accountsProject, captureRequestKey, isCurrentRequest]);

  // Poll sync status every 2 seconds.
  useEffect(() => {
    if (projectLoading || !project || !selectedAccount || accountsProject !== project) {
      setSyncStatus(null);
      return;
    }

    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const requestKey = captureRequestKey();
    const pollSync = async () => {
      if (!isCurrentRequest(requestKey)) return;
      try {
        const res = await fetch(
          `${API_BASE}/emails/sync-status?project=${project}&account=${selectedAccount}`,
          { signal: controller.signal },
        );
        if (res.ok) {
          const data = await res.json();
          if (isCurrentRequest(requestKey)) setSyncStatus(data.data);
        }
      } catch (error: unknown) {
        if (!isAbortError(error) && isCurrentRequest(requestKey)) {
          // Sync status is non-critical; keep the last successful snapshot.
        }
      }
    };

    void pollSync();
    const interval = setInterval(() => { void pollSync(); }, 2000);
    syncPollRef.current = interval;
    return () => {
      clearInterval(interval);
      if (syncPollRef.current === interval) syncPollRef.current = null;
      controller.abort();
      requestControllersRef.current.delete(controller);
    };
  }, [selectedAccount, project, selectedFolder, renderedSelectedUid, projectLoading, accountsProject, captureRequestKey, isCurrentRequest]);

  useEffect(() => {
    if (!taskCaptureNotice) return;
    const timeout = window.setTimeout(() => setTaskCaptureNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [taskCaptureNotice]);

  // Fetch emails when account/folder/page/search changes
  // Server-side DB cache serves sub-2ms — no need for in-memory cache
  useEffect(() => {
    if (projectLoading || !project || !selectedAccount || accountsProject !== project) return;

    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const requestKey = captureRequestKey();
    const fetchEmails = async () => {
      setLoading(true);
      try {
        let url: string;
        if (searchQuery) {
          url = `${API_BASE}/emails/search?project=${project}&q=${encodeURIComponent(searchQuery)}&account=${selectedAccount}`;
        } else {
          url = `${API_BASE}/emails?project=${project}&folder=${encodeURIComponent(selectedFolder)}&account=${selectedAccount}&page=${page}&limit=50`;
        }
        const res = await fetch(url, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          if (!isCurrentRequest(requestKey)) return;
          setEmails(data.data || []);
          setTotal(data.total || 0);
          setEmailSource(data.source || "");
          setEmailError(null);
        } else {
          const errData = await res.json().catch(() => ({ error: { message: "Failed to load emails" } }));
          if (!isCurrentRequest(requestKey)) return;
          setEmails([]);
          setTotal(0);
          setEmailSource("");
          setEmailError(errData.error?.message || "Failed to load emails");
        }
      } catch (error: unknown) {
        if (!isCurrentRequest(requestKey) || isAbortError(error)) return;
        setEmails([]);
        setTotal(0);
        setEmailSource("");
        setEmailError("Failed to load emails");
      } finally {
        requestControllersRef.current.delete(controller);
        if (isCurrentRequest(requestKey)) setLoading(false);
      }
    };
    void fetchEmails();

    return () => {
      controller.abort();
      requestControllersRef.current.delete(controller);
    };
  }, [selectedAccount, selectedFolder, page, searchQuery, refreshKey, project, projectLoading, accountsProject, renderedSelectedUid, captureRequestKey, isCurrentRequest]);

  // Re-fetch emails when sync status shows selected folder transitioned from syncing → done/error
  useEffect(() => {
    const status = syncStatus?.folders?.find((f: any) => f.folder === selectedFolder);
    if (!status) return;
    if (emailSource === "pending" && !status.syncing) {
      setRefreshKey(k => k + 1);
    }
  }, [syncStatus, selectedFolder, emailSource]);

  // Load the selected body and keep the existing 202 cache-warming poll.
  useEffect(() => {
    if (projectLoading || !project || !selectedAccount || accountsProject !== project || !pendingEmailUid) return;

    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const requestKey = captureRequestKey();
    const uid = pendingEmailUid;
    const url = `${API_BASE}/emails/${uid}?project=${project}&account=${selectedAccount}&folder=${encodeURIComponent(selectedFolder)}`;
    const MAX_POLL_MS = 20000;
    let pollStart = 0;
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const clearOwnPoll = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        if (pollRef.current === pollInterval) pollRef.current = null;
        pollInterval = null;
      }
    };

    const pollBody = async () => {
      if (!isCurrentRequest(requestKey)) {
        clearOwnPoll();
        return;
      }
      try {
        const pollRes = await fetch(url, { signal: controller.signal });
        if (!isCurrentRequest(requestKey)) {
          clearOwnPoll();
          return;
        }
        if (pollRes.ok) {
          const pollData = await pollRes.json();
          if (!isCurrentRequest(requestKey)) {
            clearOwnPoll();
            return;
          }
          clearOwnPoll();
          setSelectedEmail(pollData.data);
          setEmailPending(false);
          setPendingEmailUid(null);
          return;
        }
      } catch (error: unknown) {
        if (isAbortError(error)) return;
        if (!isCurrentRequest(requestKey)) {
          clearOwnPoll();
          return;
        }
      }

      if (!isCurrentRequest(requestKey)) {
        clearOwnPoll();
        return;
      }
      if (Date.now() - pollStart >= MAX_POLL_MS) {
        clearOwnPoll();
        setEmailPending(false);
        setEmailDownloadError("Could not load this email — try again later");
      }
    };

    const loadBody = async () => {
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!isCurrentRequest(requestKey)) return;

        if (res.status === 202) {
          setSelectedEmailLoading(false);
          setEmailPending(true);
          pollStart = Date.now();
          pollInterval = setInterval(() => { void pollBody(); }, 1500);
          pollRef.current = pollInterval;
          return;
        }

        if (res.ok) {
          const data = await res.json();
          if (!isCurrentRequest(requestKey)) return;
          setSelectedEmail(data.data);
          setPendingEmailUid(null);
        }
      } catch (error: unknown) {
        if (!isCurrentRequest(requestKey) || isAbortError(error)) return;
        setEmailDownloadError("Could not load this email — try again later");
      } finally {
        if (isCurrentRequest(requestKey)) setSelectedEmailLoading(false);
      }
    };

    void loadBody();
    return () => {
      clearOwnPoll();
      controller.abort();
      requestControllersRef.current.delete(controller);
    };
  }, [pendingEmailUid, messageRequestKey, project, projectLoading, selectedAccount, selectedFolder, accountsProject, captureRequestKey, isCurrentRequest]);

  const handleSelectEmail = useCallback((uid: string) => {
    // Re-clicking the already-open email must not reset state or flash the reader.
    if (selectedEmail?.uid !== undefined && String(selectedEmail.uid) === uid && !pendingEmailUid) return;

    changeMailContext({ uid });
    setSelectedEmailLoading(true);
    setEmailPending(false);
    setEmailDownloadError(null);
    setSelectedEmail(null);
    setPendingEmailUid(uid);
    setMessageRequestKey((key) => key + 1);
  }, [selectedEmail, pendingEmailUid, changeMailContext]);

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
      if (data.html) body.html = data.html;
      if (data.text) body.text = data.text;

      const res = await dashboardFetch(`${API_BASE}/emails?project=${project}`, {
        method: "POST",
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

      const res = await dashboardFetch(`${API_BASE}/emails/draft?project=${project}`, {
        method: "POST",
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

  const handleBackToMessages = useCallback(() => {
    changeMailContext({ uid: null });
    setSelectedEmail(null);
    setSelectedEmailLoading(false);
    setEmailPending(false);
    setEmailDownloadError(null);
    setPendingEmailUid(null);
  }, [changeMailContext]);

  const handleCreateTask = useCallback(() => {
    if (
      !selectedAccount
      || !selectedEmail
      || selectedEmail.uid === undefined
      || selectedEmail.uid === null
      || typeof selectedEmail.folder !== "string"
      || selectedEmail.folder.length === 0
    ) {
      return;
    }

    setTaskCaptureSource({
      source_type: "email",
      account_id: selectedAccount,
      folder: selectedEmail.folder,
      uid: String(selectedEmail.uid),
    });
  }, [selectedAccount, selectedEmail]);

  const handleTaskCaptureClose = useCallback(() => {
    setTaskCaptureSource(null);
  }, []);

  const handleTaskCaptured = useCallback((result: TaskCaptureResult) => {
    setTaskCaptureSource(null);
    setTaskCaptureNotice({ title: result.task.title });
  }, []);

  const handleDelete = useCallback(async () => {
    if (!selectedEmail) return;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const requestKey = captureRequestKey();
    try {
      await dashboardFetch(`${API_BASE}/emails/${selectedEmail.uid}?project=${project}`, {
        method: "DELETE",
        body: JSON.stringify({ account: selectedAccount }),
        signal: controller.signal,
      });
      if (!isCurrentRequest(requestKey)) return;
      changeMailContext({ uid: null });
      setSelectedEmail(null);
      setRefreshKey(k => k + 1);
      setPage(1);
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      // Silently fail
    } finally {
      requestControllersRef.current.delete(controller);
    }
  }, [selectedEmail, selectedAccount, project, captureRequestKey, isCurrentRequest, changeMailContext]);

  const handleArchive = useCallback(async () => {
    if (!selectedEmail) return;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const requestKey = captureRequestKey();
    try {
      await dashboardFetch(`${API_BASE}/emails/${selectedEmail.uid}/move?project=${project}`, {
        method: "PATCH",
        body: JSON.stringify({ account: selectedAccount, fromFolder: selectedFolder, toFolder: "Archive" }),
        signal: controller.signal,
      });
      if (!isCurrentRequest(requestKey)) return;
      changeMailContext({ uid: null });
      setSelectedEmail(null);
      setRefreshKey(k => k + 1);
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      // Silently fail
    } finally {
      requestControllersRef.current.delete(controller);
    }
  }, [selectedEmail, selectedAccount, selectedFolder, project, captureRequestKey, isCurrentRequest, changeMailContext]);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    setPage(1);
  }, []);

  const handleSelectAccount = useCallback((accountId: string) => {
    changeMailContext({ account: accountId, folder: "INBOX", uid: null });
    setSelectedAccount(accountId);
    setSelectedFolder("INBOX");
    setSelectedEmail(null);
    setSelectedEmailLoading(false);
    setEmailPending(false);
    setEmailDownloadError(null);
    setPendingEmailUid(null);
    setPage(1);
    setSearchQuery("");
    setEmailError(null);
    setEmails([]);
    setTotal(0);
    setEmailSource("");
  }, [changeMailContext]);

  const handleDeleteAccount = useCallback(async (accountId: string) => {
    setDeleteAccountId(accountId);
  }, []);

  const refreshAccountList = useCallback(async (): Promise<any[] | null> => {
    if (!project) return null;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const requestKey = captureRequestKey();
    try {
      const res = await fetch(`${API_BASE}/emails/accounts?project=${project}&include_hidden=true`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("Failed to load email accounts");
      const data = await res.json();
      if (!isCurrentRequest(requestKey)) return null;
      const accts = Array.isArray(data.data) ? data.data : [];
      setAccounts(accts);
      setAccountsProject(project);
      setAccountsError(null);
      return accts;
    } catch (error: unknown) {
      if (!isAbortError(error) && isCurrentRequest(requestKey)) {
        setAccountsError(error instanceof Error ? error.message : "Failed to load email accounts");
      }
      return null;
    } finally {
      requestControllersRef.current.delete(controller);
    }
  }, [project, captureRequestKey, isCurrentRequest]);

  const handleHideAccount = useCallback(async (accountId: string) => {
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const requestKey = captureRequestKey();
    try {
      await dashboardFetch(`${API_BASE}/emails/accounts/${accountId}?project=${project}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: true }),
        signal: controller.signal,
      });
      if (!isCurrentRequest(requestKey)) return;
      const accts = await refreshAccountList();
      if (!accts || !isCurrentRequest(requestKey) || selectedAccount !== accountId) return;
      const nextVisible = accts.find((a: any) => !a.hidden);
      changeMailContext({ account: nextVisible?.id ?? "", folder: "INBOX", uid: null });
      setSelectedAccount(nextVisible?.id ?? "");
      setSelectedFolder("INBOX");
      setSelectedEmail(null);
      setEmails([]);
      setTotal(0);
      setEmailSource("");
    } catch { /* non-fatal */ }
    finally {
      requestControllersRef.current.delete(controller);
    }
  }, [selectedAccount, project, refreshAccountList, changeMailContext, captureRequestKey, isCurrentRequest]);

  const handleShowAccount = useCallback(async (accountId: string) => {
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const requestKey = captureRequestKey();
    try {
      await dashboardFetch(`${API_BASE}/emails/accounts/${accountId}?project=${project}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden: false }),
        signal: controller.signal,
      });
      if (!isCurrentRequest(requestKey)) return;
      const accts = await refreshAccountList();
      if (!accts || !isCurrentRequest(requestKey)) return;
      changeMailContext({ account: accountId, folder: "INBOX", uid: null });
      setSelectedAccount(accountId);
      setSelectedFolder("INBOX");
      setSelectedEmail(null);
      setEmails([]);
      setTotal(0);
      setEmailSource("");
      setPage(1);
      setSearchQuery("");
      setEmailError(null);
    } catch { /* non-fatal */ }
    finally {
      requestControllersRef.current.delete(controller);
    }
  }, [project, refreshAccountList, changeMailContext, captureRequestKey, isCurrentRequest]);

  const confirmDeleteAccount = useCallback(async () => {
    if (!deleteAccountId) return;
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const requestKey = captureRequestKey();
    setDeletingAccount(true);
    try {
      await dashboardFetch(`${API_BASE}/emails/accounts/${deleteAccountId}?project=${project}`, {
        method: "DELETE",
        signal: controller.signal,
      });
      if (!isCurrentRequest(requestKey)) return;
      const accts = await refreshAccountList();
      if (accts && isCurrentRequest(requestKey) && selectedAccount === deleteAccountId) {
        const nextVisible = accts.find((a: any) => !a.hidden);
        changeMailContext({ account: nextVisible?.id ?? "", folder: "INBOX", uid: null });
        setSelectedAccount(nextVisible?.id ?? "");
        setSelectedFolder("INBOX");
        setSelectedEmail(null);
        setEmails([]);
        setTotal(0);
        setEmailSource("");
      }
      // Also refresh health status — trigger a service status re-fetch
      fetch(`${API_BASE}/services/status?project=${project}`).catch(() => {});
    } catch { /* non-fatal */ }
    finally {
      requestControllersRef.current.delete(controller);
      if (isCurrentRequest(requestKey)) {
        setDeletingAccount(false);
        setDeleteAccountId(null);
      }
    }
  }, [deleteAccountId, selectedAccount, project, refreshAccountList, changeMailContext, captureRequestKey, isCurrentRequest]);

  const handleSelectFolder = useCallback((folder: string) => {
    changeMailContext({ folder, uid: null });
    setSelectedFolder(folder);
    setSelectedEmail(null);
    setSelectedEmailLoading(false);
    setEmailPending(false);
    setEmailDownloadError(null);
    setPendingEmailUid(null);
    setPage(1);
    setSearchQuery("");
    setEmailError(null);
    setEmails([]);
    setTotal(0);
    setEmailSource("");

    // Fire-and-forget cache boost hint — the /sync route calls boostFolder internally
    dashboardFetch(`${API_BASE}/emails/sync?project=${project}`, {
      method: "POST",
      body: JSON.stringify({ account: selectedAccount, folder }),
    }).catch(() => {});
  }, [selectedAccount, project, changeMailContext]);

  const handleRefresh = useCallback(async () => {
    if (!selectedAccount) return;
    invalidateMailRequests();
    const controller = new AbortController();
    requestControllersRef.current.add(controller);
    const requestKey = captureRequestKey();
    setLoading(true);
    try {
      const url = searchQuery
        ? `${API_BASE}/emails/search?project=${project}&q=${encodeURIComponent(searchQuery)}&account=${selectedAccount}&refresh=true`
        : `${API_BASE}/emails?project=${project}&folder=${encodeURIComponent(selectedFolder)}&account=${selectedAccount}&page=${page}&limit=50&refresh=true`;
      const res = await fetch(url, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        if (!isCurrentRequest(requestKey)) return;
        setEmails(data.data || []);
        setTotal(data.total || 0);
        setEmailSource(data.source || "");
        setEmailError(null);
      } else {
        const errData = await res.json().catch(() => ({ error: { message: "Refresh failed" } }));
        if (!isCurrentRequest(requestKey)) return;
        setEmailError(errData.error?.message || "Refresh failed");
      }
    } catch (error: unknown) {
      if (!isCurrentRequest(requestKey) || isAbortError(error)) return;
      setEmailError("Refresh failed");
    } finally {
      requestControllersRef.current.delete(controller);
      if (isCurrentRequest(requestKey)) {
        setLoading(false);
        setRefreshKey(prev => prev + 1);
      }
    }
  }, [selectedAccount, selectedFolder, page, searchQuery, project, invalidateMailRequests, captureRequestKey, isCurrentRequest]);

  // Derived computed values for cold-state gating and folder sync indicators
  const syncingFolders = syncStatus?.folders?.filter((f: any) => f.syncing).map((f: any) => f.folder) ?? [];
  const inboxFolderStatus = syncStatus?.folders?.find((f: any) => f.folder === "INBOX");
  const isInboxCold = syncStatus !== null && syncStatus.overall === "syncing" && inboxFolderStatus?.cachedCount === 0;
  const selectedFolderStatus = syncStatus?.folders?.find((f: any) => f.folder === selectedFolder);
  const isColdFolder = !loading && emails.length === 0 && selectedFolderStatus?.cachedCount === 0 && selectedFolderStatus?.syncing === true;
  const hasMobileEmailSelection = Boolean(
    selectedEmail || selectedEmailLoading || emailPending || pendingEmailUid || emailDownloadError,
  );

  // Detect auth errors from the selected account's raw engine status.
  const selectedEngineAccount = syncStatus?.engine?.accounts?.find(
    (account: any) => account.accountId === selectedAccount,
  );
  const engineFolders = selectedEngineAccount?.folders ?? [];
  const selectedAccountDetails = accounts.find((account: any) => account.id === selectedAccount);
  const hasUnavailableOAuthAccount =
    selectedAccountDetails?.authType === "oauth2" &&
    syncStatus !== null &&
    syncStatus.totalFolders === 0 &&
    !selectedEngineAccount;
  const hasAuthError = hasUnavailableOAuthAccount || engineFolders.some((f: any) =>
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

  const handleRetryProject = useCallback(() => {
    window.location.reload();
  }, []);

  const handleRetryAccounts = useCallback(() => {
    invalidateMailRequests();
    setAccountsError(null);
    setAccountsLoading(true);
    setAccountsRetryKey((key) => key + 1);
  }, [invalidateMailRequests]);

  const handleAccountSetupComplete = useCallback(async () => {
    const requestKey = captureRequestKey();
    setShowAccountSetup(false);
    const accts = await refreshAccountList();
    if (!accts || !isCurrentRequest(requestKey)) return;
    const firstVisible = accts.find((a: any) => !a.hidden);
    if (!firstVisible) return;
    changeMailContext({ account: firstVisible.id, folder: "INBOX", uid: null });
    setSelectedAccount(firstVisible.id);
    setSelectedFolder("INBOX");
  }, [captureRequestKey, refreshAccountList, isCurrentRequest, changeMailContext]);

  const accountsResolving = Boolean(project) && accountsProject !== project;

  if (projectLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-6">Mail</h1>
        <div className="flex items-center gap-3 text-[var(--color-text-muted)]">
          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Resolving mail project…</span>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-6">Mail</h1>
        <div
          data-testid="mail-project-resolution-error"
          role="alert"
          className="rounded-lg border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-6 text-center"
        >
          <p className="text-sm font-medium text-[var(--color-error-text)]">
            {projectError?.message ?? "The active global project could not be resolved."}
          </p>
          <button
            type="button"
            onClick={handleRetryProject}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Retry project resolution
          </button>
        </div>
      </div>
    );
  }

  // Loading — accounts are still being fetched
  if (accountsLoading || accountsResolving) {
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

  if (accountsError && !showAccountSetup) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-6">Mail</h1>
        <div
          data-testid="mail-accounts-error"
          role="alert"
          className="rounded-lg border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-6 text-center"
        >
          <p className="text-sm text-[var(--color-error-text)]">{accountsError}</p>
          <button
            type="button"
            onClick={handleRetryAccounts}
            className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Retry loading accounts
          </button>
        </div>
      </div>
    );
  }

  // No accounts — show empty / setup state
  if (accounts.length === 0 && !showAccountSetup && !accountsLoading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-bold text-[var(--color-text-primary)] mb-6">Mail</h1>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-[var(--color-text-muted)] text-sm mb-4">No email accounts configured</p>
          <button
            type="button"
            onClick={() => setShowAccountSetup(true)}
            className="bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium"
          >
            Add Account
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
          project={project}
          reconnectAccount={hasAuthError ? selectedAccountDetails : undefined}
          onComplete={handleAccountSetupComplete}
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
          <div data-testid="mail-folder-sidebar" className="hidden md:flex">
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
          </div>

            {/* Email list + reader — resizable split */}
            <div className="flex items-stretch relative flex-1 min-w-0">
              <div
                data-testid="mail-email-list-pane"
                className={`min-w-0 shrink-0 ${hasMobileEmailSelection ? "hidden md:flex" : "flex flex-1 md:flex-none"}`}
              >
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
              </div>

              {/* Resize handle */}
              <div
                data-testid="mail-email-list-resizer"
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
                className={`hidden md:block w-2 cursor-col-resize hover:bg-blue-200 active:bg-blue-400 transition-colors shrink-0 ${isResizing ? "bg-blue-400" : "bg-transparent"}`}
              />

              <div
                data-testid="mail-email-reader-pane"
                className={hasMobileEmailSelection ? "flex min-w-0 flex-1 flex-col" : "hidden min-w-0 flex-1 flex-col md:flex"}
              >
                {hasMobileEmailSelection && (
                  <button
                    type="button"
                    onClick={handleBackToMessages}
                    className="inline-flex items-center gap-1 border-b border-[var(--color-border)] px-4 py-2 text-left text-sm text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] md:hidden"
                  >
                    <span aria-hidden="true">←</span>
                    Back to messages
                  </button>
                )}
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
                  onCreateTask={handleCreateTask}
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
          </div>

          {taskCaptureNotice && (
            <div
              data-testid="mail-task-capture-status"
              role="status"
              aria-live="polite"
              className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded border border-[var(--color-success-border)] bg-[var(--color-success-bg)] px-4 py-2 text-sm text-[var(--color-success-text)] shadow-lg"
            >
              Task created: {" "}
              <Link href="/tasks" className="font-medium underline">
                {taskCaptureNotice.title}
              </Link>
            </div>
          )}

          {taskCaptureSource && (
            <TaskCaptureModal
              isOpen
              source={taskCaptureSource}
              onClose={handleTaskCaptureClose}
              onCaptured={handleTaskCaptured}
            />
          )}

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
