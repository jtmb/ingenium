import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "threadbridge-mcp-fixture", version: "1.0.0" });

server.registerTool(
  "thread_upload_file",
  {
    description: "Accept one Thread JSONL upload reference.",
    inputSchema: {
      session: z.string().min(1),
      file_path: z.string().min(1),
    },
  },
  async ({ session, file_path: filePath }) => ({
    content: [{
      type: "text",
      text: JSON.stringify({ accepted: true, session, file_path: filePath }),
    }],
  }),
);

await server.connect(new StdioServerTransport());
