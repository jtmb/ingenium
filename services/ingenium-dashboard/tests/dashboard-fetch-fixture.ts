import { vi } from "vitest";
import { resetAuthClientForTest } from "../src/lib/api";

const CSRF_PATH = "/api/v1/auth/session/csrf";

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") return new URL(input, "http://dashboard.test").pathname;
  if (input instanceof URL) return input.pathname;
  return new URL(input.url).pathname;
}

export function installDashboardFetchMock(requestMock: ReturnType<typeof vi.fn>) {
  resetAuthClientForTest();
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (requestPath(input) === CSRF_PATH && init?.method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({ data: { csrfToken: "csrf-fixture" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }
    return requestMock(input, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, requestMock };
}
