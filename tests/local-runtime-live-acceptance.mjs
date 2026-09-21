import { readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { Client } from "/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "/app/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import { discoveryNames, selectBrowserTool, browserCall, toolResultMetadata } from "./managed-playwright-live.mjs";

// Run as UID 1105 inside the compatibility container; credentials never leave it.
const identity = Object.fromEntries(readFileSync("/run/ingenium-runtime/environment", "utf8").trim().split("\n").map(line => {
  const match = /^(INGENIUM_[A-Z_]+)='([^']+)'$/.exec(line);
  if (!match) throw new Error("RUNTIME_IDENTITY_INVALID");
  return [match[1], match[2]];
}));
const headers = {
  authorization: `Bearer ${readFileSync("/run/ingenium-runtime/capability", "utf8").trim()}`,
  "x-ingenium-audience": "runtime", "x-ingenium-workspace": identity.INGENIUM_WORKSPACE_ID,
  "x-ingenium-launcher-worktree": "/workspace", "content-type": "application/json",
};
const emit = data => console.log(JSON.stringify(data));
const check = (ok, code) => { if (!ok) throw new Error(code); };
async function api(path, method = "GET") {
  const response = await fetch(`http://127.0.0.1:4097/api/v1/mcp-servers${path}?project=ingenium`, {
    method, headers, ...(method === "POST" ? { body: "{}" } : {}), signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}
let preset = false, client, transport, closeName, stage = "PRESET_LIST";
const toolsOnly = process.argv.includes("--tools-only");
const callsOnly = process.argv.includes("--calls-only");
try {
  if (!toolsOnly && !callsOnly) {
  const existing = await api("");
  check(existing.status === 200 && !existing.body.data.some(server => server.name === "playwright"), "PRESET_NOT_ABSENT");
  emit({ stage, status: existing.status, absent: true });
  stage = "PRESET_CREATE";
  const created = await api("/presets/playwright", "POST");
  preset = created.status === 201;
  emit({ stage, status: created.status });
  check(preset, "PRESET_CREATE_FAILED");
  stage = "PRESET_REFRESH";
  const refresh = await api("/playwright/refresh", "POST");
  emit({ stage, status: refresh.status });
  check(refresh.status === 200, "PRESET_REFRESH_FAILED");
  stage = "DISCOVERY";
  let names = [];
  for (let poll = 0; poll < 12; poll++) {
    const tools = await api("/playwright/tools");
    check(tools.status === 200, "DISCOVERY_HTTP_FAILED");
    names = discoveryNames(tools.body);
    if (names.length) break;
    await setTimeout(5_000);
  }
  emit({ stage, count: names.length, names });
  check(names.length > 0, "DISCOVERY_EMPTY");
  }
  stage = "RUNTIME_MCP_CONNECT";
  transport = new StdioClientTransport({ command: "/usr/local/bin/node",
    args: ["/app/packages/ingenium-extension/dist/scripts/mcp-server.js"], cwd: "/workspace", stderr: "pipe",
    env: { ...identity, PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/home/ingenium-opencode",
      INGENIUM_API_URL: "http://localhost:4097/api/v1", INGENIUM_MCP_AUDIENCE: "runtime",
      INGENIUM_MCP_CREDENTIAL_PURPOSE: "runtime", INGENIUM_RUNTIME_CREDENTIAL_FILE: "/run/ingenium-runtime/capability" },
  });
  transport.stderr?.on("data", chunk => {
    for (const line of chunk.toString().split("\n")) {
      try {
        const entry = JSON.parse(line);
        if (entry.boundary === "launcher") emit({ stage: "LAUNCHER", reason: entry.reason, message: entry.message });
      } catch {}
    }
  });
  client = new Client({ name: "local-runtime-live-acceptance", version: "1.0.0" });
  await client.connect(transport);
  emit({ stage: "MCP_CONNECTED" });
  if (process.argv.includes("--wait")) await new Promise(resolve => process.stdin.once("data", resolve));
  let entries = [];
  for (let poll = 0; poll < 600; poll++) {
    entries = (await client.listTools()).tools;
    if (["navigate", "snapshot", "close"].every(operation => selectBrowserTool(entries, operation))) break;
    await setTimeout(100);
  }
  emit({ stage: "MCP_TOOLS", total: entries.length, names: entries.filter(tool => tool.name.includes("playwright")).map(tool => tool.name) });
  if (!toolsOnly) {
  const select = suffix => selectBrowserTool(entries, suffix.slice("browser_".length));
  closeName = select("browser_close");
  check(select("browser_navigate") && select("browser_snapshot") && closeName, "RUNTIME_TOOLS_MISSING");
  for (const [suffix, args] of [["browser_navigate", { url: "http://127.0.0.1:3000/" }], ["browser_snapshot", {}], ["browser_close", {}]]) {
    stage = suffix.toUpperCase();
    const result = await client.callTool(browserCall(select(suffix), args));
    emit({ stage, ...toolResultMetadata(result) });
    check(!result.isError, `${stage}_FAILED`);
  }
  }
} catch (error) {
  emit({ failure: /^[A-Z_]+$/.test(error.message) ? error.message : "LIVE_ACCEPTANCE_FAILED", stage });
  process.exitCode = 1;
} finally {
    await client?.close();
    await transport?.close();
    if (preset) {
      const removed = await api("/playwright", "DELETE");
      emit({ stage: "PRESET_DELETE", status: removed.status });
      check(removed.status === 204, "PRESET_DELETE_FAILED");
      const residual = await api("");
      check(residual.status === 200 && !residual.body.data.some(server => server.name === "playwright"), "PRESET_RESIDUAL");
      emit({ stage: "CLEANUP", residual: false });
    }
}
