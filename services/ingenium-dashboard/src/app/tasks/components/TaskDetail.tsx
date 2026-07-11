"use client";

import { useState, useEffect, useCallback } from "react";
import { api, Task, TaskComment, TaskActivity } from "../../../lib/api";
import Overlay from "../../components/Overlay";

type TaskDetailProps = {
  task: Task;
  project: string;
  onClose: () => void;
  onTaskUpdated: (updated: Task) => void;
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

export default function TaskDetail({ task, project, onClose, onTaskUpdated }: TaskDetailProps) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [activity, setActivity] = useState<TaskActivity[]>([]);
  const [newComment, setNewComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Editable fields
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [columnId, setColumnId] = useState(task.column_id);
  const [assignedTo, setAssignedTo] = useState(task.assigned_to ?? "");
  const [priority, setPriority] = useState(task.priority ?? "");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [issueType, setIssueType] = useState(task.issue_type ?? "");
  const [estimatedHours, setEstimatedHours] = useState(task.estimated_hours?.toString() ?? "");
  const [spentHours, setSpentHours] = useState(task.spent_hours?.toString() ?? "");

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setColumnId(task.column_id);
    setAssignedTo(task.assigned_to ?? "");
    setPriority(task.priority ?? "");
    setDueDate(task.due_date ?? "");
    setIssueType(task.issue_type ?? "");
    setEstimatedHours(task.estimated_hours?.toString() ?? "");
    setSpentHours(task.spent_hours?.toString() ?? "");
  }, [task]);

  // Load comments and activity
  useEffect(() => {
    api.tasks.comments(task.id, project).then((r) => setComments(r.data ?? [])).catch(() => {});
    api.tasks.activity(task.id, project).then((r) => setActivity(r.data ?? [])).catch(() => {});
  }, [task.id, project]);

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
        estimated_hours: estimatedHours ? Number(estimatedHours) : undefined,
        spent_hours: spentHours ? Number(spentHours) : undefined,
      }, project);
      onTaskUpdated(updated.data);
    } catch {
      // Silently fail – user can retry
    } finally {
      setSaving(false);
    }
  }, [task.id, title, description, columnId, assignedTo, priority, dueDate, issueType, estimatedHours, spentHours, project, onTaskUpdated]);

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

  const handleAddComment = useCallback(async () => {
    if (!newComment.trim()) return;
    try {
      const res = await api.tasks.addComment(task.id, newComment.trim(), project);
      setComments([...comments, res.data]);
      setNewComment("");
    } catch {
      // ignore
    }
  }, [newComment, task.id, project, comments]);

  return (
    <Overlay
      isOpen={true}
      onClose={onClose}
      title={task.title}
      subtitle={`Created ${new Date(task.created_at).toLocaleString()}`}
    >
      <div className="space-y-6">
        {/* Editable fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select
              value={columnId}
              onChange={(e) => setColumnId(e.target.value)}
              className="w-full border border-gray-200 rounded text-sm bg-white px-2 py-1.5 hover:bg-gray-50 cursor-pointer"
            >
              {COLUMN_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Assignee</label>
            <input
              value={assignedTo}
              onChange={(e) => setAssignedTo(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
              placeholder="Unassigned"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full border border-gray-200 rounded text-sm bg-white px-2 py-1.5 hover:bg-gray-50 cursor-pointer"
            >
              <option value="">—</option>
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Issue Type</label>
            <input
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
              placeholder="bug, feature, task..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Est. Hours</label>
            <input
              type="number"
              value={estimatedHours}
              onChange={(e) => setEstimatedHours(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
              placeholder="0"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Spent Hours</label>
            <input
              type="number"
              value={spentHours}
              onChange={(e) => setSpentHours(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
              placeholder="0"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm min-h-[80px]"
            placeholder="Task description..."
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="bg-red-600 text-white py-2 px-4 rounded text-sm hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? "Deleting..." : "Delete Task"}
          </button>
        </div>

        {/* Activity log */}
        {activity.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Activity</h3>
            <div className="space-y-1 text-xs text-gray-500 max-h-32 overflow-y-auto">
              {activity.map((a) => (
                <div key={a.id} className="flex justify-between">
                  <span>
                    <strong>{a.actor ?? "System"}</strong> {a.action}
                    {a.field ? ` ${a.field}` : ""}
                    {a.old_value && a.new_value ? ` from "${a.old_value}" to "${a.new_value}"` : ""}
                  </span>
                  <span className="text-gray-400">
                    {new Date(a.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Comments */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Comments</h3>
          <div className="space-y-2 mb-3 max-h-40 overflow-y-auto">
            {comments.map((c) => (
              <div key={c.id} className="bg-gray-50 p-2 rounded text-sm">
                <div className="flex justify-between mb-1">
                  <span className="text-xs font-medium text-gray-600">{c.author ?? "Anonymous"}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-gray-700 whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
            {comments.length === 0 && (
              <p className="text-xs text-gray-400">No comments yet.</p>
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddComment()}
              placeholder="Add a comment..."
              className="flex-1 border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
            <button
              onClick={handleAddComment}
              className="bg-blue-600 text-white py-1.5 px-3 rounded text-sm hover:bg-blue-700"
            >
              Post
            </button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
