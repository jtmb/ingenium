import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import type { ChatMessage } from "../src/app/chat/components/ChatMessages";

/**
 * ChatMessages — scroll behavior regression tests.
 *
 * The old implementation used bottomRef.scrollIntoView({ behavior: "smooth" })
 * on every [messages, isLoading] change, causing the viewport to hijack
 * the user's scroll position when they scrolled up to read earlier content.
 *
 * The fix follows the established logs-page pattern:
 *   • Direct scrollTop = scrollHeight assignment (no smooth / no scrollIntoView)
 *   • shouldAutoScroll ref controlled by an onScroll handler with <4px tolerance
 *   • Auto-follow only while near bottom; scrolling upward prevents hijacking
 *   • Returning near bottom resumes following
 */

// ── Mock child components ─────────────────────────────────────────────────────
// Keep tests focused on ChatMessages scroll behavior, not children's rendering.

vi.mock("../src/app/chat/components/ChatMarkdown", () => ({
  default: () => <div data-testid="mock-markdown" />,
}));

vi.mock("../src/app/chat/components/ToolCallCard", () => ({
  default: () => <div data-testid="mock-tool-call" />,
}));

vi.mock("../src/app/chat/components/PermissionPrompt", () => ({
  default: () => <div data-testid="mock-permission" />,
}));

vi.mock("../src/app/chat/components/QuestionPrompt", () => ({
  default: () => <div data-testid="mock-question" />,
}));

import ChatMessages from "../src/app/chat/components/ChatMessages";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const msg1: ChatMessage = {
  id: "1",
  role: "user",
  content: "Hello",
  timestamp: 1000,
};

const msg2: ChatMessage = {
  id: "2",
  role: "assistant",
  content: "Hi there!",
  timestamp: 2000,
};

const msg3: ChatMessage = {
  id: "3",
  role: "user",
  content: "How are you?",
  timestamp: 3000,
};

