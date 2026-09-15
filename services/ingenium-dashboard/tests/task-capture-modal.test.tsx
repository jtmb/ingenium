import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const apiMocks = vi.hoisted(() => ({ capture: vi.fn() }));

vi.mock("../src/lib/api", () => ({
  api: { tasks: { capture: apiMocks.capture } },
}));

import TaskCaptureModal from "../src/app/tasks/components/TaskCaptureModal";

const captured = {
  task: { id: "task-1", title: "Follow up", column_id: "todo", created_at: "2026-07-31T00:00:00.000Z" },
  reference: {
    id: "reference-1",
    source_type: "email" as const,
    source_id: "source-1",
    display_title: "Email",
    display_detail: "Email message",
    source_timestamp: null,
    created_at: "2026-07-31T00:00:00.000Z",
    availability: "available" as const,
  },
};

function renderModal(overrides: Partial<React.ComponentProps<typeof TaskCaptureModal>> = {}) {
  const props = {
    isOpen: true,
    source: { source_type: "email" as const, account_id: "account-1", folder: "Archive", uid: "42" },
    onClose: vi.fn(),
    onCaptured: vi.fn(),
    ...overrides,
  };
  return { ...render(<TaskCaptureModal {...props} />), props };
}

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  vi.clearAllMocks();
});

describe("TaskCaptureModal", () => {
  it("opens with Close focused, tabs through Title, and restores the exact trigger", async () => {
    const onClose = vi.fn();
    const source = { source_type: "email" as const, account_id: "account-1", folder: "Archive", uid: "42" };
    const { rerender } = render(
      <>
        <button type="button" data-testid="task-capture-trigger">Open task capture</button>
        <TaskCaptureModal
          isOpen={false}
          source={source}
          onClose={onClose}
          onCaptured={vi.fn()}
        />
      </>,
    );

    const trigger = screen.getByTestId("task-capture-trigger");
    trigger.focus();
    rerender(
      <>
        <button type="button" data-testid="task-capture-trigger">Open task capture</button>
        <TaskCaptureModal
          isOpen
          source={source}
          onClose={onClose}
          onCaptured={vi.fn()}
        />
      </>,
    );

    const close = await screen.findByLabelText("Close");
    await waitFor(() => expect(document.activeElement).toBe(close));
    const title = screen.getByRole("textbox", { name: "Title" });
    fireEvent.keyDown(close, { key: "Tab" });
    // jsdom does not perform the browser's native Tab movement.
    title.focus();
    expect(document.activeElement).toBe(title);

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const create = screen.getByRole("button", { name: "Create Task" });
    fireEvent.keyDown(title, { key: "Tab" });
    cancel.focus();
    expect(document.activeElement).toBe(cancel);
    expect((create as HTMLButtonElement).disabled).toBe(true);

    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <>
        <button type="button" data-testid="task-capture-trigger">Open task capture</button>
        <TaskCaptureModal
          isOpen={false}
          source={source}
          onClose={onClose}
          onCaptured={vi.fn()}
        />
      </>,
    );
    expect(document.activeElement).toBe(trigger);
  });

  it("requires a title and renders no source content or task metadata controls", () => {
    renderModal();

    const title = screen.getByRole("textbox", { name: "Title" });
    const createTask = screen.getByRole("button", { name: "Create Task" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(title).toHaveProperty("required", true);
    expect(title.className).toContain("min-h-11");
    expect(title.className).toContain("bg-[var(--color-surface)]");
    expect(createTask.className).toContain("min-h-11");
    expect(createTask.className).toContain("min-w-11");
    expect(cancel.className).toContain("min-h-11");
    expect(cancel.className).toContain("min-w-11");
    expect((createTask as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText("Description")).toBeNull();
    expect(screen.queryByLabelText("Status")).toBeNull();
    expect(screen.queryByText("Archive")).toBeNull();
  });

  it("shows a loading state and prevents cancellation while saving", () => {
    apiMocks.capture.mockReturnValue(new Promise(() => {}));
    renderModal();

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Follow up" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    expect((screen.getByRole("button", { name: "Creating..." }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reports capture errors and keeps the form open", async () => {
    apiMocks.capture.mockRejectedValue(new Error("Task capture source not found"));
    renderModal();

    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Follow up" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Task capture source not found");
    expect(alert.className).toContain("text-[var(--color-error-text)]");
    expect(alert.className).not.toContain("text-red-");
    expect((screen.getByRole("button", { name: "Create Task" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("cancels without a request and closes after a successful capture", async () => {
    const cancelled = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancelled.props.onClose).toHaveBeenCalledTimes(1);
    expect(apiMocks.capture).not.toHaveBeenCalled();

    cleanup();
    apiMocks.capture.mockResolvedValue({ data: captured });
    const success = renderModal();
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Follow up" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => expect(apiMocks.capture).toHaveBeenCalledWith({
      source_type: "email",
      account_id: "account-1",
      folder: "Archive",
      uid: "42",
      title: "Follow up",
    }));
    expect(success.props.onCaptured).toHaveBeenCalledWith(captured);
    expect(success.props.onClose).toHaveBeenCalledTimes(1);
  });

  it("dispatches docs with the selected project and chat without source content", async () => {
    apiMocks.capture.mockResolvedValue({ data: captured });
    const docsCaptured = vi.fn();
    render(
      <TaskCaptureModal
        isOpen
        project="selected project"
        source={{ source_type: "docs", page_id: 42 }}
        onClose={vi.fn()}
        onCaptured={docsCaptured}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Review page" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));
    await waitFor(() => expect(apiMocks.capture).toHaveBeenCalledWith(
      { source_type: "docs", page_id: 42, title: "Review page" },
      "selected project",
    ));
    expect(docsCaptured).toHaveBeenCalledWith(captured);

    cleanup();
    apiMocks.capture.mockClear();
    render(
      <TaskCaptureModal
        isOpen
        source={{ source_type: "chat", session_id: "session-1" }}
        onClose={vi.fn()}
        onCaptured={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Review session" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));
    await waitFor(() => expect(apiMocks.capture).toHaveBeenCalledWith({
      source_type: "chat",
      session_id: "session-1",
      title: "Review session",
    }));
    expect(JSON.stringify(apiMocks.capture.mock.calls)).not.toMatch(/message|content|transcript|session_title/i);
  });
});
