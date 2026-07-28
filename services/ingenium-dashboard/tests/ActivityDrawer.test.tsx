import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import ActivityDrawer from "../src/app/chat/components/ActivityDrawer";
import type { ChatMessage } from "../src/app/chat/components/ChatMessages";

const message: ChatMessage = {
  id: "assistant-1",
  role: "assistant",
  content: "answer",
  timestamp: 1000,
  parts: [
    {
      id: "reasoning-1",
      sessionID: "session-1",
      messageID: "assistant-1",
      type: "reasoning",
      text: "Provider-backed reasoning",
    },
    {
      id: "search-1",
      sessionID: "session-1",
      messageID: "assistant-1",
      type: "tool",
      tool: "websearch",
      state: {
        status: "completed",
        input: { query: "transparent chat streaming" },
        output: {
          results: [{ url: "https://results.example.test/chat-streaming" }],
          visited: [{ url: "https://visited.example.test/stream-lifecycle" }],
        },
      },
    },
  ],
};

const selection = { messageId: "assistant-1", partId: "search-1" };

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
});

describe("ActivityDrawer", () => {
  it("renders ordered activity, grouped safe links, and dialog semantics", () => {
    const onClose = vi.fn();
    render(
      <ActivityDrawer
        isOpen
        selection={selection}
        messages={[message]}
        onClose={onClose}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Activity" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByText("Provider-backed reasoning")).toBeTruthy();
    expect(screen.getByTestId("chat-activity-query").textContent).toContain(
      "transparent chat streaming",
    );
    expect(screen.getAllByTestId("chat-activity-site-group").map((node) => node.getAttribute("data-label"))).toEqual([
      "Results",
      "Visited",
    ]);
    expect(screen.getAllByTestId("chat-activity-site-link")).toHaveLength(2);
    expect(screen.getByText("https://visited.example.test/stream-lifecycle").getAttribute("rel")).toBe(
      "noopener noreferrer",
    );
    expect(screen.queryByText("Do not render this title")).toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("traps focus, closes on Escape/backdrop, and restores the trigger focus", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">Web Search trigger</button>
        <ActivityDrawer
          isOpen={false}
          selection={selection}
          messages={[message]}
          onClose={onClose}
        />
      </>,
    );
    const trigger = screen.getByRole("button", { name: "Web Search trigger" });
    trigger.focus();

    rerender(
      <>
        <button type="button">Web Search trigger</button>
        <ActivityDrawer
          isOpen
          selection={selection}
          messages={[message]}
          onClose={onClose}
        />
      </>,
    );

    const close = screen.getByRole("button", { name: "Close activity drawer" });
    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole("link", { name: "https://visited.example.test/stream-lifecycle" }));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();

    rerender(
      <>
        <button type="button">Web Search trigger</button>
        <ActivityDrawer
          isOpen={false}
          selection={null}
          messages={[message]}
          onClose={onClose}
        />
      </>,
    );
    expect(document.body.style.overflow).toBe("");

    const restoredTrigger = screen.getByRole("button", { name: "Web Search trigger" });
    expect(document.activeElement).toBe(restoredTrigger);
  });

  it("closes only when the backdrop itself is clicked", () => {
    const onClose = vi.fn();
    render(
      <ActivityDrawer
        isOpen
        selection={selection}
        messages={[message]}
        onClose={onClose}
      />,
    );
    const backdrop = screen.getByTestId("chat-activity-backdrop");
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("dialog", { name: "Activity" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
