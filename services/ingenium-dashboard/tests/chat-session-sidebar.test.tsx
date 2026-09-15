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
        sessions={[{ id: "session-1", title: "Conversation" }]}
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
        sessions={[{ id: "session-1", title: "Conversation" }]}
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

  it("disables New Chat only while session creation owns the creation slot", () => {
    const onNew = vi.fn();
    const { rerender } = render(
      <ChatSessionSidebar
        sessions={[]}
        activeId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onNew={onNew}
        newDisabled
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    const newChat = screen.getByRole("button", { name: "New conversation" });
    expect((newChat as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(newChat);
    expect(onNew).not.toHaveBeenCalled();

    rerender(
      <ChatSessionSidebar
        sessions={[]}
        activeId={null}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onNew={onNew}
        collapsed={false}
        onToggle={vi.fn()}
      />,
    );
    expect((screen.getByRole("button", { name: "New conversation" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
