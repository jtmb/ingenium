import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * LAN API base URL tests against the real implementation in src/lib/api.ts.
 *
 * Validates:
 *  - `getApiBase()` returns "/api/v1" by default (relative, same-origin proxy)
 *  - only relative NEXT_PUBLIC_API_URL overrides are accepted
 *  - `request()` path composition, error handling (non-ok, 204), and headers
 *
 * Fetch is mocked at the global level — no real server calls.
 * `getApiBase()` is a runtime function (reads process.env each call), so env-var
 * switching works across tests. For `request()` scenarios requiring non-default
 * API_URL, we use vi.mock to control getApiBase's return value.
 */

// ── Fetch mock helpers ──────────────────────────────────────────────────────

function mockFetchOnce(status: number, body: unknown, statusText?: string) {
  return vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    statusText: statusText ?? "",
    json: () =>
      typeof body === "string"
        ? Promise.reject(new Error(body))
        : Promise.resolve(body),
  });
}

const DEFAULT_OK_BODY = () => ({ data: [] });
let fetchMock: ReturnType<typeof vi.fn>;

// ── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(DEFAULT_OK_BODY()),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_API_URL;
  vi.unstubAllGlobals();
});

// ── Dynamic import helper — returns fresh-module reference each call.
//    Note: vitest caches modules by specifier, so all calls return the same
//    instance. This is acceptable for getApiBase() (runtime function) and
//    request() (reads the cached API_URL constant). For tests that need a
//    different API_URL, we use vi.mock with a factory.

async function getApi() {
  return await import("@/lib/api");
}

// ════════════════════════════════════════════════════════════════════════════
//  getApiBase() — runtime function, reads process.env each call
// ════════════════════════════════════════════════════════════════════════════

