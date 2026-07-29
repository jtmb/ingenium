import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { z } from "zod";

const server = new McpServer({ name: "threadbridge-official-fixture", version: "1.0.0" });

function recordCall(name, arguments_) {
  const auditFile = process.env.THREAD_BRIDGE_AUDIT_FILE;
  if (!auditFile) return;
  const record = { name, session: arguments_.session };
  if (name === "thread_upload_file") {
    const bytes = readFileSync(arguments_.file_path);
    Object.assign(record, {
      filePath: arguments_.file_path,
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  appendFileSync(auditFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

function result(name, arguments_) {
  recordCall(name, arguments_);
  return { content: [{ type: "text", text: JSON.stringify({ accepted: true, session: arguments_.session }) }] };
}

server.registerTool(
  "thread_upload_file",
  {
    description: "Official fixture upload implementation.",
    inputSchema: {
      session: z.string().min(1),
      file_path: z.string().min(1),
      tags: z.string().optional(),
      priority: z.number().int().min(0).max(10).optional(),
    },
  },
  async (arguments_) => {
    if (!existsSync(arguments_.file_path)) throw new Error("temporary upload was not available to the official bridge");
    return result("thread_upload_file", arguments_);
  },
);

server.registerTool(
  "thread_search",
  {
    description: "Official fixture search implementation.",
    inputSchema: { session: z.string().min(1), query: z.string().min(1), limit: z.number().int().optional(), use_cache: z.boolean().optional() },
  },
  async (arguments_) => result("thread_search", arguments_),
);

server.registerTool(
  "thread_read_entries",
  {
    description: "Official fixture read implementation.",
    inputSchema: { session: z.string().min(1), limit: z.number().int().optional(), after: z.number().int().optional(), sort: z.enum(["asc", "desc"]).optional() },
  },
  async (arguments_) => result("thread_read_entries", arguments_),
);

server.registerTool(
  "thread_read_entries_batch",
  {
    description: "Official fixture batch implementation.",
    inputSchema: { session: z.string().min(1), ids: z.array(z.number().int().positive()).min(1).max(100) },
  },
  async (arguments_) => result("thread_read_entries_batch", arguments_),
);

server.registerTool(
  "thread_get_tags",
  { description: "Official fixture tags implementation.", inputSchema: { session: z.string().min(1) } },
  async (arguments_) => result("thread_get_tags", arguments_),
);

server.registerTool(
  "thread_get_stats",
  { description: "Official fixture stats implementation.", inputSchema: { session: z.string().min(1) } },
  async (arguments_) => result("thread_get_stats", arguments_),
);

server.registerTool(
  "thread_admin_dump",
  { description: "Hidden administrative fixture tool.", inputSchema: { session: z.string().min(1) } },
  async (arguments_) => result("thread_admin_dump", arguments_),
);

await server.connect(new StdioServerTransport());
