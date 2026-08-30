import { afterEach, describe, expect, it, vi } from "vitest";
import { constants } from "node:fs";

const runtimeToken = vi.hoisted(() => ({
  enabled: false,
  path: "",
  descriptor: 71,
  opened: 0,
  flags: null as number | null,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync(...args: Parameters<typeof actual.openSync>) {
      if (runtimeToken.enabled && args[0] === runtimeToken.path) {
        runtimeToken.opened += 1;
        runtimeToken.flags = typeof args[1] === "number" ? args[1] : null;
        return runtimeToken.descriptor;
      }
      return actual.openSync(...args);
    },
    fstatSync(...args: Parameters<typeof actual.fstatSync>) {
      if (args[0] === runtimeToken.descriptor) {
        return {
          isFile: () => true,
          mode: 0o100600,
          uid: process.getuid?.() ?? 0,
        } as ReturnType<typeof actual.fstatSync>;
      }
      return actual.fstatSync(...args);
    },
    readFileSync(...args: Parameters<typeof actual.readFileSync>) {
      if (args[0] === runtimeToken.descriptor) return "runtime-token\n";
      return actual.readFileSync(...args);
    },
    closeSync(...args: Parameters<typeof actual.closeSync>) {
      if (args[0] === runtimeToken.descriptor) return;
      return actual.closeSync(...args);
    },
  };
});

const originalToken = process.env.INGENIUM_API_TOKEN;
const originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
const originalInternalService = process.env.INGENIUM_INTERNAL_SERVICE;
const originalMcpCredentialFile = process.env.INGENIUM_MCP_CREDENTIAL_FILE;
const originalMcpAudience = process.env.INGENIUM_MCP_AUDIENCE;
const originalMcpReportMode = process.env.INGENIUM_MCP_REPORT_MODE;
const originalProject = process.env.INGENIUM_PROJECT;
const originalWorkspaceId = process.env.INGENIUM_WORKSPACE_ID;
const originalWorktree = process.env.INGENIUM_WORKTREE;

afterEach(() => {
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
  if (originalInternalService === undefined) delete process.env.INGENIUM_INTERNAL_SERVICE;
  else process.env.INGENIUM_INTERNAL_SERVICE = originalInternalService;
  for (const [key, value] of Object.entries({
    INGENIUM_MCP_CREDENTIAL_FILE: originalMcpCredentialFile,
    INGENIUM_MCP_AUDIENCE: originalMcpAudience,
    INGENIUM_MCP_REPORT_MODE: originalMcpReportMode,
    INGENIUM_PROJECT: originalProject,
    INGENIUM_WORKSPACE_ID: originalWorkspaceId,
    INGENIUM_WORKTREE: originalWorktree,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  runtimeToken.enabled = false;
  runtimeToken.path = "";
  runtimeToken.opened = 0;
  runtimeToken.flags = null;
  vi.resetModules();
});

describe("runtime MCP token file", () => {
  it("uses the entrypoint-owned private token file without following links", async () => {
    runtimeToken.enabled = true;
    runtimeToken.path = "/run/ingenium-secrets/api-token";
    delete process.env.INGENIUM_API_TOKEN;
    process.env.INGENIUM_API_TOKEN_FILE = runtimeToken.path;
    process.env.INGENIUM_INTERNAL_SERVICE = "1";

    const { apiRequestHeaders } = await import("../config/index.js");

    expect(apiRequestHeaders().get("Authorization")).toBe("Bearer runtime-token");
    expect(runtimeToken.opened).toBe(1);
    expect(runtimeToken.flags).toBe(constants.O_RDONLY | constants.O_NOFOLLOW);
  });

  it("rejects other absolute token-file paths", async () => {
    runtimeToken.enabled = true;
    runtimeToken.path = "/run/ingenium-secrets/other-token";
    delete process.env.INGENIUM_API_TOKEN;
    process.env.INGENIUM_API_TOKEN_FILE = runtimeToken.path;
    process.env.INGENIUM_INTERNAL_SERVICE = "1";

    const { apiRequestHeaders } = await import("../config/index.js");

    expect(apiRequestHeaders().has("Authorization")).toBe(false);
    expect(runtimeToken.opened).toBe(0);
  });

  it("accepts only an API-owned report credential path with exact report headers", async () => {
    runtimeToken.enabled = true;
    runtimeToken.path = "/run/ingenium-secrets/api/mcp-report-11111111-1111-4111-8111-111111111111";
    delete process.env.INGENIUM_API_TOKEN;
    delete process.env.INGENIUM_API_TOKEN_FILE;
    delete process.env.INGENIUM_INTERNAL_SERVICE;
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = runtimeToken.path;
    process.env.INGENIUM_MCP_AUDIENCE = "mcp-report";
    process.env.INGENIUM_MCP_REPORT_MODE = "1";
    process.env.INGENIUM_PROJECT = "report-project";
    process.env.INGENIUM_WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
    process.env.INGENIUM_WORKTREE = "/app";

    const { apiRequestHeaders } = await import("../config/index.js");
    const headers = apiRequestHeaders();

    expect(headers.get("Authorization")).toBe("Bearer runtime-token");
    expect(headers.get("X-Ingenium-Audience")).toBe("mcp-report");
    expect(headers.get("X-Ingenium-MCP-Report")).toBe("1");
    expect(headers.get("X-Ingenium-Project")).toBe("report-project");
    expect(headers.get("X-Ingenium-Workspace")).toBe("22222222-2222-4222-8222-222222222222");
    expect(headers.get("X-Ingenium-Launcher-Worktree")).toBe("/app");
    expect(headers.has("X-Ingenium-Internal-Service")).toBe(false);
  });

  it("rejects a report credential outside the API-owned report filename contract", async () => {
    runtimeToken.enabled = true;
    runtimeToken.path = "/run/ingenium-secrets/api/installation-api-token";
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = runtimeToken.path;
    process.env.INGENIUM_MCP_AUDIENCE = "mcp-report";
    process.env.INGENIUM_MCP_REPORT_MODE = "1";

    const { apiRequestHeaders } = await import("../config/index.js");

    expect(apiRequestHeaders().has("Authorization")).toBe(false);
    expect(runtimeToken.opened).toBe(0);
  });
});