describe("getApiBase() — default and override", () => {
  it("returns relative /api/v1 when NEXT_PUBLIC_API_URL is unset", async () => {
    const { getApiBase } = await getApi();
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(getApiBase()).toBe("/api/v1");
  });

  it("returns relative /api/v1 when NEXT_PUBLIC_API_URL is empty string", async () => {
    const { getApiBase } = await getApi();
    process.env.NEXT_PUBLIC_API_URL = "";
    expect(getApiBase()).toBe("/api/v1");
  });

   it("rejects an absolute URL override so LAN browsers use the same-origin proxy", async () => {
    const { getApiBase } = await getApi();
    process.env.NEXT_PUBLIC_API_URL = "http://192.168.1.100:4097/api/v1";
     expect(getApiBase()).toBe("/api/v1");
  });

   it("accepts a relative proxy-prefix override", async () => {
    const { getApiBase } = await getApi();
     process.env.NEXT_PUBLIC_API_URL = "/internal/api/v1/";
     expect(getApiBase()).toBe("/internal/api/v1");
  });

   it("rejects protocol-relative URL overrides", async () => {
    const { getApiBase } = await getApi();
     process.env.NEXT_PUBLIC_API_URL = "//api.example.test/api/v1";
     expect(getApiBase()).toBe("/api/v1");
  });

   it("accepts a relative custom base path", async () => {
    const { getApiBase } = await getApi();
     process.env.NEXT_PUBLIC_API_URL = "/custom/v2";
     expect(getApiBase()).toBe("/custom/v2");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  request() — fetch URL composition with default API_URL (/api/v1)
// ════════════════════════════════════════════════════════════════════════════

describe("request() — path composition with default API_URL", () => {
  it("combines default /api/v1 base with /projects path", async () => {
    const { request } = await getApi();
    // Ensure default: no override env var
    delete process.env.NEXT_PUBLIC_API_URL;

    void (request as any)("/projects").catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const calledUrl: string = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe("/api/v1/projects");
  });

  it("preserves query string in composed URL", async () => {
    const { request } = await getApi();
    delete process.env.NEXT_PUBLIC_API_URL;

    void (request as any)("/skills?project=test").catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const calledUrl: string = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe("/api/v1/skills?project=test");
  });

  it("composes deep paths like /dashboard/summary", async () => {
    const { request } = await getApi();
    delete process.env.NEXT_PUBLIC_API_URL;

    void (request as any)("/dashboard/summary").catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const calledUrl: string = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe("/api/v1/dashboard/summary");
  });

  it("composes encoded paths via api.projects.detail", async () => {
    const { api } = await getApi();
    delete process.env.NEXT_PUBLIC_API_URL;

    void (api.projects.detail("my project") as any).catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const calledUrl: string = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe(
      "/api/v1/projects/my%20project/detail",
    );
  });

  it("api.projects.list fetches /api/v1/projects", async () => {
    const { api } = await getApi();
    delete process.env.NEXT_PUBLIC_API_URL;

    void (api.projects.list() as any).catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const calledUrl: string = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe("/api/v1/projects");
  });

  it("api.skills.list appends ?project=global-default by default", async () => {
    const { api } = await getApi();
    delete process.env.NEXT_PUBLIC_API_URL;

    void (api.skills.list() as any).catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const calledUrl: string = fetchMock.mock.calls[0][0];
    expect(calledUrl).toMatch(/^\/api\/v1\/skills\?project=global-default$/);
  });

  it("api.skills.list accepts custom project name via parameter", async () => {
    const { api } = await getApi();
    delete process.env.NEXT_PUBLIC_API_URL;

    void (api.skills.list("my-project") as any).catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const calledUrl: string = fetchMock.mock.calls[0][0];
    expect(calledUrl).toContain("?project=my-project");
  });

  it("api.health uses request with /health path", async () => {
    const { request } = await getApi();
    delete process.env.NEXT_PUBLIC_API_URL;

    void (request as any)("/health").catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const calledUrl: string = fetchMock.mock.calls[0][0];
    expect(calledUrl).toBe("/api/v1/health");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  api object — skill creation body
// ════════════════════════════════════════════════════════════════════════════

describe("api object — skill creation body", () => {
  it("api.skills.create sends POST with JSON body", async () => {
    const { api } = await getApi();
    delete process.env.NEXT_PUBLIC_API_URL;

    void (api.skills.create("test-skill", "A test", "skill content") as any).catch(
      () => {},
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body as string)).toEqual({
      name: "test-skill",
      description: "A test",
      content: "skill content",
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  request() — headers and method passthrough
// ════════════════════════════════════════════════════════════════════════════

describe("request() — headers", () => {
  it("sets Content-Type: application/json by default", async () => {
    const { request } = await getApi();
    void (request as any)("/projects").catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sets x-ingenium-ui: dashboard header", async () => {
    const { request } = await getApi();
    void (request as any)("/projects").catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["x-ingenium-ui"]).toBe("dashboard");
  });

  it("allows caller to override Content-Type (e.g. for FormData)", async () => {
    const { request } = await getApi();
    void (request as any)("/upload", {
      headers: { "Content-Type": "multipart/form-data" },
    }).catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("multipart/form-data");
  });

  it("caller can pass additional headers alongside defaults", async () => {
    const { request } = await getApi();
    void (request as any)("/projects", {
      headers: { "X-Custom": "value" },
    }).catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["x-ingenium-ui"]).toBe("dashboard");
    expect(headers["X-Custom"]).toBe("value");
  });
});

describe("request() — method passthrough", () => {
  it("passes method and body through to fetch", async () => {
    const { request } = await getApi();
    void (request as any)("/projects", {
      method: "POST",
      body: JSON.stringify({ name: "test" }),
    }).catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].body).toBe(
      JSON.stringify({ name: "test" }),
    );
  });

  it("default method is GET when not specified", async () => {
    const { request } = await getApi();
    void (request as any)("/projects").catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  request() — response handling
// ════════════════════════════════════════════════════════════════════════════

describe("request() — response handling", () => {
  it("returns parsed JSON for a 200 response", async () => {
    fetchMock = mockFetchOnce(200, { data: { id: "abc" } });
    vi.stubGlobal("fetch", fetchMock);

    const { request } = await getApi();
    const result = await (request as any)("/projects/abc");
    expect(result).toEqual({ data: { id: "abc" } });
  });

  it("returns undefined for 204 No Content", async () => {
    fetchMock = mockFetchOnce(204, undefined);
    vi.stubGlobal("fetch", fetchMock);

    const { request } = await getApi();
    const result = await (request as any)("/projects/abc", {
      method: "DELETE",
    });
    expect(result).toBeUndefined();
  });

  it("throws with server error message on 400", async () => {
    fetchMock = mockFetchOnce(
      400,
      { error: { message: "Invalid project name" } },
      "Bad Request",
    );
    vi.stubGlobal("fetch", fetchMock);

    const { request } = await getApi();
    await expect(
      (request as any)("/projects", { method: "POST", body: "{}" }),
    ).rejects.toThrow("Invalid project name");
  });

  it("throws with statusText when JSON body has no error message", async () => {
    fetchMock = mockFetchOnce(500, {}, "Internal Server Error");
    vi.stubGlobal("fetch", fetchMock);

    const { request } = await getApi();
    await expect((request as any)("/projects")).rejects.toThrow(
      "Internal Server Error",
    );
  });

  it("throws with statusText when JSON body cannot be parsed", async () => {
    fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { request } = await getApi();
    await expect((request as any)("/projects")).rejects.toThrow(
      "Server Error",
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  request() — runtime API base resolution
// ════════════════════════════════════════════════════════════════════════════

/**
 * request resolves the API base when invoked, so a runtime deployment setting
 * remains SSR-safe and no stale module-level origin can bypass the proxy.
 */
describe("request() — runtime API base binding", () => {
  it("request() resolves the current relative proxy prefix", async () => {
    // Import the module with default env
    const modA = await import("@/lib/api");

    // Set override AFTER import — request() still uses cached default
    process.env.NEXT_PUBLIC_API_URL = "/internal/api/v1";
    void (modA.request as any)("/projects").catch(() => {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const urlA: string = fetchMock.mock.calls[0][0];
    expect(urlA).toBe("/internal/api/v1/projects");
  });
});

// ════════════════════════════════════════════════════════════════════════════
//  getApiBase() — tristate: absent, empty, present
// ════════════════════════════════════════════════════════════════════════════

describe("getApiBase() — tristate env var handling", () => {
  it("absent env var → relative /api/v1", async () => {
    const { getApiBase } = await getApi();
    delete process.env.NEXT_PUBLIC_API_URL;
    expect(getApiBase()).toBe("/api/v1");
  });

  it("empty string env var → relative /api/v1", async () => {
    const { getApiBase } = await getApi();
    process.env.NEXT_PUBLIC_API_URL = "";
    expect(getApiBase()).toBe("/api/v1");
  });

   it("absolute env var → default same-origin proxy", async () => {
    const { getApiBase } = await getApi();
    process.env.NEXT_PUBLIC_API_URL = "http://10.0.0.5:4097/api/v1";
     expect(getApiBase()).toBe("/api/v1");
  });
});
