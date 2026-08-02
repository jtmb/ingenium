import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";

const SEARCH_EMAIL = {
  uid: 42,
  subject: "Archive result",
  folder: "Archive/2026",
  from: [{ name: "Sender", address: "sender@example.com" }],
};

vi.mock("../src/lib/api", () => ({
  dashboardFetch: (...args: Parameters<typeof fetch>) => fetch(...args),
  getApiBase: () => "/api/v1",
}));

vi.mock("../src/app/mail/components/FolderSidebar", () => ({ default: () => <aside /> }));

vi.mock("../src/app/mail/components/EmailList", () => ({
  default: ({
    emails,
    onSearch,
    onSelect,
  }: {
    emails: typeof SEARCH_EMAIL[];
    onSearch: (query: string) => void;
    onSelect: (uid: string) => void;
  }) => (
    <section>
      <button type="button" onClick={() => onSearch("archive")}>Search archive</button>
      {emails.map((email) => (
        <button key={email.uid} type="button" onClick={() => onSelect(String(email.uid))}>
          {email.subject}
        </button>
      ))}
    </section>
  ),
}));

vi.mock("../src/app/mail/components/EmailReader", () => ({
  default: ({
    email,
    loading,
    downloading,
    onCreateTask,
  }: {
    email: typeof SEARCH_EMAIL | null;
    loading: boolean;
    downloading: boolean;
    onCreateTask?: () => void;
  }) => (
    <section data-testid="mock-email-reader">
      {email && !loading && !downloading && (
        <button type="button" onClick={onCreateTask}>Create task</button>
      )}
    </section>
  ),
}));

vi.mock("../src/app/mail/components/AccountSetup", () => ({ default: () => null }));
vi.mock("../src/app/mail/components/SyncProgress", () => ({ default: () => null }));
vi.mock("../src/app/mail/components/EmailComposer", () => ({ default: () => null }));
vi.mock("../src/app/components/Overlay", () => ({ default: () => null }));

vi.mock("../src/app/tasks/components/TaskCaptureModal", () => ({
  default: ({
    isOpen,
    source,
  }: {
    isOpen: boolean;
    source: Record<string, unknown>;
  }) => isOpen ? <output data-testid="task-capture-source">{JSON.stringify(source)}</output> : null,
}));

import MailPage from "../src/app/mail/page";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Mail task capture integration", () => {
  it("passes only the loaded search-result identity to the capture modal", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/projects")) {
        return response({ data: [{ name: "global-default", is_global: true }] });
      }
      if (url.includes("/emails/accounts")) {
        return response({ data: [{ id: "account-1", email: "mail@example.com" }] });
      }
      if (url.includes("/emails/folders")) return response({ data: [] });
      if (url.includes("/emails/sync-status")) {
        return response({ data: {
          overall: "done",
          account: "account-1",
          totalFolders: 1,
          syncingFolders: 0,
          totalCached: 1,
          totalBodies: 1,
          folders: [],
        } });
      }
      if (url.includes("/emails/search")) return response({ data: [SEARCH_EMAIL], total: 1 });
      if (url.includes("/emails/42?")) return response({ data: SEARCH_EMAIL });
      return response({ data: [], total: 0 });
    });

    render(<MailPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Search archive" })).toBeTruthy());
    expect(screen.getByTestId("mail-folder-sidebar").className).toContain("hidden md:flex");
    expect(screen.getByTestId("mail-email-list-pane").className).toContain("flex-1");
    expect(screen.getByTestId("mail-email-reader-pane").className).toContain("hidden");
    expect(screen.getByTestId("mail-email-list-resizer").className).toContain("hidden md:block");
    fireEvent.click(screen.getByRole("button", { name: "Search archive" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Archive result" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Archive result" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create task" })).toBeTruthy());
    expect(screen.getByTestId("mail-email-list-pane").className).toContain("hidden md:flex");
    expect(screen.getByTestId("mail-email-reader-pane").className).toContain("flex min-w-0");
    expect(screen.getByRole("button", { name: "Back to messages" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));

    const source = JSON.parse((await screen.findByTestId("task-capture-source")).textContent!);
    expect(source).toEqual({
      source_type: "email",
      account_id: "account-1",
      folder: "Archive/2026",
      uid: "42",
    });
    expect(Object.keys(source).sort()).toEqual(["account_id", "folder", "source_type", "uid"]);
    expect(JSON.stringify(source)).not.toMatch(/subject|body|snippet|attachment|header|selectedFolder|INBOX/i);
    expect(fetchMock).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Back to messages" }));
    await waitFor(() => expect(screen.getByTestId("mail-email-list-pane").className).toContain("flex-1"));
    expect(screen.getByTestId("mail-email-reader-pane").className).toContain("hidden");
    expect(screen.queryByRole("button", { name: "Back to messages" })).toBeNull();
  });
});
