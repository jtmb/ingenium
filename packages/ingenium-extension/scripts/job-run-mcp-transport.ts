import {Server} from "@modelcontextprotocol/sdk/server/index.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {ListToolsRequestSchema,CallToolRequestSchema} from "@modelcontextprotocol/sdk/types.js";
import {createJobRunMcpClient} from "./job-run-mcp-client.js";
export type JobRunMcpClient=ReturnType<typeof createJobRunMcpClient>;
/** Dedicated SDK transport. Never imports generic binding, global HTTP client or browser/service Auth. */
export async function createJobRunMcpServer(client:JobRunMcpClient=createJobRunMcpClient()):Promise<Server>{
 await client.listTools(); // current-run authentication before exposing a transport
 const server=new Server({name:"ingenium-job-run",version:"1.0.0"},{capabilities:{tools:{}}});
 server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:await client.listTools()}));
 server.setRequestHandler(CallToolRequestSchema,async request=>client.callTool(request.params.name,request.params.arguments??{}));
 return server;
}
export async function runJobRunMcpTransport():Promise<void>{
 const server=await createJobRunMcpServer();
 await server.connect(new StdioServerTransport());
 const close=()=>{void server.close().catch(()=>{process.exitCode=1;});};
 process.once("SIGTERM",close);process.once("SIGINT",close);
}
