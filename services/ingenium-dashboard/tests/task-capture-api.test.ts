import { afterEach, describe, expect, it, vi } from "vitest";
import { api, listContextSources } from "../src/lib/api";
import { installDashboardFetchMock } from "./dashboard-fetch-fixture";

const successResponse = () => new Response(JSON.stringify({ data: {} }), {
  status: 200,
  headers: { "Content-Type": "application/json" },
});

afterEach(() => vi.unstubAllGlobals());

describe("task capture API client", () => {
  it("posts the email identity unchanged without a client project", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(successResponse()));
    installDashboardFetchMock(fetchMock);

    await api.tasks.capture({
      source_type: "email",
      title: "Follow up",
      account_id: "account-1",
      folder: "Archive/2026",
      uid: "42",
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/tasks/captures", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        source_type: "email",
        title: "Follow up",
        account_id: "account-1",
        folder: "Archive/2026",
        uid: "42",
      }),
    }));
  });

  it("uses the selected project only for context/docs capture and sends chat identities unchanged", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(successResponse()));
    installDashboardFetchMock(fetchMock);

    await api.tasks.capture({
      source_type: "context",
      title: "Review handoff",
      source_id: "00000000-0000-4000-8000-000000000000",
    }, "selected project");
    await api.tasks.capture({
      source_type: "docs",
      title: "Review page",
      page_id: 42,
    }, "selected project");
    await api.tasks.capture({
      source_type: "chat",
      title: "Review session",
      session_id: "session-1",
    });
    await listContextSources("selected project", { limit: 10, offset: 5 });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/tasks/captures?project=selected+project");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/tasks/captures?project=selected+project", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ source_type: "docs", title: "Review page", page_id: 42 }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/tasks/captures", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ source_type: "chat", title: "Review session", session_id: "session-1" }),
    }));
    expect(fetchMock.mock.calls[3]?.[0]).toBe("/api/v1/context/sources/summary?project=selected+project&limit=10&offset=5");
    await expect(captureWithoutProject()).rejects.toThrow("Context task capture requires a selected project");
    await expect(captureDocsWithoutProject()).rejects.toThrow("Docs task capture requires a selected project");
  });
});

function captureWithoutProject() {
  return (api.tasks.capture as (input: {
    source_type: "context";
    title: string;
    source_id: string;
  }, project?: string) => Promise<unknown>)({
    source_type: "context",
    title: "Review handoff",
    source_id: "00000000-0000-4000-8000-000000000000",
  });
}

function captureDocsWithoutProject() {
  return (api.tasks.capture as (input: {
    source_type: "docs";
    title: string;
    page_id: number;
  }, project?: string) => Promise<unknown>)({
    source_type: "docs",
    title: "Review page",
    page_id: 42,
  });
}
