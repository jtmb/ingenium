#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import http from "node:http";
import { dirname } from "node:path";

const passwordFile = process.env.OPENCODE_SERVER_PASSWORD_FILE;
if (!passwordFile) throw new Error("OpenCode internal authentication is not configured");

function readPassword(path) {
  const parent = lstatSync(dirname(path));
  if (!parent.isDirectory() || parent.uid !== process.getuid() || parent.gid !== process.getgid() || (parent.mode & 0o777) !== 0o700) throw new Error();
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.uid !== process.getuid() || metadata.gid !== process.getgid() || (metadata.mode & 0o777) !== 0o600 || metadata.size > 65) throw new Error();
    const contents = readFileSync(descriptor, "utf8");
    const value = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
    if (!/^[A-Za-z0-9_-]{64}$/.test(value)) throw new Error();
    return value;
  } finally {
    closeSync(descriptor);
  }
}

const expected = Buffer.from(`Basic ${Buffer.from(`opencode:${readPassword(passwordFile)}`).toString("base64")}`);

function authorized(value) {
  const provided = Buffer.from(typeof value === "string" ? value : "");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const excluded = new Set(["authorization", "proxy-authorization", "connection", "keep-alive", "transfer-encoding", "upgrade"]);
const server = http.createServer({ headersTimeout: 30_000, requestTimeout: 120_000, maxHeaderSize: 16 * 1024 }, (request, response) => {
  if (!authorized(request.headers.authorization)) {
    request.resume();
    response.writeHead(401, { "cache-control": "no-store", "www-authenticate": "Basic realm=opencode-internal" });
    response.end();
    return;
  }
  const headers = Object.fromEntries(Object.entries(request.headers).filter(([name, value]) => !excluded.has(name.toLowerCase()) && value !== undefined));
  headers.host = "127.0.0.1:4098";
  const upstream = http.request({ host: "127.0.0.1", port: 4098, method: request.method, path: request.url, headers }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
    response.end('{"error":{"code":"OPENCODE_UNAVAILABLE"}}');
  });
  request.on("aborted", () => upstream.destroy());
  request.pipe(upstream);
});

server.listen(4101, "127.0.0.1");

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
