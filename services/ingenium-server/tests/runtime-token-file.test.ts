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

afterEach(() => {
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
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

    const { apiRequestHeaders } = await import("../config/index.js");

    expect(apiRequestHeaders().has("Authorization")).toBe(false);
    expect(runtimeToken.opened).toBe(0);
  });
});
