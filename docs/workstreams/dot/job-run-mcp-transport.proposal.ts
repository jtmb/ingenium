import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {ListToolsRequestSchema,CallToolRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {createJobRunMcpClient} from "./job-run-mcp-client.js";
/** Dedicated SDK transport. Never imports generic binding, global HTTP client or browser/service Auth. */
export async function runJobRunMcpTransport():Promise<void>{
 const client=createJobRunMcpClient();
 await client.listTools(); // current-run authentication before exposing a transport
 const server=new Server({name:"ingenium-job-run",version:"1.0.0"},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:await client.listTools()}));
 server.setRequestHandler(CallToolRequestSchema,async request=>client.callTool(request.params.name,request.params.arguments??{}));
 await server.connect(new StdioServerTransport());
 const close=()=>{void server.close().catch(()=>{process.exitCode=1;});};
 process.once("SIGTERM",close);process.once("SIGINT",close);
}
