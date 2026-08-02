import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const portFile = process.env.MCP103_FIXTURE_PORT_FILE;
if (!portFile) process.exit(2);

const listener = createServer((_request, response) => {
  response.writeHead(204);
  response.end();
});
const server = new McpServer({ name: "mcp-103-fixture", version: "1.0.0" });
server.registerTool("health_check", { description: "fixture health", inputSchema: {} }, async () => ({
  content: [{ type: "text", text: "fixture payload is intentionally opaque" }],
}));

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise((resolve) => listener.close(resolve));
  process.exit(0);
}

process.once("SIGTERM", () => void stop());
process.once("SIGINT", () => void stop());
process.stdin.once("end", () => void stop());

listener.listen(0, "127.0.0.1", async () => {
  const address = listener.address();
  if (!address || typeof address === "string") process.exit(2);
  writeFileSync(portFile, JSON.stringify({ pid: process.pid, port: address.port }), { mode: 0o600 });
  await server.connect(new StdioServerTransport());
});
