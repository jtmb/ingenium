import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import { installDashboardFetchMock } from "./dashboard-fetch-fixture";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  installDashboardFetchMock(fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("project lifecycle API paths", () => {
  it("encodes project names for archive and restore requests", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { restored: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));

    await api.projects.archive("team / project?");
    await api.projects.restore("team / project?");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/projects/team%20%2F%20project%3F");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/projects/team%20%2F%20project%3F/restore");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
  });
});
