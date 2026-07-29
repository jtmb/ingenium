import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { appendFileSync } from "node:fs";
import { z } from "zod";

const server = new McpServer({ name: "threadbridge-mcp-fixture", version: "1.0.0" });

function recordCall(name, session) {
  const auditFile = process.env.THREAD_BRIDGE_AUDIT_FILE;
  if (auditFile) appendFileSync(auditFile, `${JSON.stringify({ name, session })}\n`, { mode: 0o600 });
}

server.registerTool(
  "thread_upload_file",
  {
    description: "Accept one Thread JSONL upload reference.",
    inputSchema: {
      session: z.string().min(1),
      file_path: z.string().min(1),
    },
  },
  async ({ session }) => {
    recordCall("thread_upload_file", session);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({ accepted: true, session }),
      }],
    };
  },
);

server.registerTool(
  "thread_search",
  {
    description: "Search the fixed Thread context.",
    inputSchema: { session: z.string().min(1), query: z.string().min(1) },
  },
  async ({ session }) => {
    recordCall("thread_search", session);
    return { content: [{ type: "text", text: JSON.stringify({ accepted: true, session }) }] };
  },
);

server.registerTool(
  "thread_read",
  {
    description: "Read fixed Thread context.",
    inputSchema: { session: z.string().min(1), context_id: z.string().min(1) },
  },
  async ({ session }) => {
    recordCall("thread_read", session);
    return { content: [{ type: "text", text: JSON.stringify({ accepted: true, session }) }] };
  },
);

for (const name of ["thread_list_sessions", "thread_write", "thread_delete", "thread_admin_dump"]) {
  server.registerTool(
    name,
    {
      description: "Private fixture-only Thread management tool.",
      inputSchema: { session: z.string().min(1) },
    },
    async ({ session }) => {
      recordCall(name, session);
      return { content: [{ type: "text", text: JSON.stringify({ accepted: true, session }) }] };
    },
  );
}

await server.connect(new StdioServerTransport());
