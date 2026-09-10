import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeMcpServer } from "../../services/ingenium-dashboard/src/app/chat/components/mcp-status";
import { normalizeMcpStatusResponse } from "../../services/ingenium-api/lib/mcp-status";

const REPOSITORY_ROOT = resolve(__dirname, "../..");

interface OpenCodeConfigFixture {
  mcp: Record<string, {
    type: string;
    command: string[];
    enabled: boolean;
    environment: Record<string, string>;
  }>;
}

interface OpenCodeStatusFixture {
  opencodeVersion: string;
  request: { method: string; path: string; query: Record<string, string> };
  response: Record<string, unknown>;
  expected: {
    mcpServer: string;
    toolName: string;
    canonicalToolName: string;
    toolCount: number;
  };
}

function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(
    resolve(REPOSITORY_ROOT, "tests/fixtures/mcp-102", name),
    "utf8",
  )) as T;
}

describe("MCP-102 OpenCode 1.18.9 fixture contract", () => {
  it("keeps the configured server key, status request, and Chat-visible tool count normalized", () => {
    const config = fixture<OpenCodeConfigFixture>("opencode-1.18.9.json");
    const status = fixture<OpenCodeStatusFixture>("mcp-status-1.18.9.json");
    const server = config.mcp[status.expected.mcpServer];

    expect(status.opencodeVersion).toBe("1.18.9");
    expect(status.request).toEqual({
      method: "GET",
      path: "/mcp",
      query: { directory: "__WORKTREE__" },
    });
    expect(server).toMatchObject({
      type: "local",
      command: ["__ENV_EXECUTABLE__", "node", "__MCP_TRANSPORT__"],
      enabled: true,
      environment: {
        INGENIUM_API_URL: "__INGENIUM_API_URL__",
        INGENIUM_API_TOKEN: "__INGENIUM_API_TOKEN__",
        INGENIUM_PROJECT: "__INGENIUM_PROJECT__",
      },
    });

    const normalized = normalizeMcpStatusResponse(status.response);
    const chatServer = normalizeMcpServer(status.expected.mcpServer, normalized?.[status.expected.mcpServer]);
    expect(chatServer).toMatchObject({ status: "connected", connected: true, toolCount: status.expected.toolCount });
    expect(`${status.expected.mcpServer}_${status.expected.toolName}`).toBe(status.expected.canonicalToolName);
  });
});
