import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecentWorkDirection, RecentWorkItem, RecentWorkPage } from "../src/lib/recent-work";
import { normalizeRecentWorkPage, recentWorkHref } from "../src/lib/recent-work";

const mocks = vi.hoisted(() => ({ read: vi.fn(), push: vi.fn(), copy: vi.fn(), project: "alpha" }));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => mocks.project }));
vi.mock("../src/lib/api", () => ({ api: { home: { recentWork: mocks.read } } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));

import RecentWork from "../src/app/components/RecentWork";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
function item(kind: RecentWorkItem["kind"], id: string, title: string, project = "alpha"): RecentWorkItem {
  return { key: `${kind}:${id}`, kind, id, title, description: `${title} preview`, projectId: `id-${project}`, projectName: project,
    updatedAt: "2026-10-28T10:00:00.000Z", open: kind === "conversation" ? { kind: "chat", sessionId: id, runtimeId: "runtime-alpha" }
      : kind === "document" ? { kind: "document", pageId: Number(id), spaceId: 5 } : { kind: "task", taskId: id } };
}
const conversation = item("conversation", "saved-session", "Saved conversation");
const document = item("document", "12", "Saved document");
const task = item("task", "exact-task", "Saved task");
function page(items = [conversation, document, task], extra: Partial<RecentWorkPage> = {}): { data: RecentWorkPage } {
  return { data: { items, nextCursor: null, direction: "desc", sources: { conversation: "available", document: "available", task: "available" }, unavailable: [], ...extra } };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

beforeEach(() => {
  mocks.project = "alpha";
  mocks.read.mockReset().mockResolvedValue(page()); mocks.push.mockReset(); mocks.copy.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.copy } });
});
afterEach(() => {
  cleanup();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
});

