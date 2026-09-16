import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const resolveExtensionBinding = vi.hoisted(() => vi.fn());

vi.mock("./extension-binding.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("./extension-binding.js")>(),
  resolveExtensionBinding,
}));

import { openMcpToolClient, type McpBridgeLaunchOptions } from "./mcp-client.js";

let worktree = "";

afterEach(() => {
  vi.unstubAllEnvs();
  resolveExtensionBinding.mockReset();
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

describe("runtime MCP bridge", () => {
  it("passes the resolved runtime capability file to the child server", async () => {
    worktree = mkdtempSync(join(tmpdir(), "ingenium-runtime-mcp-client-"));
    const credentialFile = join(worktree, "capability");
    writeFileSync(credentialFile, `${"r".repeat(43)}\n`, { mode: 0o600 });
    chmodSync(credentialFile, 0o600);
    vi.stubEnv("INGENIUM_RUNTIME_CREDENTIAL_FILE", undefined);
    vi.stubEnv("INGENIUM_PROJECT", "runtime-project");
    resolveExtensionBinding.mockReturnValue({
      apiUrl: "https://api.test/api/v1",
      project: "runtime-project",
      projectId: "00000000-0000-4000-8000-000000000001",
      runtimeId: "00000000-0000-4000-8000-000000000002",
      workspaceId: "runtime-workspace",
      launcherWorktree: worktree,
      storageMappingHash: "a".repeat(64),
      audience: "runtime",
      credentialFile,
      purpose: "runtime",
    });
    let launch: McpBridgeLaunchOptions | undefined;

    const bridge = await openMcpToolClient(worktree, {
      credentialPurpose: "runtime",
      launcherPath: "/package/dist/scripts/mcp-server.js",
      createTransport: (options) => {
        launch = options;
        return { close: async () => undefined };
      },
      createClient: () => ({
        connect: async () => undefined,
        callTool: async () => ({ content: [] }),
        close: async () => undefined,
      }),
    });
    await bridge.close();

    expect(launch?.env).toMatchObject({
      INGENIUM_MCP_CREDENTIAL_FILE: credentialFile,
      INGENIUM_MCP_CREDENTIAL_PURPOSE: "runtime",
      INGENIUM_MCP_AUDIENCE: "runtime",
      INGENIUM_RUNTIME_ID: "00000000-0000-4000-8000-000000000002",
      INGENIUM_RUNTIME_CREDENTIAL_FILE: credentialFile,
    });
  });
});
