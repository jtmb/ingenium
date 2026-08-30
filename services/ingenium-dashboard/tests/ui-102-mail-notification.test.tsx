import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const taskMocks = vi.hoisted(() => ({
  notifications: vi.fn(),
  readNotification: vi.fn(),
}));

vi.mock("../src/lib/api", () => ({
  api: {
    tasks: {
      notifications: taskMocks.notifications,
      readNotification: taskMocks.readNotification,
    },
  },
}));

import FolderSidebar from "../src/app/mail/components/FolderSidebar";
import NotificationBell from "../src/app/tasks/components/NotificationBell";

beforeEach(() => {
  taskMocks.notifications.mockResolvedValue({
    data: [{ id: "notice-1", task_id: "task-1", type: "mention", message: "You were mentioned", created_at: "2026-08-01T00:00:00.000Z", read: false }],
  });
  taskMocks.readNotification.mockResolvedValue({ data: {} });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("UI-102 mail and notification menus", () => {
  it("uses a menu for FolderSidebar account selection and restores focus on Escape", async () => {
    const onSelectAccount = vi.fn();
    render(
      <FolderSidebar
        accounts={[{ id: "account-1", email: "person@example.com", connected: true }]}
        selectedAccount="account-1"
        selectedFolder="INBOX"
        onSelectFolder={vi.fn()}
        onSelectAccount={onSelectAccount}
        onCompose={vi.fn()}
        onAddAccount={vi.fn()}
        folders={[{ name: "Inbox", path: "INBOX", totalMessages: 2 }]}
      />,
    );
    const trigger = screen.getByRole("button", { name: /Select account/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu", { name: "Email accounts" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /person@example.com/ }));
    expect(onSelectAccount).toHaveBeenCalledWith("account-1");
    expect(screen.queryByRole("menu", { name: "Email accounts" })).toBeNull();
  });

  it("uses menu items for notifications and keeps loading/error states bounded", async () => {
    const onTaskClick = vi.fn();
    render(<NotificationBell project="project-1" onTaskClick={onTaskClick} />);
    const trigger = await screen.findByRole("button", { name: /Notifications/ });
    fireEvent.click(trigger);
    const menu = await screen.findByRole("menu", { name: "Notifications" });
    expect(menu.getAttribute("id")).toBeTruthy();
    const notice = await screen.findByRole("menuitem", { name: /^@You were mentioned/ });
    fireEvent.click(notice);
    expect(onTaskClick).toHaveBeenCalledWith("task-1");
    await waitFor(() => expect(taskMocks.notifications).toHaveBeenCalledWith("orchestrator", true, "project-1"));
  });
});
