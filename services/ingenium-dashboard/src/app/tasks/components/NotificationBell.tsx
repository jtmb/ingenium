"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api, TaskNotification } from "../../../lib/api";

type NotificationBellProps = {
  project: string;
  onTaskClick?: (taskId: string) => void;
};

function notificationIcon(type: string): string {
  if (type === "comment") return "💬";
  if (type === "mention") return "@";
  if (type === "assigned") return "👤";
  if (type === "due") return "📅";
  return "🔔";
}

function relativeTime(dateStr: string): string {
  const diff = Math.max(0, Date.now() - new Date(dateStr).getTime());
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationBell({ project, onTaskClick }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState<TaskNotification | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const r = await api.tasks.notifications("orchestrator", true, project);
      const fresh = r.data ?? [];
      const prevIds = prevIdsRef.current;

      // Detect new notifications for toast
      const newOnes = fresh.filter((n) => !prevIds.has(n.id));
      if (newOnes.length > 0 && !panelOpen) {
        setToast(newOnes[newOnes.length - 1]!);
        setTimeout(() => setToast(null), 5000);
      }

      // Update prev ids
      prevIdsRef.current = new Set(fresh.map((n) => n.id));
      setNotifications(fresh);
    } catch {
      // ignore
    }
  }, [project, panelOpen]);

  // Poll every 30s
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close panel on outside click
  useEffect(() => {
    if (!panelOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [panelOpen]);

  const markRead = useCallback(async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await api.tasks.readNotification(id, project);
    } catch {
      // ignore
    }
  }, [project]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <>
      {/* Bell button */}
      <div className="relative" ref={panelRef}>
        <button onClick={() => setPanelOpen(!panelOpen)}
          className="relative p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded-full"
          title="Notifications">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </button>

        {/* Dropdown panel */}
        {panelOpen && (
          <div className="absolute right-0 top-full mt-1 w-80 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-xl z-50 max-h-96 overflow-y-auto">
            <div className="px-3 py-2 border-b border-[var(--color-border-muted)] flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">Notifications</span>
              {unreadCount > 0 && (
                <button onClick={() => notifications.forEach((n) => !n.read && markRead(n.id))}
                  className="text-xs text-[var(--color-text-link)] hover:underline">Mark all read</button>
              )}
            </div>
            {notifications.length === 0 ? (
              <div className="px-3 py-4 text-sm text-[var(--color-text-muted)] text-center">No notifications</div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className={`px-3 py-2 border-b border-[var(--color-border-muted)] flex items-start gap-2 hover:bg-[var(--color-surface-hover)] text-sm ${!n.read ? "bg-[var(--color-surface-selected)]" : ""}`}>
                  <span className="shrink-0 mt-0.5">{notificationIcon(n.type)}</span>
                  <div className="min-w-0 flex-1">
                    <button onClick={() => onTaskClick?.(n.task_id)}
                      className="text-[var(--color-text-primary)] font-medium hover:text-[var(--color-text-link)] text-left break-words">{n.message}</button>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-[var(--color-text-muted)]">{relativeTime(n.created_at)}</span>
                      {!n.read && (
                        <button onClick={() => markRead(n.id)}
                          className="text-xs text-blue-500 hover:underline">Mark read</button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Toast popup */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[70] bg-gray-800 text-white px-4 py-3 rounded-lg shadow-xl text-sm max-w-sm animate-pulse">
          <div className="flex items-start gap-2">
            <span>{notificationIcon(toast.type)}</span>
            <div>
              <p className="font-medium">{toast.message}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{relativeTime(toast.created_at)}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}