const msg4: ChatMessage = {
  id: "4",
  role: "assistant",
  content: "I'm doing well, thanks!",
  timestamp: 4000,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Mock scroll geometry properties on an element.
 * scrollTop uses a getter/setter so the component's effect can write to it.
 */
function mockScrollGeometry(
  el: HTMLDivElement,
  opts: { scrollHeight?: number; clientHeight?: number; scrollTop?: number },
): void {
  const { scrollHeight = 0, clientHeight = 0, scrollTop = 0 } = opts;
  let _scrollTop = scrollTop;

  Object.defineProperty(el, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
    writable: false,
  });
  Object.defineProperty(el, "clientHeight", {
    value: clientHeight,
    configurable: true,
    writable: false,
  });
  Object.defineProperty(el, "scrollTop", {
    get: () => _scrollTop,
    set: (v) => {
      _scrollTop = v;
    },
    configurable: true,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ChatMessages — scroll behavior (UX-004)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  // ── Baseline ──────────────────────────────────────────────────────────────

  it("renders container with data-testid", () => {
    render(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2],
        isLoading: false,
      }),
    );
    expect(screen.getByTestId("chat-messages-container")).toBeDefined();
  });

  it("uses scrollTop assignment instead of scrollIntoView", () => {
    // jsdom does not implement scrollIntoView, so we verify the
    // replacement mechanism directly: on new messages the effect
    // writes scrollTop = scrollHeight instead of calling scrollIntoView.
    const { container, rerender } = render(
      React.createElement(ChatMessages, {
        messages: [msg1],
        isLoading: false,
      }),
    );

    const scrollEl = container.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLDivElement;
    expect(scrollEl).not.toBeNull();

    // Set up geometry: scrollHeight larger than clientHeight
    let scrollTopVal = 0;
    Object.defineProperty(scrollEl, "scrollHeight", {
      value: 800,
      configurable: true,
      writable: false,
    });
    Object.defineProperty(scrollEl, "clientHeight", {
      value: 400,
      configurable: true,
      writable: false,
    });
    Object.defineProperty(scrollEl, "scrollTop", {
      get: () => scrollTopVal,
      set: (v) => {
        scrollTopVal = v;
      },
      configurable: true,
    });

    // Add a new message — the effect should set scrollTop = 800
    rerender(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2],
        isLoading: false,
      }),
    );

    expect(scrollTopVal).toBe(800);
  });

  // ── Initial auto-follow ───────────────────────────────────────────────────

  it("auto-scrolls to bottom when new messages arrive (user near bottom)", () => {
    const { container, rerender } = render(
      React.createElement(ChatMessages, {
        messages: [msg1],
        isLoading: false,
      }),
    );

    const scrollEl = container.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLDivElement;
    expect(scrollEl).not.toBeNull();

    // Set up geometry: scroll height is larger than client height
    mockScrollGeometry(scrollEl, {
      scrollHeight: 1200,
      clientHeight: 500,
      scrollTop: 0,
    });

    // shouldAutoScroll starts as true → effect sets scrollTop = scrollHeight
    rerender(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2],
        isLoading: false,
      }),
    );

    expect(scrollEl.scrollTop).toBe(1200);
  });

  // ── Scroll-away guard ─────────────────────────────────────────────────────

  it("does NOT auto-scroll when user has scrolled away from bottom", () => {
    const { container, rerender } = render(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2],
        isLoading: false,
      }),
    );

    const scrollEl = container.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLDivElement;

    // Set up geometry: user is in the middle of the content
    mockScrollGeometry(scrollEl, {
      scrollHeight: 1200,
      clientHeight: 500,
      scrollTop: 400,
    });

    // Fire scroll event — shouldAutoScroll becomes false
    // 1200 - 400 - 500 = 300  (>> 4, not near bottom)
    fireEvent.scroll(scrollEl);

    // Add new messages
    rerender(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2, msg3],
        isLoading: false,
      }),
    );

    // scrollTop should remain where the user left it, NOT snapped to 1200
    expect(scrollEl.scrollTop).toBe(400);
  });

  // ── Resume following after scrolling back down ────────────────────────────

  it("resumes auto-scroll after user scrolls back near bottom", () => {
    const { container, rerender } = render(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2],
        isLoading: false,
      }),
    );

    const scrollEl = container.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLDivElement;

    mockScrollGeometry(scrollEl, {
      scrollHeight: 1200,
      clientHeight: 500,
      scrollTop: 400,
    });

    // Scroll away (middle of content)
    fireEvent.scroll(scrollEl);
    // Add a message while scrolled away → should NOT change scrollTop
    rerender(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2, msg3],
        isLoading: false,
      }),
    );
    expect(scrollEl.scrollTop).toBe(400);

    // Now scroll back near bottom: 1200 - 1197 - 500 = 3 < 4
    mockScrollGeometry(scrollEl, {
      scrollHeight: 1200,
      clientHeight: 500,
      scrollTop: 1197,
    });
    fireEvent.scroll(scrollEl);

    // Add another message — auto-scroll should resume
    rerender(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2, msg3, msg4],
        isLoading: false,
      }),
    );

    // Should snap back to bottom
    expect(scrollEl.scrollTop).toBe(1200);
  });

  // ── isLoading changes trigger auto-scroll ─────────────────────────────────

  it("auto-scrolls when isLoading changes (user near bottom)", () => {
    const { container, rerender } = render(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2],
        isLoading: false,
      }),
    );

    const scrollEl = container.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLDivElement;

    mockScrollGeometry(scrollEl, {
      scrollHeight: 1200,
      clientHeight: 500,
      scrollTop: 0,
    });

    // isLoading transitions to true — should auto-scroll
    rerender(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2],
        isLoading: true,
      }),
    );

    expect(scrollEl.scrollTop).toBe(1200);
  });

  // ── Empty state does not render scroll container ─────────────────────────

  it("does not render scroll container in empty state", () => {
    render(
      React.createElement(ChatMessages, {
        messages: [],
        isLoading: false,
      }),
    );
    expect(screen.queryByTestId("chat-messages-container")).toBeNull();
    expect(screen.getByTestId("chat-empty-state")).toBeDefined();
  });

  // ── Exact boundary: <4px tolerance ───────────────────────────────────────

  it("auto-scrolls when within 4px of bottom but not beyond (boundary test)", () => {
    const { container, rerender } = render(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2],
        isLoading: false,
      }),
    );

    const scrollEl = container.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLDivElement;

    // scrollHeight - scrollTop - clientHeight = 1200 - 697 - 500 = 3 (< 4 → near bottom)
    mockScrollGeometry(scrollEl, {
      scrollHeight: 1200,
      clientHeight: 500,
      scrollTop: 697,
    });
    fireEvent.scroll(scrollEl);

    rerender(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2, msg3],
        isLoading: false,
      }),
    );

    // Should auto-scroll since within tolerance
    expect(scrollEl.scrollTop).toBe(1200);
  });

  it("does NOT auto-scroll when barely beyond 4px tolerance", () => {
    const { container, rerender } = render(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2],
        isLoading: false,
      }),
    );

    const scrollEl = container.querySelector(
      '[data-testid="chat-messages-container"]',
    ) as HTMLDivElement;

    // scrollHeight - scrollTop - clientHeight = 1200 - 695 - 500 = 5 (> 4 → not near bottom)
    mockScrollGeometry(scrollEl, {
      scrollHeight: 1200,
      clientHeight: 500,
      scrollTop: 695,
    });
    fireEvent.scroll(scrollEl);

    rerender(
      React.createElement(ChatMessages, {
        messages: [msg1, msg2, msg3],
        isLoading: false,
      }),
    );

    // Should NOT auto-scroll since beyond tolerance
    expect(scrollEl.scrollTop).toBe(695);
  });

  // ── Loading spinner (no messages) does not crash ─────────────────────────

  it("does not crash when loading with no messages", () => {
    render(
      React.createElement(ChatMessages, {
        messages: [],
        isLoading: true,
      }),
    );
    expect(screen.getByTestId("chat-empty-state")).toBeDefined();
  });
});
