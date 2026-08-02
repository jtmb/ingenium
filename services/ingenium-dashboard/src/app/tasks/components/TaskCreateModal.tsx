"use client";

import { useState, useEffect, useCallback, useId } from "react";
import { api, Task, BoardColumn } from "../../../lib/api";
import Overlay from "../../components/Overlay";
import Select from "../../components/Select";

type TaskCreateModalProps = {
  isOpen: boolean;
  project: string;
  onClose: () => void;
  onCreated: (task: Task) => void;
};

const PRIORITY_OPTIONS = [
  { id: "", label: "—" },
  { id: "critical", label: "Critical" },
  { id: "high", label: "High" },
  { id: "medium", label: "Medium" },
  { id: "low", label: "Low" },
];

/**
 * Task creation modal with full form (title, status, assignee, priority,
 * due date, issue type, estimate, description).
 *
 * Creation is a two-step process:
 * 1. `api.tasks.create()` always creates with column_id="todo"
 * 2. If a different status was selected, `api.tasks.move()` is called
 *
 * This avoids duplicating the creation logic server-side while still allowing
 * the user to place the task in any column from the UI.
 *
 * The form is reset every time the modal opens via a `useEffect` keyed on `isOpen`.
 */
export default function TaskCreateModal({
  isOpen,
  project,
  onClose,
  onCreated,
}: TaskCreateModalProps) {
  const formId = useId();
  const fieldIds = {
    title: `${formId}-title`,
    status: `${formId}-status`,
    assignee: `${formId}-assignee`,
    priority: `${formId}-priority`,
    dueDate: `${formId}-due-date`,
    issueType: `${formId}-issue-type`,
    estimate: `${formId}-estimate`,
    description: `${formId}-description`,
  };
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("todo");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [issueType, setIssueType] = useState("task");
  const [estimate, setEstimate] = useState("");

  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    api.tasks
      .boardConfig(project)
      .then((r) => {
        if (r.data?.columns) {
          try {
            const parsed =
              typeof r.data.columns === "string"
                ? JSON.parse(r.data.columns)
                : r.data.columns;
            if (Array.isArray(parsed) && parsed.length) {
              setColumns(parsed.sort((a: any, b: any) => a.order - b.order));
            }
          } catch {
            // Use defaults
          }
        }
      })
      .catch(() => {});
  }, [isOpen, project]);

  // Reset all form fields when the modal opens.
  useEffect(() => {
    if (isOpen) {
      setTitle("");
      setDescription("");
      setStatus("todo");
      setAssignee("");
      setPriority("");
      setDueDate("");
      setIssueType("task");
      setEstimate("");
      setError("");
    }
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const created = await api.tasks.create(title.trim(), project, {
        description: description || undefined,
        assigned_to: assignee || undefined,
        priority: priority || undefined,
        due_date: dueDate || undefined,
        issue_type: issueType || undefined,
        estimate_minutes: estimate ? Number(estimate) : undefined,
      });

      let finalTask = created.data;

      // The API creates tasks in todo, so move this result to honor the selected column.
      if (status !== "todo") {
        await api.tasks.move(created.data.id, status, project);
        finalTask = { ...created.data, column_id: status };
      }

      onCreated(finalTask);
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to create task.");
    } finally {
      setSaving(false);
    }
  }, [
    title,
    description,
    status,
    assignee,
    priority,
    dueDate,
    issueType,
    estimate,
    project,
    onCreated,
    onClose,
  ]);

  const statusOptions =
    columns.length > 0
      ? columns
      : [
          { id: "todo", name: "To Do", order: 0 },
          { id: "in_progress", name: "In Progress", order: 1 },
          { id: "review", name: "Review", order: 2 },
          { id: "done", name: "Done", order: 3 },
        ];

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      title="New Task"
      fullScreen={false}
    >
      <div className="space-y-5">
        {/* Field grid — mirrors TaskDetail.tsx layout */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          {/* Title (required) */}
          <div>
            <label htmlFor={fieldIds.title} className="block text-xs font-medium text-gray-500 mb-1">
              Title *
            </label>
            <input
              id={fieldIds.title}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (error) setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubmit();
              }}
              placeholder="Task title"
              className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
              autoFocus
            />
          </div>

          {/* Status */}
          <div>
            <label htmlFor={fieldIds.status} className="block text-xs font-medium text-gray-500 mb-1">
              Status
            </label>
            <Select
              id={fieldIds.status}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] px-2 py-1.5 hover:bg-[var(--color-surface-hover)] cursor-pointer text-[var(--color-text-primary)]"
            >
              {statusOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>

          {/* Assignee */}
          <div>
            <label htmlFor={fieldIds.assignee} className="block text-xs font-medium text-gray-500 mb-1">
              Assignee
            </label>
            <input
              id={fieldIds.assignee}
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              placeholder="Unassigned"
              className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
            />
          </div>

          {/* Priority */}
          <div>
            <label htmlFor={fieldIds.priority} className="block text-xs font-medium text-gray-500 mb-1">
              Priority
            </label>
            <Select
              id={fieldIds.priority}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] px-2 py-1.5 hover:bg-[var(--color-surface-hover)] cursor-pointer text-[var(--color-text-primary)]"
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Due Date */}
          <div>
            <label htmlFor={fieldIds.dueDate} className="block text-xs font-medium text-gray-500 mb-1">
              Due Date
            </label>
            <input
              id={fieldIds.dueDate}
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
            />
          </div>

          {/* Issue Type */}
          <div>
            <label htmlFor={fieldIds.issueType} className="block text-xs font-medium text-gray-500 mb-1">
              Issue Type
            </label>
            <Select
              id={fieldIds.issueType}
              value={issueType}
              onChange={(e) => setIssueType(e.target.value)}
              className="w-full border border-[var(--color-border)] rounded text-sm bg-[var(--color-surface)] px-2 py-1.5 hover:bg-[var(--color-surface-hover)] cursor-pointer text-[var(--color-text-primary)]"
            >
              <option value="epic">Epic</option>
              <option value="story">Story</option>
              <option value="task">Task</option>
              <option value="subtask">Subtask</option>
            </Select>
          </div>

          {/* Estimate */}
          <div>
            <label htmlFor={fieldIds.estimate} className="block text-xs font-medium text-gray-500 mb-1">
              Estimate (minutes)
            </label>
            <input
              id={fieldIds.estimate}
              type="number"
              min="0"
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              placeholder="min"
              className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label htmlFor={fieldIds.description} className="block text-xs font-medium text-gray-500 mb-1">
            Description
          </label>
          <textarea
            id={fieldIds.description}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Task description..."
            className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm min-h-[100px]"
          />
        </div>

        {/* Error */}
        {error && (
          <div className="text-red-600 text-sm font-medium">{error}</div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="bg-blue-600 text-white py-2 px-4 rounded text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Creating..." : "Create Task"}
          </button>
          <button
            onClick={onClose}
            className="border border-[var(--color-border)] text-[var(--color-text-secondary)] py-2 px-4 rounded text-sm hover:bg-[var(--color-surface-hover)]"
          >
            Cancel
          </button>
        </div>
      </div>
    </Overlay>
  );
}
