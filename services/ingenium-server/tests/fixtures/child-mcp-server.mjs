import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { spawn } from "node:child_process";
import { z } from "zod";

function startupDelayMs() {
  const delay = Number(process.env.CHILD_MCP_STARTUP_DELAY_MS ?? "0");
  return Number.isSafeInteger(delay) && delay >= 0 && delay <= 10_000 ? delay : 0;
}

const delay = startupDelayMs();
if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));

const server = new McpServer({ name: "child-mcp-fixture", version: "1.0.0" });

server.registerTool(
  "echo",
  {
    description: "Return a supplied value.",
    inputSchema: { value: z.string() },
  },
  async ({ value }) => ({ content: [{ type: "text", text: value }] }),
);

server.registerTool(
  "environment",
  {
    description: "Expose only environment-presence checks for runtime testing.",
    inputSchema: {},
  },
  async () => ({
    content: [{
      type: "text",
      text: JSON.stringify({
        hasParentSecret: process.env.PARENT_MCP_SECRET !== undefined,
        configuredValue: process.env.CHILD_MCP_CONFIGURED_VALUE ?? null,
        hasPath: process.env.PATH !== undefined,
      }),
    }],
  }),
);

server.registerTool(
  "hang",
  {
    description: "Deliberately does not resolve, for timeout testing.",
    inputSchema: {},
  },
  async () => await new Promise(() => {}),
);

server.registerTool(
  "spawn_descendant",
  {
    description: "Spawn a SIGTERM-resistant descendant for shutdown testing.",
    inputSchema: {},
  },
  async () => {
    const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (!descendant.pid) throw new Error("fixture descendant did not start");
    return { content: [{ type: "text", text: String(descendant.pid) }] };
  },
);

await server.connect(new StdioServerTransport());
if (process.env.CHILD_MCP_STAY_ALIVE === "1") setInterval(() => {}, 1_000);
