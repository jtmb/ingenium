import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { Suspense } from "react";

const mockSearchParams = new Map<string, string>();
let mockProject = "global-default";
const mockReplace = vi.fn();
const mockPush = vi.fn();

// Register mocks before imports so the page's module dependencies are intercepted.

vi.mock("@/lib/api", () => ({ getApiBase: () => "/api/v1" }));

vi.mock("@/lib/ProjectContext", () => ({
  useProject: () => mockProject,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => ({
    get: (key: string) => mockSearchParams.get(key) ?? null,
  }),
}));

import EmailDetailPage from "@/app/mail/[id]/page";

/**
 * Render EmailDetailPage wrapped in Suspense.
 *
 * React 19's `use(params)` with a Promise triggers Suspense on the initial
 * render even if the promise is already resolved.  We must `await act()` so
 * React flushes the pending microtask (promise.then callback) and commits
 * the resolved tree before we assert.
 */
async function renderPage(id = "1") {
  let res: ReturnType<typeof render> | undefined;
  await act(async () => {
    res = render(
      <Suspense fallback={null}>
        <EmailDetailPage params={Promise.resolve({ id })} />
      </Suspense>
    );
  });
  return res!;
}

describe("BUG-001: EmailDetailPage account guard", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    mockSearchParams.clear();
    mockProject = "global-default";
    mockReplace.mockClear();
    mockPush.mockClear();
  });

  it("renders validation message and does NOT fetch when accountId is empty", async () => {
    // account param is absent → searchParams.get("account") returns null → ""
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await renderPage("1");

    // Wait for the validation message to appear
    expect(
      await screen.findByText("account query parameter is required"),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Email" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to Inbox" })).toBeTruthy();
    expect(screen.queryByText(/loading/i)).toBeNull();

    // Verify NO email fetch was issued
    const emailFetches = fetchSpy.mock.calls.filter(([url]) =>
      String(url).includes("/emails/"),
    );
    expect(emailFetches).toHaveLength(0);
  });

  it("uses dynamic project from useProject context in the fetch URL", async () => {
    mockSearchParams.set("account", "acc-1");
    mockSearchParams.set("folder", "INBOX");
    mockProject = "my-custom-project";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { uid: 1, subject: "Hello" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await renderPage("7");

    // Wait for the fetch to fire
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });

    // Find the email fetch call
    const emailCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes("/emails/7"),
    );
    expect(emailCall).toBeTruthy();
    const url = String(emailCall![0]);
    expect(url).toContain("project=my-custom-project");
    expect(url).toContain("account=acc-1");
    expect(url).toContain("folder=INBOX");
  });

  it("fetches with correct params when account is present", async () => {
    mockSearchParams.set("account", "acc-test");
    mockSearchParams.set("folder", "Sent");
    mockProject = "test-project";

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { uid: 42, subject: "Test" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await renderPage("42");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const emailCall = fetchSpy.mock.calls.find(([url]) =>
      String(url).includes("/emails/42"),
    );
    expect(emailCall).toBeTruthy();
    const url = String(emailCall![0]);
    expect(url).toContain("project=test-project");
    expect(url).toContain("account=acc-test");
    expect(url).toContain("folder=Sent");
  });

});