describe("actual recent-work table controls", () => {
  it("renders typed work identities with exact project/runtime/document/task links", async () => {
    render(<RecentWork />);
    const table = await screen.findByRole("table", { name: "Recent work" });
    const hrefs = within(table).getAllByRole("link").map(link => link.getAttribute("href"));
    expect(hrefs).toEqual([
      "/chat?session=saved-session&runtime=runtime-alpha&project=alpha",
      "/docs?space=5&page=12&project=alpha", "/tasks?task=exact-task&project=alpha",
    ]);
    expect(mocks.read).toHaveBeenCalledWith("alpha", expect.objectContaining({ limit: 3, direction: "desc", signal: expect.any(AbortSignal) }));
    expect(within(table).getByRole("columnheader", { name: "Updated" })).toHaveAttribute("aria-sort", "descending");
    expect(within(table).getAllByText(/preview/)).toHaveLength(3);
  });

  it("requests oldest-first ordering instead of reversing only the initial rows", async () => {
    mocks.read.mockImplementation((_project: string, options: { direction: RecentWorkDirection }) => Promise.resolve(page(
      options.direction === "asc" ? [task, document, conversation] : [conversation, document, task], { direction: options.direction })));
    render(<RecentWork />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "Updated" }));
    await waitFor(() => expect(mocks.read).toHaveBeenLastCalledWith("alpha", expect.objectContaining({ direction: "asc" })));
    expect((await screen.findByRole("columnheader", { name: "Updated" })).getAttribute("aria-sort")).toBe("ascending");
  });

  it("expands to all item kinds and paginates without duplicate rows or duplicate requests", async () => {
    const more = deferred<{ data: RecentWorkPage }>();
    mocks.read.mockResolvedValueOnce(page()).mockResolvedValueOnce(page([conversation, document], { nextCursor: "next_page" })).mockReturnValueOnce(more.promise);
    render(<RecentWork />);
    await screen.findByRole("table");
    fireEvent.click(screen.getByRole("button", { name: "View all" }));
    const loadMore = await screen.findByRole("button", { name: "Load more work" });
    expect(mocks.read).toHaveBeenLastCalledWith("alpha", expect.objectContaining({ limit: 20 }));
    fireEvent.click(loadMore); fireEvent.click(loadMore);
    expect(mocks.read).toHaveBeenCalledTimes(3);
    await act(async () => more.resolve(page([document, task])));
    expect(within(await screen.findByRole("table")).getAllByRole("link")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Load more work" })).toBeNull();
  });

  it("ignores and aborts the retired project's delayed response", async () => {
    const old = deferred<{ data: RecentWorkPage }>();
    mocks.read.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([item("task", "next-task", "Next project task", "beta")]));
    const view = render(<RecentWork />);
    const signal = mocks.read.mock.calls[0][1].signal as AbortSignal;
    mocks.project = "beta"; view.rerender(<RecentWork />);
    await screen.findByRole("link", { name: /Next project task/ });
    expect(signal.aborted).toBe(true);
    await act(async () => old.resolve(page()));
    expect(screen.queryByRole("link", { name: /Saved conversation/ })).toBeNull();
  });

  it("shows a retryable failure instead of an empty success", async () => {
    mocks.read.mockRejectedValueOnce(new Error("Store unavailable")).mockResolvedValueOnce(page([]));
    render(<RecentWork />);
    expect((await screen.findByRole("alert")).textContent).toContain("Store unavailable");
    expect(screen.queryByText("Your recent conversations, documents and tasks will appear here.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("Your recent conversations, documents and tasks will appear here.");
  });

  it("keeps healthy work while identifying an unavailable source", async () => {
    mocks.read.mockResolvedValue(page([task], { sources: { conversation: "denied", document: "unavailable", task: "available" }, unavailable: ["document"] }));
    render(<RecentWork />);
    await screen.findByRole("link", { name: /Saved task/ });
    expect(screen.getByText("Some recent work is unavailable: Documents.")).not.toBeNull();
  });

  it("opens an exact row from its keyboard-dismissable action menu", async () => {
    render(<RecentWork />);
    const actions = await screen.findByRole("button", { name: "Actions for Saved document" });
    fireEvent.click(actions);
    fireEvent.keyDown(await screen.findByRole("menu"), { key: "Escape" });
    await waitFor(() => expect(actions).toHaveFocus());
    fireEvent.click(actions);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open document" }));
    expect(mocks.push).toHaveBeenCalledWith("/docs?space=5&page=12&project=alpha");
  });

  it("announces a copied link only after the clipboard operation succeeds", async () => {
    const copied = deferred<void>(); mocks.copy.mockReturnValueOnce(copied.promise);
    render(<RecentWork />);
    fireEvent.click(await screen.findByRole("button", { name: "Actions for Saved task" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
    expect(screen.queryByText("Link copied.")).toBeNull();
    await act(async () => copied.resolve());
    await screen.findByText("Link copied.");
    expect(new URL(mocks.copy.mock.calls[0][0]).searchParams.get("task")).toBe("exact-task");
  });
});

describe("recent-work response and link boundary", () => {
  it("rejects cross-project records and mismatched navigation identity", () => {
    expect(() => normalizeRecentWorkPage(page([item("task", "foreign", "Foreign", "beta")]).data, "alpha", "desc")).toThrow("invalid response");
    const malformed = { ...task, open: { kind: "task", taskId: "another-task" } };
    expect(() => normalizeRecentWorkPage(page([malformed as RecentWorkItem]).data, "alpha", "desc")).toThrow("invalid response");
  });

  it("rejects malformed dates, duplicate keys and records from denied sources", () => {
    expect(() => normalizeRecentWorkPage(page([{ ...task, updatedAt: "unknown" }]).data, "alpha", "desc")).toThrow();
    expect(() => normalizeRecentWorkPage(page([task, task]).data, "alpha", "desc")).toThrow();
    expect(() => normalizeRecentWorkPage(page([task], { sources: { conversation: "denied", document: "denied", task: "denied" } }).data, "alpha", "desc")).toThrow();
  });

  it("constructs navigation from structured identifiers rather than a supplied URL", () => {
    const safe = { ...conversation, open: { kind: "chat" as const, sessionId: "id/with?characters", runtimeId: "runtime-alpha" } };
    const target = new URL(recentWorkHref(safe), "https://veyra.example");
    expect(target.pathname).toBe("/chat");
    expect(target.searchParams.get("session")).toBe("id/with?characters");
    expect(target.searchParams.get("project")).toBe("alpha");
  });
});
