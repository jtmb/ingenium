import http from "node:http";
import { createRequire } from "node:module";
import { parse } from "node:url";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { proxyRequest } = require("/app/node_modules/next/dist/server/lib/router-utils/proxy-request.js");
const config = require("/app/services/ingenium-dashboard/.next/required-server-files.json").config;
const timeout = config.experimental?.proxyTimeout;
const expected = Buffer.from("SQLite format 3\0INGENIUM_SLOW_VERIFIED_BACKUP_PROXY");
const listen = (server) => new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => resolve(server.address().port));
});
const backend = http.createServer((_req, res) => {
  const timer = setTimeout(() => {
    res.writeHead(200, { "content-type": "application/vnd.sqlite3", "content-length": expected.length });
    res.end(expected);
  }, 31_500);
  res.once("close", () => clearTimeout(timer));
});
let backendPort;
const proxy = http.createServer((req, res) => {
  proxyRequest(req, res, parse(`http://127.0.0.1:${backendPort}/verified-backup`), undefined, undefined, timeout)
    .catch(() => { if (!res.headersSent) res.writeHead(500); res.end("proxy failed"); });
});
try {
  backendPort = await listen(backend);
  const proxyPort = await listen(proxy);
  const started = Date.now();
  const response = await fetch(`http://127.0.0.1:${proxyPort}/download`, { signal: AbortSignal.timeout(50_000) });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200, "packaged proxy must survive verification beyond 30 seconds");
  assert.equal(response.headers.get("content-type"), "application/vnd.sqlite3");
  assert.deepEqual(bytes, expected);
  assert.ok(Date.now() - started >= 31_000);
  console.log(JSON.stringify({ passed: true, proxyTimeout: timeout, elapsedMs: Date.now()-started, binaryBodyPreserved: true }));
} finally {
  for (const server of [proxy, backend]) { server.closeAllConnections(); server.close(); }
}
