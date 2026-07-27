import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import ChatSessionSidebar from "../src/app/chat/components/ChatSessionSidebar";

afterEach(cleanup);

describe("ChatSessionSidebar session controls", () => {
  it("keeps the delete control outside the selectable session button", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const { container } = render(
      <ChatSessionSidebar
        sessions={[{ id: "session-1", title: "Conversation", updatedAt: 1 }]}
        activeId="session-1"
        onSelect={onSelect}
        onDelete={onDelete}
        onNew={vi.fn()}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );

    expect(container.querySelector("[role=\"button\"]")).toBeNull();
    expect(container.querySelector("button button")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Conversation" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete Conversation" }));

    expect(onSelect).toHaveBeenCalledWith("session-1");
    expect(onDelete).toHaveBeenCalledWith("session-1");
  });

  it("does not select a session when deleting", () => {
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    render(
      <ChatSessionSidebar
        sessions={[{ id: "session-1", title: "Conversation", updatedAt: 1 }]}
        activeId="session-1"
        onSelect={onSelect}
        onDelete={onDelete}
        onNew={vi.fn()}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete Conversation" }));

    expect(onDelete).toHaveBeenCalledWith("session-1");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
