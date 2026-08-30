"use client";

import type { RuntimeWorkspaceController } from "@/lib/use-runtime-launch";

export default function RuntimeWorkspacePicker({
  controller,
  product,
}: {
  controller: RuntimeWorkspaceController;
  product: string;
}) {
  const { status, workspaces, selectedWorkspaceId, error, selectWorkspace, start, retry } = controller;

  if (status === "loading") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface-muted)] p-4" role="status" aria-live="polite">
        <p className="text-sm text-[var(--color-text-secondary)]">Loading authorized workspaces…</p>
      </div>
    );
  }

  if (status === "starting") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface-muted)] p-4" role="status" aria-live="polite">
        <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center hover:shadow-md transition-shadow">
          <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Starting workspace</h2>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Preparing the isolated runtime for {product}. This check is bounded.</p>
        </div>
      </div>
    );
  }

  if (status === "empty" || status === "unavailable" || status === "error") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-surface-muted)] p-4">
        <div className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 text-center hover:shadow-md transition-shadow" role="alert">
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
            {status === "empty" ? "No authorized workspaces" : "Workspace picker unavailable"}
          </h2>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{error}</p>
          {status !== "empty" && (
            <button
              type="button"
              onClick={retry}
              className="mt-4 rounded border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
            >
              Retry workspace list
            </button>
          )}
        </div>
      </div>
    );
  }

  if (status !== "selecting") return null;

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
  const selectionUnavailable = !selectedWorkspace || selectedWorkspace.status === "unavailable";

  return (
    <div className="absolute inset-0 overflow-y-auto bg-[var(--color-surface-muted)] p-4 sm:p-6">
      <form
        className="mx-auto w-full max-w-2xl rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:shadow-md transition-shadow sm:p-6"
        onSubmit={(event) => { event.preventDefault(); void start(); }}
      >
        <fieldset>
          <legend className="text-lg font-semibold text-[var(--color-text-primary)]">Choose a workspace for {product}</legend>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Starting or resuming a workspace is always explicit. A remembered choice is only a preference.</p>
          <div className="mt-4 grid grid-cols-1 gap-3" role="list">
            {workspaces.map((workspace) => {
              const disabled = workspace.status === "unavailable";
              return (
                <label
                  key={workspace.id}
                  className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border p-4 hover:shadow-md transition-shadow focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-text-link)] ${
                    selectedWorkspaceId === workspace.id ? "border-blue-600 bg-[var(--color-surface-selected)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"
                  } ${disabled ? "cursor-not-allowed opacity-60" : "hover:bg-[var(--color-surface-hover)]"}`}
                  role="listitem"
                >
                  <input
                    type="radio"
                    name="runtime-workspace"
                    value={workspace.id}
                    checked={selectedWorkspaceId === workspace.id}
                    disabled={disabled}
                    onChange={() => selectWorkspace(workspace.id)}
                    className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">{workspace.projectName}</span>
                    <span className="block truncate text-xs text-[var(--color-text-secondary)]">{workspace.organizationName}</span>
                  </span>
                  <span className="shrink-0 text-xs capitalize text-[var(--color-text-muted)]">{workspace.status}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={retry}
            className="rounded border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
          >
            Refresh list
          </button>
          <button
            type="submit"
            disabled={selectionUnavailable}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Open workspace
          </button>
        </div>
      </form>
    </div>
  );
}
