"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { api, Task, TaskComment, TaskActivity, TaskLink, Agent, BoardConfig, CustomFieldDef } from "../../../lib/api";
import Overlay from "../../components/Overlay";
import MarkdownViewer from "../../components/MarkdownViewer";

type TaskDetailProps = {
  task: Task;
  project: string;
  onClose: () => void;
  onTaskUpdated: (updated: Task) => void;
  onTaskClick?: (task: Task) => void;
};

const COLUMN_OPTIONS = [
  { id: "todo", label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "review", label: "Review" },
  { id: "done", label: "Done" },
];

const PRIORITY_OPTIONS = [
  { id: "critical", label: "Critical" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

// ── Time Pie (SVG) ──────────────────────────────────────────────────────────

/**
 * SVG donut chart showing spent vs remaining vs estimate.
 * - Green: within estimate with remaining time
 * - Amber: all time used but not over estimate
 * - Red: over estimate
 */
function TimePieChart({ spent, remaining, estimate }: { spent: number; remaining: number; estimate: number }) {
  const total = spent + remaining;
  const pct = total > 0 ? spent / total : 0;
  const overEstimate = estimate > 0 && spent > estimate;
  const r = 36;
  const circ = 2 * Math.PI * r;
  const offset = total > 0 ? circ * (1 - pct) : circ;
  const fill = overEstimate ? "#ef4444" : remaining > 0 ? "#22c55e" : "#f59e0b";

  return (
    <div className="flex items-center gap-3">
      <svg width="44" height="44" viewBox="0 0 80 80" className="shrink-0">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#e5e7eb" strokeWidth="6" />
        {total > 0 && (
          <circle
            cx="40" cy="40" r={r} fill="none" stroke={fill} strokeWidth="6"
            strokeDasharray={circ} strokeDashoffset={offset}
            strokeLinecap="round" transform="rotate(-90 40 40)"
          />
        )}
        <text x="40" y="44" textAnchor="middle" fontSize="14" fill="#4b5563" fontFamily="sans-serif" fontWeight="600">
          {total > 0 ? Math.round(pct * 100) : "--"}
        </text>
      </svg>
      <div className="text-xs text-gray-500">
        <div>Spent: {spent}m</div>
        <div>Remaining: {remaining}m</div>
        {estimate > 0 && <div className={overEstimate ? "text-red-600 font-semibold" : ""}>Est: {estimate}m</div>}
      </div>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

/** Map activity action strings to emoji for the activity sidebar. */
function activityIcon(action: string | undefined | null): string {
  if (!action) return "📋";
  if (action.includes("moved")) return "🔄";
  if (action.includes("edited") || action.includes("updated")) return "✏️";
  if (action.includes("assigned")) return "👤";
  if (action.includes("comment")) return "💬";
  if (action.includes("linked") || action.includes("link")) return "🔗";
  return "📋";
}

/** Build a human-readable string from a TaskActivity entry. */
function activityDescription(a: TaskActivity): string {
  const actor = a.actor ?? "System";
  const action = a.action ?? "updated";
  const field = a.field ? ` ${a.field}` : "";
  if (a.old_value && a.new_value) {
    return `${actor} ${action}${field} from "${a.old_value}" to "${a.new_value}"`;
  }
  return `${actor} ${action}${field}`;
}

// ── Custom Field Formula Evaluation ────────────────────────────────────────

/**
 * Evaluate a simple formula DSL for computed custom fields.
 * Currently supports: "field_name + N days" → returns an ISO date string.
 * Returns "—" for unrecognized formulas or missing inputs.
 */
function evaluateFormula(formula: string, values: Record<string, any>): string {
  const match = formula.match(/^(\S+)\s*\+\s*(\d+)\s*days?$/i);
  if (match) {
    const field = match[1]!;
    const days = parseInt(match[2]!, 10);
    const baseVal = values[field];
    if (baseVal) {
      const d = new Date(String(baseVal));
      if (!isNaN(d.getTime())) {
        d.setDate(d.getDate() + days);
        return d.toISOString().split("T")[0]!;
      }
    }
  }
  return "—";
}

// ── TaskDetail ─────────────────────────────────────────────────────────────

/**
 * Full task detail overlay with edit fields, time tracking, comments,
 * activity log, dependency linking, custom fields, and job dispatch.
 *
 * Custom fields are stored in the DB as JSON.stringify'd text (same pattern as
 * `columns` and `custom_field_defs` in BoardConfig). Both are parsed here from
 * their string-encoded transport form.
 *
 * @mentions in the description trigger a live agent search dropdown positioned
 * at the cursor using computed pixel offsets from the textarea.
 */
export default function TaskDetail({ task, project, onClose, onTaskUpdated, onTaskClick }: TaskDetailProps) {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [columnId, setColumnId] = useState(task.column_id);
  const [assignedTo, setAssignedTo] = useState(task.assigned_to ?? "");
  const [priority, setPriority] = useState(task.priority ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [issueType, setIssueType] = useState(task.issue_type ?? "");
  const [estimateMin, setEstimateMin] = useState(task.estimate_minutes?.toString() ?? "");
  const [spentMin, setSpentMin] = useState(task.spent_minutes?.toString() ?? "");
  const [remainingMin, setRemainingMin] = useState(task.remaining_minutes?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [descMode, setDescMode] = useState<"edit" | "preview">("edit");
  const [mentionSearch, setMentionSearch] = useState("");
  const [showMentions, setShowMentions] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [mentionAnchor, setMentionAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [comments, setComments] = useState<TaskComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [showActivity, setShowActivity] = useState(true);

  const [links, setLinks] = useState<TaskLink[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [depSearch, setDepSearch] = useState("");
  const [depSearchOpen, setDepSearchOpen] = useState(false);
  const [depSearchResults, setDepSearchResults] = useState<Task[]>([]);
  const [depType, setDepType] = useState<"blocks" | "blocked_by">("blocks");

  const [boardConfig, setBoardConfig] = useState<BoardConfig | null>(null);
  // The DB stores custom_fields as JSON.stringify'd text and returns it unparsed.
  // Must parse here, same as columns/custom_field_defs in BoardView.
  const [customFields, setCustomFields] = useState<Record<string, any>>(() => {
    if (typeof task.custom_fields === "string") {
      try { return JSON.parse(task.custom_fields); } catch { return {}; }
    }
    return task.custom_fields ?? {};
  });

  const [dispatching, setDispatching] = useState(false);
  const [dispatchMsg, setDispatchMsg] = useState("");

  // Sync local state when the task prop changes (e.g., navigating between tasks via task dependency links).
  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setColumnId(task.column_id);
    setAssignedTo(task.assigned_to ?? "");
    setPriority(task.priority ?? "");
    setDueDate(task.due_date ?? "");
    setIssueType(task.issue_type ?? "");
    setEstimateMin(task.estimate_minutes?.toString() ?? "");
    setSpentMin(task.spent_minutes?.toString() ?? "");
    setRemainingMin(task.remaining_minutes?.toString() ?? "");
    if (typeof task.custom_fields === "string") {
      try { setCustomFields(JSON.parse(task.custom_fields)); } catch { setCustomFields({}); }
    } else {
      setCustomFields(task.custom_fields ?? {});
    }
  }, [task]);

  // Load all ancillary data when the task changes.
  useEffect(() => {
    api.tasks.comments(task.id, project).then((r) => setComments(r.data ?? [])).catch(() => {});
    api.tasks.activity(task.id, project).then((r) => setActivity(r.data ?? [])).catch(() => {});
    api.tasks.links(task.id, project).then((r) => setLinks(r.data ?? [])).catch(() => {});
    api.agents.list(project).then((r) => setAgents(r.data ?? [])).catch(() => {});
    api.tasks.list(project).then((r) => setAllTasks(r.data ?? [])).catch(() => {});
    api.tasks.boardConfig(project).then((r) => setBoardConfig(r.data ?? null)).catch(() => {});
  }, [task.id, project]);

  /**
   * Detect `@` mentions as the user types in the description textarea.
   * When an `@` is followed by characters, compute the pixel position of the
   * caret and show a dropdown of matching agents below the cursor.
   *
   * Uses lineHeight (20px) × charWidth (8px) estimates for positioning since
   * we can't measure rendered text dimensions in a textarea easily. This is
   * a best-effort approximation that works well for single-line mentions.
   */
  const handleDescChange = useCallback((value: string) => {
    setDescription(value);

    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = value.substring(0, cursorPos);
    const atMatch = textBeforeCursor.match(/@(\S*)$/);

    if (atMatch) {
      const search = atMatch[1] ?? "";
      setMentionSearch(search);
      setShowMentions(true);
      setMentionIndex(0);

      const textBefore = value.substring(0, cursorPos - atMatch[0].length);
      const lines = textBefore.split("\n");
      const lineHeight = 20;
      const charWidth = 8;
      const lastLine = lines[lines.length - 1] ?? "";
      setMentionAnchor({
        top: (lines.length - 1) * lineHeight + 4,
        left: (lastLine.length + 2) * charWidth,
      });
    } else {
      setShowMentions(false);
    }
  }, []);

  const filteredAgents = useMemo(() => {
    if (!showMentions || !mentionSearch) return agents.slice(0, 9);
    const q = mentionSearch.toLowerCase();
    return agents.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 9);
  }, [agents, showMentions, mentionSearch]);

  const insertMention = useCallback((agentName: string) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart;
    const textBefore = description.substring(0, cursorPos);
    const textAfter = description.substring(cursorPos);
    const atIdx = textBefore.lastIndexOf("@");

    if (atIdx !== -1) {
      const beforeAt = textBefore.substring(0, atIdx);
      const newDesc = beforeAt + `@${agentName} ` + textAfter;
      setDescription(newDesc);
      setShowMentions(false);

      const newPos = beforeAt.length + agentName.length + 2;
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(newPos, newPos);
      });
    }
  }, [description]);

  const handleMentionKey = useCallback((e: React.KeyboardEvent) => {
    if (!showMentions) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setMentionIndex((i) => Math.min(i + 1, filteredAgents.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setMentionIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const agent = filteredAgents[mentionIndex];
      if (agent) insertMention(agent.name);
    } else if (e.key === "Escape") {
      setShowMentions(false);
    }
  }, [showMentions, filteredAgents, mentionIndex, insertMention]);

  /**
   * Persist all editable fields to the API. The custom_fields object is sent
   * as-is; the API serializes it to JSON text for DB storage.
   */
  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const updated = await api.tasks.update(task.id, {
        title,
        description: description || undefined,
        column_id: columnId,
        assigned_to: assignedTo || undefined,
        priority: priority || undefined,
        due_date: dueDate || undefined,
        issue_type: issueType || undefined,
        estimate_minutes: estimateMin ? Number(estimateMin) : undefined,
        spent_minutes: spentMin ? Number(spentMin) : undefined,
        remaining_minutes: remainingMin ? Number(remainingMin) : undefined,
        custom_fields: customFields,
      }, project);
      onTaskUpdated(updated.data);
    } catch {
      // Silently fail — the user can retry.
    } finally {
      setSaving(false);
    }
  }, [task.id, title, description, columnId, assignedTo, priority, dueDate, issueType, estimateMin, spentMin, remainingMin, customFields, project, onTaskUpdated]);

  const handleDelete = useCallback(async () => {
    if (!confirm("Delete this task? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await api.tasks.delete(task.id, project);
      onClose();
    } catch {
      setDeleting(false);
    }
  }, [task.id, project, onClose]);

  /**
   * Create a background job from this task using the assigned_to agent.
   * The job's prompt_template is the task description (or title as fallback).
   * This enables the "Dispatch as Job" button that links task tracking to the
   * job queue.
   */
  const handleDispatchAsJob = useCallback(async () => {
    if (!task.assigned_to || !task.title) return;
    setDispatching(true);
    setDispatchMsg("");
    try {
      const job = await api.jobs.create({
        name: `[Task] ${task.title}`,
        description: task.description ?? undefined,
        agent: task.assigned_to,
        prompt_template: task.description ?? task.title,
      }, project);
      await api.jobs.run(job.data.id, project);
      setDispatchMsg(`Job created and queued: ${job.data.name}`);
    } catch (err: any) {
      setDispatchMsg(err?.message ?? "Failed to dispatch job");
    } finally {
      setDispatching(false);
    }
  }, [task.title, task.description, task.assigned_to, project]);

  const handleAddComment = useCallback(async () => {
    if (!newComment.trim()) return;
    try {
      const res = await api.tasks.addComment(task.id, newComment.trim(), "user", undefined, project);
      setComments((prev) => [...prev, res.data]);
      setNewComment("");
    } catch {
      // ignore
    }
  }, [newComment, task.id, project]);

  const handleReply = useCallback(async () => {
    if (!replyBody.trim() || !replyTo) return;
    try {
      const res = await api.tasks.addComment(task.id, replyBody.trim(), "user", replyTo, project);
      setComments((prev) => [...prev, res.data]);
      setReplyBody("");
      setReplyTo(null);
    } catch {
      // ignore
    }
  }, [replyBody, replyTo, task.id, project]);

  /**
   * Optimistic reaction toggle: increment the reaction count immediately, then
   * persist. On failure, rollback by decrementing. Uses Math.max(0, ...) to
   * prevent negative counts on rollback.
   */
  const handleReact = useCallback(async (commentId: string, reaction: string) => {
    setComments((prev) =>
      prev.map((c) => {
        if (c.id !== commentId) return c;
        const current = c.reactions?.[reaction] ?? 0;
        return { ...c, reactions: { ...c.reactions, [reaction]: current + 1 } };
      })
    );
    try {
      await api.tasks.reactToComment(task.id, commentId, reaction, project);
    } catch {
      setComments((prev) =>
        prev.map((c) => {
          if (c.id !== commentId) return c;
          const current = c.reactions?.[reaction] ?? 0;
          return { ...c, reactions: { ...c.reactions, [reaction]: Math.max(0, current - 1) } };
        })
      );
    }
  }, [task.id, project]);

  // Split links into "this blocks X" and "this is blocked by X" for the two dependency lists.
  const blocksLinks = useMemo(() => links.filter((l) => l.link_type === "blocks" && l.task_id === task.id), [links, task.id]);
  const blockedByLinks = useMemo(() => links.filter((l) => l.link_type === "blocked_by" || (l.link_type === "blocks" && l.linked_task_id === task.id)), [links, task.id]);

  const getTaskById = useCallback((id: string) => {
    return allTasks.find((t) => t.id === id);
  }, [allTasks]);

  /** Get the "other end" of a link — the task that is *not* the current one. */
  const otherEndId = useCallback((link: TaskLink) => {
    return link.task_id === task.id ? link.linked_task_id : link.task_id;
  }, [task.id]);

  const handleDepSearch = useCallback(async (q: string) => {
    setDepSearch(q);
    if (!q.trim()) {
      setDepSearchResults([]);
      return;
    }
    try {
      const r = await api.tasks.search(q, project);
      setDepSearchResults((r.data ?? []).filter((t) => t.id !== task.id));
    } catch {
      setDepSearchResults([]);
    }
  }, [task.id, project]);

  const handleAddDep = useCallback(async (targetId: string) => {
    try {
      const res = await api.tasks.addLink(task.id, { linked_task_id: targetId, link_type: depType }, project);
      setLinks((prev) => [...prev, res.data]);
      setDepSearch("");
      setDepSearchOpen(false);
      setDepSearchResults([]);
    } catch {
      // ignore
    }
  }, [task.id, depType, project]);

  const handleRemoveLink = useCallback(async (linkId: string) => {
    try {
      await api.tasks.removeLink(task.id, linkId, project);
      setLinks((prev) => prev.filter((l) => l.id !== linkId));
    } catch {
      // ignore
    }
  }, [task.id, project]);

  /**
   * Parse custom_field_defs from the board config.
   * The DB stores this as JSON.stringify'd text (same pattern as `columns`).
   * BoardView parses columns on its side; TaskDetail gets the raw string from
   * its own fetch and must parse it here.
   */
  const customFieldDefs = useMemo<CustomFieldDef[]>(() => {
    const raw = boardConfig?.custom_field_defs;
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return []; }
    }
    return Array.isArray(raw) ? raw : [];
  }, [boardConfig]);

  const handleCustomFieldChange = useCallback((fieldName: string, value: any) => {
    setCustomFields((prev) => ({ ...prev, [fieldName]: value }));
  }, []);

  // Top-level comments (thread roots) and their replies.
  const topLevelComments = useMemo(() => {
    return comments.filter((c) => !c.parent_comment_id);
  }, [comments]);

  const repliesFor = useCallback((parentId: string) => {
    return comments.filter((c) => c.parent_comment_id === parentId);
  }, [comments]);

  // --- Render ---
  return (
    <Overlay isOpen={true} onClose={onClose} title={task.title} subtitle={`Created ${new Date(task.created_at).toLocaleString()}`}>
      <div className="flex h-full gap-0">
        {/* Main content area */}
        <div className="flex-1 overflow-y-auto pr-4 space-y-6">
          {/* Editable fields grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
              <select value={columnId} onChange={(e) => setColumnId(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] px-2 py-1.5 hover:bg-[var(--color-surface-hover)] cursor-pointer text-[var(--color-text-primary)]">
                {COLUMN_OPTIONS.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Assignee</label>
              <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm" placeholder="Unassigned" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] px-2 py-1.5 hover:bg-[var(--color-surface-hover)] cursor-pointer text-[var(--color-text-primary)]">
                <option value="">—</option>
                {PRIORITY_OPTIONS.map((p) => (<option key={p.id} value={p.id}>{p.label}</option>))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Due Date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Issue Type</label>
              <select value={issueType} onChange={(e) => setIssueType(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] px-2 py-1.5 hover:bg-[var(--color-surface-hover)] cursor-pointer text-[var(--color-text-primary)]">
                <option value="epic">Epic</option>
                <option value="story">Story</option>
                <option value="task">Task</option>
                <option value="subtask">Subtask</option>
              </select>
            </div>
          </div>

          {/* Time tracking */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Time Tracking (minutes)</label>
            <div className="flex gap-4 items-start">
              <TimePieChart
                spent={spentMin ? Number(spentMin) : 0}
                remaining={remainingMin ? Number(remainingMin) : 0}
                estimate={estimateMin ? Number(estimateMin) : 0}
              />
              <div className="flex-1 grid grid-cols-3 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">Estimate</label>
                  <input type="number" value={estimateMin} onChange={(e) => setEstimateMin(e.target.value)}
                    className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-sm" placeholder="min" min="0" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">Spent</label>
                  <input type="number" value={spentMin} onChange={(e) => setSpentMin(e.target.value)}
                    className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-sm" placeholder="min" min="0" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-0.5">Remaining</label>
                  <input type="number" value={remainingMin} onChange={(e) => setRemainingMin(e.target.value)}
                    className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-sm" placeholder="min" min="0" />
                </div>
              </div>
            </div>
          </div>

          {/* Custom fields */}
          {customFieldDefs.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-2">Custom Fields</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {customFieldDefs.map((def) => {
                  if (def.formula) {
                    const computed = evaluateFormula(def.formula, customFields);
                    return (
                      <div key={def.name}>
                        <label className="block text-xs text-gray-400 mb-0.5">{def.name}</label>
                        <div className="text-sm text-gray-600 border border-[var(--color-border-muted)] rounded px-2 py-1.5 bg-gray-50">{computed}</div>
                      </div>
                    );
                  }

                  const val = customFields[def.name] ?? "";
                  return (
                    <div key={def.name}>
                      <label className="block text-xs text-gray-400 mb-0.5">{def.name}</label>
                      {def.type === "text" && (
                        <input type="text" value={val} onChange={(e) => handleCustomFieldChange(def.name, e.target.value)}
                          className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm" />
                      )}
                      {def.type === "paragraph" && (
                        <textarea value={val} onChange={(e) => handleCustomFieldChange(def.name, e.target.value)}
                          className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm min-h-[60px]" />
                      )}
                      {def.type === "number" && (
                        <input type="number" value={val} onChange={(e) => handleCustomFieldChange(def.name, e.target.value)}
                          className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm" />
                      )}
                      {def.type === "date" && (
                        <input type="date" value={val} onChange={(e) => handleCustomFieldChange(def.name, e.target.value)}
                          className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm" />
                      )}
                      {def.type === "datetime" && (
                        <input type="datetime-local" value={val} onChange={(e) => handleCustomFieldChange(def.name, e.target.value)}
                          className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm" />
                      )}
                      {def.type === "single_select" && (
                        <select value={val} onChange={(e) => handleCustomFieldChange(def.name, e.target.value)}
                          className="w-full border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] px-2 py-1.5 hover:bg-[var(--color-surface-hover)] cursor-pointer text-[var(--color-text-primary)]">
                          <option value="">—</option>
                          {(def.options ?? []).map((o) => (<option key={o} value={o}>{o}</option>))}
                        </select>
                      )}
                      {def.type === "multi_select" && (
                        <div className="space-y-1 max-h-28 overflow-y-auto border border-[var(--color-border)] rounded p-1.5">
                          {(def.options ?? []).map((o) => {
                            const selected = Array.isArray(val) ? (val as string[]).includes(o) : false;
                            return (
                              <label key={o} className="flex items-center gap-1.5 text-sm cursor-pointer hover:bg-[var(--color-surface-hover)] px-1 py-0.5 rounded">
                                <input type="checkbox" checked={selected} onChange={(e) => {
                                  const current = Array.isArray(val) ? [...val as string[]] : [];
                                  if (e.target.checked) {
                                    handleCustomFieldChange(def.name, [...current, o]);
                                  } else {
                                    handleCustomFieldChange(def.name, current.filter((v) => v !== o));
                                  }
                                }} className="rounded" />
                                {o}
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {def.type === "checkboxes" && (
                        <div className="space-y-1 max-h-28 overflow-y-auto border border-[var(--color-border)] rounded p-1.5">
                          {(def.options ?? []).map((o) => {
                            const selected = Array.isArray(val) ? (val as string[]).includes(o) : false;
                            return (
                              <label key={o} className="flex items-center gap-1.5 text-sm cursor-pointer hover:bg-[var(--color-surface-hover)] px-1 py-0.5 rounded">
                                <input type="checkbox" checked={selected} onChange={(e) => {
                                  const current = Array.isArray(val) ? [...val as string[]] : [];
                                  if (e.target.checked) {
                                    handleCustomFieldChange(def.name, [...current, o]);
                                  } else {
                                    handleCustomFieldChange(def.name, current.filter((v) => v !== o));
                                  }
                                }} className="rounded" />
                                {o}
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {def.type === "radio" && (
                        <div className="space-y-1 max-h-28 overflow-y-auto border border-[var(--color-border)] rounded p-1.5">
                          {(def.options ?? []).map((o) => (
                            <label key={o} className="flex items-center gap-1.5 text-sm cursor-pointer hover:bg-[var(--color-surface-hover)] px-1 py-0.5 rounded">
                              <input type="radio" name={`cf-${def.name}`} checked={val === o} onChange={() => handleCustomFieldChange(def.name, o)} />
                              {o}
                            </label>
                          ))}
                        </div>
                      )}
                      {def.type === "url" && (
                        <input type="url" value={val} onChange={(e) => handleCustomFieldChange(def.name, e.target.value)}
                          className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm" placeholder="https://..." />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Description with Edit/Preview + @mention */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs font-medium text-gray-500">Description</label>
              <div className="flex items-center gap-1">
                <button onClick={() => setDescMode("edit")}
                  className={`px-2 py-0.5 text-xs rounded ${descMode === "edit" ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-100"}`}>
                  Edit
                </button>
                <button onClick={() => setDescMode("preview")}
                  className={`px-2 py-0.5 text-xs rounded ${descMode === "preview" ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-100"}`}>
                  Preview
                </button>
              </div>
            </div>
            {descMode === "edit" ? (
              <div className="relative">
                <textarea ref={textareaRef} value={description}
                  onChange={(e) => handleDescChange(e.target.value)}
                  onKeyDown={handleMentionKey}
                  className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm min-h-[120px] font-mono"
                  placeholder="Task description... Supports **bold**, *italic*, `code`, ```blocks```, - [ ] checklists, @mentions" />
                {showMentions && filteredAgents.length > 0 && (
                  <div className="absolute z-10 bg-[var(--color-surface)] border border-[var(--color-border)] rounded shadow-lg max-h-40 overflow-y-auto w-48 text-[var(--color-text-primary)]"
                    style={{ top: mentionAnchor.top, left: mentionAnchor.left }}>
                    {filteredAgents.map((a, i) => (
                      <button key={a.name} onClick={() => insertMention(a.name)}
                        className={`w-full text-left px-2 py-1 text-sm hover:bg-[var(--color-surface-hover)] ${i === mentionIndex ? "bg-[var(--color-selection-bg)]" : ""}`}>
                        {a.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="border border-[var(--color-border)] rounded p-3 min-h-[80px] bg-gray-50 text-sm">
                {description ? <MarkdownViewer content={description} isMarkdown /> : (
                  <p className="text-gray-400 italic">No description.</p>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <button onClick={handleSave} disabled={saving}
              className="bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "Saving..." : "Save Changes"}
            </button>
            {task.assigned_to && (
              <button onClick={handleDispatchAsJob} disabled={dispatching}
                className="bg-green-600 text-white py-2 px-4 rounded text-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title={`Run as job using agent: ${task.assigned_to}`}>
                {dispatching ? "Dispatching..." : "▶ Dispatch as Job"}
              </button>
            )}
            <button onClick={handleDelete} disabled={deleting}
              className="bg-red-600 text-white py-2 px-4 rounded text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {deleting ? "Deleting..." : "Delete Task"}
            </button>
            {dispatchMsg && <span className="text-sm text-green-600 self-center">{dispatchMsg}</span>}
          </div>

          {/* Dependencies */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Dependencies</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Blocks */}
              <div>
                <h4 className="text-xs font-medium text-gray-500 mb-1">Blocks</h4>
                {blocksLinks.map((l) => {
                  const targetId = otherEndId(l);
                  const target = getTaskById(targetId);
                  return (
                    <div key={l.id} className="flex items-center justify-between text-sm py-0.5 group">
                      <button className="text-[var(--color-text-link)] hover:underline truncate text-left"
                        onClick={() => target && onTaskClick?.(target)}>
                        {target?.title ?? targetId}
                      </button>
                      <button onClick={() => handleRemoveLink(l.id)}
                        className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 ml-1 shrink-0">×</button>
                    </div>
                  );
                })}
                {blocksLinks.length === 0 && <p className="text-xs text-gray-400 italic">None</p>}
              </div>
              {/* Blocked by */}
              <div>
                <h4 className="text-xs font-medium text-gray-500 mb-1">Blocked by</h4>
                {blockedByLinks.map((l) => {
                  const targetId = otherEndId(l);
                  const target = getTaskById(targetId);
                  return (
                    <div key={l.id} className="flex items-center justify-between text-sm py-0.5 group">
                      <button className="text-[var(--color-text-link)] hover:underline truncate text-left"
                        onClick={() => target && onTaskClick?.(target)}>
                        {target?.title ?? targetId}
                      </button>
                      <button onClick={() => handleRemoveLink(l.id)}
                        className="text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 ml-1 shrink-0">×</button>
                    </div>
                  );
                })}
                {blockedByLinks.length === 0 && <p className="text-xs text-gray-400 italic">None</p>}
              </div>
            </div>
            {/* Add dependency */}
            <div className="mt-2 flex gap-2">
              <select value={depType} onChange={(e) => setDepType(e.target.value as "blocks" | "blocked_by")}
                className="border border-[var(--color-border)] rounded text-xs bg-[var(--color-surface)] px-2 py-1 hover:bg-[var(--color-surface-hover)] cursor-pointer text-[var(--color-text-primary)]">
                <option value="blocks">Blocks</option>
                <option value="blocked_by">Blocked by</option>
              </select>
              <div className="relative flex-1">
                <input value={depSearch} onChange={(e) => { handleDepSearch(e.target.value); setDepSearchOpen(true); }}
                  onFocus={() => setDepSearchOpen(true)}
                  placeholder="Search tasks to link..."
                  className="w-full border border-[var(--color-border)] rounded px-2 py-1 text-xs" />
                {depSearchOpen && depSearchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-10 bg-[var(--color-surface)] border border-[var(--color-border)] rounded shadow-lg max-h-32 overflow-y-auto mt-0.5 text-[var(--color-text-primary)]">
                    {depSearchResults.map((t) => (
                      <button key={t.id} onClick={() => handleAddDep(t.id)}
                        className="w-full text-left px-2 py-1 text-xs hover:bg-blue-50 border-b border-[var(--color-border-muted)]">
                        <span className="font-medium">{t.title}</span>
                        <span className="text-gray-400 ml-1">{t.column_id}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Comments section */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Comments ({comments.length})</h3>
            <div className="space-y-3 mb-3 max-h-[400px] overflow-y-auto">
              {topLevelComments.map((c) => (
                <div key={c.id}>
                  <div className="bg-gray-50 rounded p-2.5 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-600">{c.author ?? "Anonymous"}</span>
                      <div className="flex items-center gap-1">
                        {c.edited_at && <span className="text-[10px] text-gray-400 bg-gray-200 rounded px-1">edited</span>}
                        <span className="text-xs text-gray-400">{relativeTime(c.created_at)}</span>
                      </div>
                    </div>
                    <div className="text-gray-700">
                      <MarkdownViewer content={c.body} isMarkdown />
                    </div>
                    {/* Reactions */}
                    {c.reactions && Object.keys(c.reactions).length > 0 && (
                      <div className="flex gap-1 mt-1.5">
                        {Object.entries(c.reactions).map(([r, count]) => (
                          <button key={r} onClick={() => handleReact(c.id, r)}
                            className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-600">
                            {r === "👍" ? "👍" : r === "👀" ? "👀" : r} {count}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Reaction buttons + reply */}
                    <div className="flex items-center gap-1 mt-1.5 text-xs">
                      <button onClick={() => handleReact(c.id, "👍")}
                        className="text-gray-400 hover:text-gray-600 px-1 py-0.5 hover:bg-gray-200 rounded">👍</button>
                      <button onClick={() => handleReact(c.id, "👀")}
                        className="text-gray-400 hover:text-gray-600 px-1 py-0.5 hover:bg-gray-200 rounded">👀</button>
                      <button onClick={() => setReplyTo(c.id)}
                        className="text-gray-400 hover:text-gray-600 px-1 py-0.5 hover:bg-gray-200 rounded ml-1">Reply</button>
                    </div>
                  </div>
                  {/* Replies */}
                  {repliesFor(c.id).map((reply) => (
                    <div key={reply.id} className="ml-6 mt-1.5 bg-gray-50 rounded p-2 text-sm border-l-2 border-blue-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-600">{reply.author ?? "Anonymous"}</span>
                        <div className="flex items-center gap-1">
                          {reply.edited_at && <span className="text-[10px] text-gray-400 bg-gray-200 rounded px-1">edited</span>}
                          <span className="text-xs text-gray-400">{relativeTime(reply.created_at)}</span>
                        </div>
                      </div>
                      <div className="text-gray-700"><MarkdownViewer content={reply.body} isMarkdown /></div>
                    </div>
                  ))}
                  {/* Reply form */}
                  {replyTo === c.id && (
                    <div className="ml-6 mt-1.5 flex gap-2">
                      <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)}
                        placeholder="Write a reply..."
                        className="flex-1 border border-[var(--color-border)] rounded px-2 py-1 text-xs min-h-[40px]" />
                      <div className="flex flex-col gap-1">
                        <button onClick={handleReply}
                          className="bg-blue-600 text-white py-1 px-2 rounded text-xs hover:bg-blue-700">Reply</button>
                        <button onClick={() => { setReplyTo(null); setReplyBody(""); }}
                          className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {topLevelComments.length === 0 && (
                <p className="text-xs text-gray-400">No comments yet.</p>
              )}
            </div>
            {/* Add comment form */}
            <div className="flex gap-2">
              <textarea value={newComment} onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment... (supports markdown)"
                className="flex-1 border border-[var(--color-border)] rounded px-2 py-1.5 text-sm min-h-[40px]" />
              <button onClick={handleAddComment}
                className="bg-blue-600 text-white py-1.5 px-3 rounded text-sm hover:bg-blue-700 self-start">Post</button>
            </div>
          </div>
        </div>

        {/* Activity sidebar (collapsible) */}
        <div className={`border-l border-[var(--color-border)] flex flex-col transition-all duration-200 ${showActivity ? "w-64 pl-4" : "w-0 overflow-hidden"}`}>
          <button onClick={() => setShowActivity(!showActivity)}
            className="text-xs text-gray-400 hover:text-gray-600 mb-2 shrink-0 text-left">
            {showActivity ? "◀ Hide" : "▶"}
          </button>
          {showActivity && (
            <>
              <h3 className="text-sm font-semibold text-gray-700 mb-2 shrink-0">Activity</h3>
              <div className="space-y-2 text-xs overflow-y-auto flex-1 min-h-0">
                {activity.map((a: any) => {
                  const action = a.action || a.event_type || "";
                  return (
                    <div key={a.id} className="flex gap-1.5 items-start">
                      <span className="shrink-0 mt-0.5">{activityIcon(action)}</span>
                      <div className="min-w-0">
                        <p className="text-gray-600 break-words">{activityDescription(a)}</p>
                        <span className="text-gray-400">{relativeTime(a.created_at)}</span>
                      </div>
                    </div>
                  );
                })}
                {activity.length === 0 && (
                  <p className="text-gray-400 italic">No activity yet.</p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </Overlay>
  );
}