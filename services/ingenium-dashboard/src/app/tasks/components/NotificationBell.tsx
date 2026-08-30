"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api, TaskNotification } from "../../../lib/api";
import { formatRelativeTime } from "../../../lib/time";
import { Dropdown, DropdownItem, DropdownPanel, DropdownTrigger } from "../../components/Dropdown";

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

/**
 * Notification bell with polling, toast popups, and a dropdown panel.
 *
 * Polls every 30s for new notifications assigned to the "orchestrator" agent.
 * New notifications detected between polls trigger a toast (auto-dismissed after 5s).
 * The dropdown closes on outside click via a mousedown listener.
 *
 * Uses a ref (`prevIdsRef`) to track already-seen notification IDs for toast
 * deduplication across polling cycles.
 */
export default function NotificationBell({ project, onTaskClick }: NotificationBellProps) {
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toast, setToast] = useState<TaskNotification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const prevIdsRef = useRef<Set<string>>(new Set());

  const fetchNotifications = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await api.tasks.notifications("orchestrator", true, project);
      const fresh = r.data ?? [];
      const prevIds = prevIdsRef.current;

      const newOnes = fresh.filter((n) => !prevIds.has(n.id));
      if (newOnes.length > 0 && !panelOpen) {
        setToast(newOnes[newOnes.length - 1]!);
        setTimeout(() => setToast(null), 5000);
      }

      prevIdsRef.current = new Set(fresh.map((n) => n.id));
      setNotifications(fresh);
    } catch {
      setError("Unable to load notifications");
    } finally {
      setLoading(false);
    }
  }, [project, panelOpen]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

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
      <Dropdown open={panelOpen} onOpenChange={setPanelOpen}>
        <DropdownTrigger
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
          title="Notifications"
          className="relative rounded-full p-2 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
              {unreadCount}
            </span>
          )}
        </DropdownTrigger>

        {/* Dropdown panel */}
        {panelOpen && (
          <DropdownPanel aria-label="Notifications" className="right-0 top-full mt-1 w-80 max-h-96 p-0">
            <div className="px-3 py-2 border-b border-[var(--color-border-muted)] flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--color-text-primary)]">Notifications</span>
              {unreadCount > 0 && (
                <button type="button" onClick={() => notifications.forEach((n) => !n.read && markRead(n.id))}
                  role="menuitem"
                  className="text-xs text-[var(--color-text-link)] hover:underline">Mark all read</button>
              )}
            </div>
            {loading ? (
              <div className="px-3 py-4 text-center text-sm text-[var(--color-text-muted)]" role="status">Loading notifications…</div>
            ) : error ? (
              <div className="px-3 py-4 text-center text-sm text-[var(--color-error-text)]" role="alert">{error}</div>
            ) : notifications.length === 0 ? (
              <div className="px-3 py-4 text-sm text-[var(--color-text-muted)] text-center">No notifications</div>
            ) : (
              notifications.map((n) => (
                <div key={n.id} className="flex items-start gap-1 border-b border-[var(--color-border-muted)]">
                  <DropdownItem
                    closeOnSelect={false}
                    selected={!n.read}
                    onClick={() => onTaskClick?.(n.task_id)}
                    className="min-w-0 flex-1 items-start rounded-none px-3 py-2 text-sm"
                  >
                    <span className="mt-0.5 shrink-0">{notificationIcon(n.type)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-medium text-[var(--color-text-primary)]">{n.message}</span>
                      <span className="mt-0.5 block text-xs text-[var(--color-text-muted)]">{formatRelativeTime(n.created_at)}</span>
                    </span>
                  </DropdownItem>
                  {!n.read && (
                    <DropdownItem
                      closeOnSelect={false}
                      aria-label={`Mark notification read: ${n.message}`}
                      onClick={() => markRead(n.id)}
                      className="w-auto shrink-0 rounded-none px-2 py-2 text-xs text-[var(--color-text-link)]"
                    >
                      Mark read
                    </DropdownItem>
                  )}
                </div>
              ))
            )}
          </DropdownPanel>
        )}
      </Dropdown>

      {/* Toast popup */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-[70] bg-gray-800 text-white px-4 py-3 rounded-lg shadow-xl text-sm max-w-sm animate-pulse">
          <div className="flex items-start gap-2">
            <span>{notificationIcon(toast.type)}</span>
            <div>
              <p className="font-medium">{toast.message}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{formatRelativeTime(toast.created_at)}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
