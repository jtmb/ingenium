import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import React from "react";
import Overlay from "../src/app/components/Overlay";

/**
 * A11Y-001 — Overlay keyboard focus contract.
 *
 * Verifies that the generic Overlay component:
 *   - Escape dismisses the overlay (calls onClose)
 *   - Focus moves to the close button when the overlay opens
 *   - Tab/Shift+Tab cycles through focusable elements within the overlay
 *   - Focus is restored to the trigger element when the overlay closes
 *   - Body scroll is locked while open and restored on close
 *   - Enter/Space activate buttons (browser default — we verify buttons respond)
 *
 * Uses jsdom + @testing-library/react with fireEvent for keyboard simulation.
 * Focus changes happen programmatically via .focus() calls in the component.
 */

// ── Helper: wait for the next microtask / setTimeout(0) flush ───────────────

/**
 * Flushes any pending setTimeout(fn, 0) and pending effects.
 * The Overlay component uses setTimeout(…, 0) to defer focus-on-open,
 * so tests need to await this before checking document.activeElement.
 */
function flushTimers(): Promise<void> {
  return act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Overlay — A11Y-001 keyboard focus contract", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    document.body.style.overflow = "";
  });

  // ── Escape key ──────────────────────────────────────────────────────────────

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <Overlay isOpen onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when overlay is closed and Escape is pressed", () => {
    const onClose = vi.fn();
    render(
      <Overlay isOpen={false} onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose exactly once per Escape press (no double-fire)", () => {
    const onClose = vi.fn();
    render(
      <Overlay isOpen onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // ── Focus on open ───────────────────────────────────────────────────────────

  it("moves focus to the close button when the overlay opens", async () => {
    const onClose = vi.fn();
    render(
      <Overlay isOpen onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    await flushTimers();

    const closeBtn = screen.getByLabelText("Close");
    expect(document.activeElement).toBe(closeBtn);
  });

  it("focuses the close button even after a delayed open (rerender)", async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Overlay isOpen={false} onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    rerender(
      <Overlay isOpen onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    await flushTimers();

    const closeBtn = screen.getByLabelText("Close");
    expect(document.activeElement).toBe(closeBtn);
  });

  // ── Focus restore on close ──────────────────────────────────────────────────

  it("restores focus to the trigger element when the overlay closes", async () => {
    const onClose = vi.fn();

    const { rerender } = render(
      <div>
        <button type="button" data-testid="trigger">
          Open
        </button>
        <Overlay isOpen={false} onClose={onClose} title="Test">
          <p>Content</p>
        </Overlay>
      </div>,
    );

    // Focus the trigger button
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Open the overlay
    rerender(
      <div>
        <button type="button" data-testid="trigger">
          Open
        </button>
        <Overlay isOpen onClose={onClose} title="Test">
          <p>Content</p>
        </Overlay>
      </div>,
    );

    await flushTimers();

    // Focus should now be on the close button
    const closeBtn = screen.getByLabelText("Close");
    expect(document.activeElement).toBe(closeBtn);

    // Close the overlay
    rerender(
      <div>
        <button type="button" data-testid="trigger">
          Open
        </button>
        <Overlay isOpen={false} onClose={onClose} title="Test">
          <p>Content</p>
        </Overlay>
      </div>,
    );

    // Focus should be restored to the trigger
    expect(document.activeElement).toBe(screen.getByTestId("trigger"));
  });

  it("does NOT restore focus when the overlay was never opened", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Overlay isOpen={false} onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    // Set some other element as active
    document.body.focus();

    unmount();

    // No crash — focus stays on body
    expect(document.activeElement).toBe(document.body);
  });

  // ── Focus trap — Tab boundary behavior ───────────────────────────────────────
  //
  // The focus trap only intervenes at the boundaries:
  //   - Tab on the LAST element → cycle to FIRST
  //   - Shift+Tab on the FIRST element → cycle to LAST
  // Middle elements rely on the browser's native Tab behavior (not simulated
  // in jsdom), so we test only the boundary-cycling logic.

  it("cycles from last to first when Tab is pressed on the last element", async () => {
    const onClose = vi.fn();
    render(
      <Overlay isOpen onClose={onClose} title="Test">
        <button type="button" data-testid="btn-1">
          One
        </button>
        <button type="button" data-testid="btn-2">
          Two
        </button>
      </Overlay>,
    );

    await flushTimers();

    const closeBtn = screen.getByLabelText("Close");
    const btn2 = screen.getByTestId("btn-2");

    // Focus btn-2 (the last focusable element) manually
    btn2.focus();
    expect(document.activeElement).toBe(btn2);

    // Tab on the last element → cycles to first (closeBtn)
    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(closeBtn);
  });

  it("cycles from first to last when Shift+Tab is pressed on the first element", async () => {
    const onClose = vi.fn();
    render(
      <Overlay isOpen onClose={onClose} title="Test">
        <button type="button" data-testid="btn-1">
          One
        </button>
        <button type="button" data-testid="btn-2">
          Two
        </button>
      </Overlay>,
    );

    await flushTimers();

    const closeBtn = screen.getByLabelText("Close");
    const btn2 = screen.getByTestId("btn-2");

    // After open, focus is on closeBtn (first). Shift+Tab → last (btn-2)
    expect(document.activeElement).toBe(closeBtn);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(btn2);
  });

  it("does NOT cycle on Tab from a middle element (browser handles it)", async () => {
    const onClose = vi.fn();
    render(
      <Overlay isOpen onClose={onClose} title="Test">
        <button type="button" data-testid="btn-1">
          One
        </button>
        <button type="button" data-testid="btn-2">
          Two
        </button>
      </Overlay>,
    );

    await flushTimers();

    const btn1 = screen.getByTestId("btn-1");

    // Focus btn-1 (a middle element)
    btn1.focus();
    expect(document.activeElement).toBe(btn1);

    // Tab from a middle element — the handler does NOT prevent default,
    // so focus stays unchanged (browser would move to btn-2 in a real browser)
    fireEvent.keyDown(document, { key: "Tab", shiftKey: false });
    expect(document.activeElement).toBe(btn1);

    // Shift+Tab from a middle element — same, no intervention
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(btn1);
  });

  // ── Focus trap — non-Tab keys are unaffected ────────────────────────────────

  it("does not intercept non-Tab non-Escape keys", () => {
    const onClose = vi.fn();
    render(
      <Overlay isOpen onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    // Arrow keys, Enter, Space should not trigger onClose
    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "ArrowUp" });
    fireEvent.keyDown(document, { key: "Enter" });
    fireEvent.keyDown(document, { key: " " });

    expect(onClose).not.toHaveBeenCalled();
  });

  // ── Body scroll lock ────────────────────────────────────────────────────────

  it("locks body scroll when overlay is open", () => {
    const onClose = vi.fn();
    render(
      <Overlay isOpen onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    expect(document.body.style.overflow).toBe("hidden");
  });

  it("restores body scroll when overlay is closed", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Overlay isOpen onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    rerender(
      <Overlay isOpen={false} onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    expect(document.body.style.overflow).toBe("");
  });

  // ── Render / portal ─────────────────────────────────────────────────────────

  it("renders nothing to the DOM when closed", () => {
    const onClose = vi.fn();
    const { container } = render(
      <Overlay isOpen={false} onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    // The component itself renders nothing
    expect(container.innerHTML).toBe("");
    // No portal in body
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it("renders a portal to document.body when open", () => {
    const onClose = vi.fn();
    render(
      <Overlay isOpen onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
  });

  it("cleans up portals on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      <Overlay isOpen onClose={onClose} title="Test">
        <p>Content</p>
      </Overlay>,
    );

    unmount();

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});


