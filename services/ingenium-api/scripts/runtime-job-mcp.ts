export {};
// Fixed bridge to the existing qualified extension transport; never falls back to generic launcher binding.
if(process.env.INGENIUM_MCP_AUDIENCE!=="job-run")throw Error("Original JobRun MCP audience unavailable");
const entry=new URL("file:///app/packages/ingenium-extension/dist/scripts/job-run-mcp-transport.js");
const candidate:unknown=await import(entry.href);
if(!candidate||typeof candidate!=="object"||!("runJobRunMcpTransport" in candidate)||typeof candidate.runJobRunMcpTransport!=="function")throw Error("Original JobRun MCP transport unavailable");
await (candidate as {runJobRunMcpTransport():Promise<void>}).runJobRunMcpTransport();
