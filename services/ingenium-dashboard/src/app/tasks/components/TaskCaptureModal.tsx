"use client";

import { FormEvent, useId, useState } from "react";
import {
  api,
  EmailTaskCaptureSource,
  ContextTaskCaptureSource,
  DocsTaskCaptureSource,
  ChatTaskCaptureSource,
  TaskCaptureResult,
} from "../../../lib/api";
import Overlay from "../../components/Overlay";

type SharedProps = {
  isOpen: boolean;
  onClose: () => void;
  onCaptured: (result: TaskCaptureResult) => void;
};

export type TaskCaptureModalProps = SharedProps & (
  | { source: EmailTaskCaptureSource; project?: string }
  | { source: ChatTaskCaptureSource; project?: string }
  | { source: ContextTaskCaptureSource | DocsTaskCaptureSource; project: string }
);

/** A title-only capture form. Source content and task metadata never enter this UI. */
export function TaskCaptureModal(props: TaskCaptureModalProps) {
  const { isOpen, onClose, onCaptured, source } = props;
  const titleId = useId();
  const errorId = useId();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function handleClose(): void {
    setTitle("");
    setSaving(false);
    setError("");
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const normalizedTitle = title.trim();
    if (!normalizedTitle) {
      setError("Title is required.");
      return;
    }
    if ((source.source_type === "context" || source.source_type === "docs") && !props.project) {
      setError(`${source.source_type === "docs" ? "Docs" : "Context"} task capture requires a selected project.`);
      return;
    }

    setSaving(true);
    setError("");
    try {
      let response;
      if (source.source_type === "context") {
        response = await api.tasks.capture({ ...source, title: normalizedTitle }, props.project!);
      } else if (source.source_type === "docs") {
        response = await api.tasks.capture({ ...source, title: normalizedTitle }, props.project!);
      } else if (source.source_type === "email") {
        response = await api.tasks.capture({ ...source, title: normalizedTitle });
      } else {
        response = await api.tasks.capture({ ...source, title: normalizedTitle });
      }
      onCaptured(response.data);
      handleClose();
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : "Failed to create task.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay
      isOpen={isOpen}
      onClose={handleClose}
      title="Create Task"
      fullScreen={false}
      panelClassName="mt-8 mb-8 w-11/12 max-w-md"
    >
      <form className="min-w-0 space-y-5" onSubmit={handleSubmit} aria-label="Create task from source">
        <div>
          <label htmlFor={titleId} className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
            Title
          </label>
          <input
            id={titleId}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              if (error) setError("");
            }}
            className="min-h-11 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:border-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
            placeholder="Task title"
            required
            aria-describedby={error ? errorId : undefined}
          />
        </div>

        {error && <p id={errorId} role="alert" className="text-sm text-[var(--color-error-text)]">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={saving}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded bg-[var(--color-accent)] px-4 py-2 text-sm text-white hover:bg-[var(--color-text-link-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Creating..." : "Create Task"}
          </button>
        </div>
      </form>
    </Overlay>
  );
}

export default TaskCaptureModal;
