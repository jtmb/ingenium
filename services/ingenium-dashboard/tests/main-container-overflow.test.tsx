import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

/**
 * MainContainer overflow regression tests for UX-002.
 *
 * At 390x844 viewport (mobile), the immersive <main> element (used by
 * /chat, /opencode, /docs) lacked `min-w-0` while nested inside a
 * `grid grid-rows-[1fr]` parent. Grid items default to `min-width: auto`,
 * which prevents the element from shrinking below its content size —
 * causing horizontal overflow and clipping of actionable controls.
 *
 * The fix adds `min-w-0` (Tailwind for `min-width: 0px`) to override the
 * grid default, allowing the child to shrink correctly.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────────

const pathnameRef = vi.hoisted(() => ({ current: "/chat" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameRef.current,
}));

// Re-import under test after mocks are installed
import MainContainer from "../src/app/components/MainContainer";

describe("MainContainer — immersive route overflow (UX-002)", () => {
  beforeEach(() => {
    pathnameRef.current = "/chat";
  });

  it("renders <main> with min-w-0 class on immersive routes", () => {
    const { container } = render(
      <MainContainer>
        <div style={{ width: "500px" }} data-testid="wide-child">
          wide content
        </div>
      </MainContainer>,
    );

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main!.className).toContain("min-w-0");
  });

  it("does NOT use overflow-hidden to solve the grid overflow problem", () => {
    const { container } = render(
      <MainContainer>
        <div style={{ width: "500px" }}>wide content</div>
      </MainContainer>,
    );

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    // The correct fix is min-w-0 (min-width: 0px), not overflow-hidden
    // which would clip content rather than letting it shrink
    expect(main!.className).not.toContain("overflow-hidden");
    expect(main!.className).not.toContain("overflow-x-hidden");
    expect(main!.className).toContain("min-w-0");
  });

  it("applies immersive layout (p-0) only on immersive routes, not standard routes", () => {
    // Change pathname to a standard route
    pathnameRef.current = "/status";

    const { container } = render(
      <MainContainer>
        <div>standard content</div>
      </MainContainer>,
    );

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    // Standard routes get the constrained layout — includes min-w-0 from:
    // "p-6 xl:px-8 w-full min-w-0 mx-auto max-w-screen-2xl"
    expect(main!.className).toContain("min-w-0");
    // But it does NOT have "p-0" (the immersive class)
    expect(main!.className).not.toContain("p-0");
  });

  it("applies min-w-0 on /opencode immersive route", () => {
    pathnameRef.current = "/opencode";

    const { container } = render(
      <MainContainer>
        <div>opencode content</div>
      </MainContainer>,
    );

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main!.className).toContain("min-w-0");
    expect(main!.className).toContain("p-0");
  });

  it("applies the immersive min-height and min-width bounds on /vscode", () => {
    pathnameRef.current = "/vscode";

    const { container } = render(
      <MainContainer>
        <div>VS Code workspace</div>
      </MainContainer>,
    );

    const main = container.querySelector("main");
    expect(main?.className).toContain("h-full");
    expect(main?.className).toContain("min-h-0");
    expect(main?.className).toContain("min-w-0");
    expect(main?.className).toContain("p-0");
  });

  it("applies min-w-0 on /docs immersive route", () => {
    pathnameRef.current = "/docs";

    const { container } = render(
      <MainContainer>
        <div>docs content</div>
      </MainContainer>,
    );

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main!.className).toContain("min-w-0");
    expect(main!.className).toContain("p-0");
  });

  it("applies full-width layout on /mail route without immersive p-0", () => {
    pathnameRef.current = "/mail";

    const { container } = render(
      <MainContainer>
        <div>mail content</div>
      </MainContainer>,
    );

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    // Full-width routes get: "p-6" — no min-w-0 needed since they're not
    // in the grid grid-rows-[1fr] context that causes the overflow
    expect(main!.className).toBe("p-6");
  });

  it("bounds the Tasks route so board overflow stays inside the page content", () => {
    pathnameRef.current = "/tasks";

    const { container } = render(
      <MainContainer>
        <div style={{ width: "1000px" }}>kanban content</div>
      </MainContainer>,
    );

    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main!.className).toContain("min-w-0");
    expect(main!.className).toContain("p-6");
  });
});
