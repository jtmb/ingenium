#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, closeSync, constants, fchmodSync, fchownSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const gatewayDirectory = "/run/ingenium-opencode-gateway";
const gatewayOrigin = "http://opencode.localhost:3000";
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;

export function readPassword(path) {
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

function authorized(value, expected) {
  const provided = Buffer.from(typeof value === "string" ? value : "");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

const excluded = new Set([
  "authorization", "proxy-authorization", "connection", "proxy-connection", "keep-alive", "transfer-encoding", "upgrade", "te", "trailer",
  "forwarded", "via", "x-ingenium-authenticated-user", "x-client-identity", "x-authenticated-user", "x-user", "x-real-ip", "remote-user",
]);

function filteredHeaders(headers) {
  const connection = new Set((headers.connection ?? "").toLowerCase().split(",").map((name) => name.trim()));
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) => value !== undefined && !excluded.has(name) && !connection.has(name)
    && !["x-forwarded-", "x-auth-", "x-remote-", "x-original-", "x-rewrite-"].some((prefix) => name.startsWith(prefix))));
}

export function createProxyServer(password, gateway = false, upstreamPort = 4098) {
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
  const expected = Buffer.from(authorization);
  const sockets = new Set();

  function status(request) {
    if (!gateway && !authorized(request.headers.authorization, expected)) return 401;
    if (gateway && request.headers.origin !== undefined && request.headers.origin !== gatewayOrigin) return 403;
    if (!request.url.startsWith("/") || request.url.startsWith("//")) return 400;
    return 0;
  }

  function reject(response, code) {
    response.writeHead(code, { "cache-control": "no-store", connection: "close",
      ...(code === 401 ? { "www-authenticate": "Basic realm=opencode-internal" } : {}) });
    response.end();
  }

  function forward(request, upgrade = false) {
    const headers = filteredHeaders(request.headers);
    headers.host = gateway ? "opencode.localhost:3000" : "127.0.0.1:4098";
    headers.authorization = authorization;
    if (upgrade) Object.assign(headers, { connection: "Upgrade", upgrade: "websocket" });
    return http.request({ host: "127.0.0.1", port: upstreamPort, method: request.method, path: request.url, headers, agent: false });
  }

  const server = http.createServer({ headersTimeout: 30_000, requestTimeout: 120_000, maxHeaderSize: 16 * 1024 }, (request, response) => {
    const rejected = status(request);
    if (rejected) {
      request.resume();
      reject(response, rejected);
      return;
    }
    const upstream = forward(request);
    upstream.on("response", (incoming) => {
      incoming.on("error", () => response.destroy());
      response.on("close", () => incoming.destroy());
      response.writeHead(incoming.statusCode ?? 502, filteredHeaders(incoming.headers));
      response.flushHeaders();
      incoming.pipe(response);
    });
    upstream.on("error", () => {
      if (response.headersSent) response.destroy();
      else {
        response.writeHead(502, { "content-type": "application/json", "cache-control": "no-store" });
        response.end('{"error":{"code":"OPENCODE_UNAVAILABLE"}}');
      }
    });
    upstream.setTimeout(3_600_000, () => upstream.destroy());
    response.on("close", () => upstream.destroy());
    request.on("aborted", () => upstream.destroy());
    request.on("error", () => upstream.destroy());
    request.pipe(upstream);
  });

  server.on("upgrade", (request, socket, head) => {
    socket.pause();
    let peer;
    let response;
    const reply = () => {
      if (!response) {
        response = new http.ServerResponse(request);
        response.assignSocket(socket);
        response.shouldKeepAlive = false;
        response.on("finish", () => socket.end());
        response.on("error", () => socket.destroy());
      }
      return response;
    };
    const rejected = status(request) || (request.method !== "GET" || request.headers.upgrade?.toLowerCase() !== "websocket" ? 400 : 0);
    if (rejected) {
      reject(reply(), rejected);
      return;
    }
    const upstream = forward(request, true);
    const cleanup = () => { upstream.destroy(); peer?.destroy(); socket.destroy(); };
    socket.on("close", cleanup);
    socket.on("error", cleanup);
    socket.setTimeout(3_600_000, cleanup);
    upstream.setTimeout(30_000, () => upstream.destroy());
    upstream.on("error", () => {
      if (peer || response?.headersSent || socket.destroyed) cleanup();
      else reject(reply(), 502);
    });
    upstream.on("response", (incoming) => {
      const outgoing = reply();
      incoming.on("error", cleanup);
      outgoing.on("close", () => incoming.destroy());
      outgoing.writeHead(incoming.statusCode ?? 502, filteredHeaders(incoming.headers));
      incoming.pipe(outgoing);
    });
    upstream.on("upgrade", (incoming, upstreamSocket, upstreamHead) => {
      peer = upstreamSocket;
      if (socket.destroyed || incoming.headers.upgrade?.toLowerCase() !== "websocket") { cleanup(); return; }
      peer.setTimeout(3_600_000, cleanup);
      peer.on("error", cleanup);
      peer.on("close", cleanup);
      const headers = { ...filteredHeaders(incoming.headers), connection: "Upgrade", upgrade: "websocket" };
      const lines = Object.entries(headers).flatMap(([name, values]) => [values].flat().map((value) => `${name}: ${value}\r\n`)).join("");
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines}\r\n`);
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      socket.pipe(peer).pipe(socket);
      socket.resume();
    });
    upstream.end();
  });

  server.setTimeout(3_600_000);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
  });
  return { server, close: () => new Promise((done) => {
    server.close(done);
    for (const socket of sockets) socket.destroy();
  }) };
}

function unsafeSocket() { throw new Error("OPENCODE_GATEWAY_SOCKET_UNSAFE"); }
function sameObject(left, right) { return left.dev === right.dev && left.ino === right.ino; }

function noAcl(path) {
  const acl = execFileSync("getfacl", ["--absolute-names", "--omit-header", "--numeric", "--no-effective", path], { encoding: "utf8", timeout: 2_000 });
  if (acl.trim().split("\n").length !== 3 || !acl.trim().split("\n").every((line) => /^(user|group|other)::[r-][w-][x-]$/.test(line))) unsafeSocket();
}

function openDirectory(path) {
  if (process.platform !== "linux" || !isAbsolute(path) || resolve(path) !== path) unsafeSocket();
  let descriptor = openSync("/", directoryFlags);
  try {
    for (const component of path.split("/").filter(Boolean)) {
      const next = openSync(`/proc/self/fd/${descriptor}/${component}`, directoryFlags);
      closeSync(descriptor);
      descriptor = next;
    }
    return descriptor;
  } catch (error) { closeSync(descriptor); throw error; }
}

function checkedDirectory(path, uid, gid) {
  const descriptor = openDirectory(path);
  try {
    const metadata = fstatSync(descriptor);
    if (metadata.uid !== uid || metadata.gid !== gid || (metadata.mode & 0o7777) !== 0o2710) unsafeSocket();
    noAcl(`/proc/${process.pid}/fd/${descriptor}`);
    return descriptor;
  } catch (error) { closeSync(descriptor); throw error; }
}

function checkedSocket(path, uid, gid) {
  const metadata = lstatSync(path);
  if (!metadata.isSocket() || metadata.uid !== uid || metadata.gid !== gid || metadata.nlink !== 1 || (metadata.mode & 0o7777) !== 0o620) unsafeSocket();
  noAcl(path);
  return metadata;
}

export function verifyGatewayGroup() {
  const groups = execFileSync("getent", ["group"], { encoding: "utf8", timeout: 2_000 }).trim().split("\n").map((line) => line.split(":"));
  const matching = groups.filter((entry) => entry[2] === "1104");
  if (matching.length !== 1 || matching[0][0] !== "ingenium-gateway" || matching[0][3].split(",").some((name) => name && name !== "ingenium-gateway")) unsafeSocket();
  const users = execFileSync("getent", ["passwd"], { encoding: "utf8", timeout: 2_000 }).trim().split("\n").map((line) => line.split(":"));
  const gateway = users.filter((entry) => entry[2] === "1104" || entry[3] === "1104");
  if (gateway.length !== 1 || gateway[0][0] !== "ingenium-gateway" || gateway[0][2] !== "1104" || gateway[0][3] !== "1104") unsafeSocket();
}

export function verifyGatewayPath(path = gatewayDirectory, uid = 1105, gid = 1104, socket = false) {
  const descriptor = checkedDirectory(path, uid, gid);
  try { if (socket) checkedSocket(`/proc/${process.pid}/fd/${descriptor}/http.sock`, uid, gid); }
  finally { closeSync(descriptor); }
}

export async function removeVerifiedGatewaySocket(path = gatewayDirectory, uid = 1105, gid = 1104) {
  const descriptor = checkedDirectory(path, uid, gid);
  const target = `${path}/http.sock`;
  const anchored = `/proc/${process.pid}/fd/${descriptor}/http.sock`;
  try {
    let metadata;
    try { metadata = checkedSocket(anchored, uid, gid); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    await new Promise((done, reject) => {
      const socket = net.createConnection(target);
      socket.setTimeout(500, () => { socket.destroy(); reject(new Error("OPENCODE_GATEWAY_SOCKET_PROBE_TIMEOUT")); });
      socket.on("connect", () => { socket.destroy(); reject(new Error("OPENCODE_GATEWAY_SOCKET_LIVE")); });
      socket.on("error", (error) => { socket.destroy(); error.code === "ECONNREFUSED" ? done() : reject(error); });
    });
    // ECONNREFUSED also describes a bound, non-listening socket; the kernel must have released it.
    const owned = readFileSync("/proc/net/unix", "utf8").split("\n").some((entry) => {
      const candidate = entry.trim().split(/\s+/).slice(7).join(" ");
      if (candidate === target) return true;
      if (!candidate.startsWith("/")) return false;
      try { return realpathSync(candidate) === target; } catch { return false; }
    });
    if (owned || !sameObject(metadata, checkedSocket(anchored, uid, gid))) unsafeSocket();
    unlinkSync(anchored);
  } finally { closeSync(descriptor); }
}

async function prepareGateway() {
  if (process.getuid() !== 0) unsafeSocket();
  verifyGatewayGroup();
  const parent = openDirectory("/run");
  const path = `/proc/${process.pid}/fd/${parent}/ingenium-opencode-gateway`;
  try {
    try { lstatSync(path); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      mkdirSync(path, { mode: 0o700 });
      const descriptor = openSync(path, directoryFlags);
      try {
        noAcl(`/proc/${process.pid}/fd/${descriptor}`);
        fchownSync(descriptor, 1105, 1104);
        fchmodSync(descriptor, 0o2710);
      } finally { closeSync(descriptor); }
    }
    await removeVerifiedGatewaySocket();
  } finally { closeSync(parent); }
}

export async function listenGateway(server, path = gatewayDirectory, uid = 1105, gid = 1104) {
  await removeVerifiedGatewaySocket(path, uid, gid);
  const descriptor = checkedDirectory(path, uid, gid);
  try {
    // Gateway access is enabled only after bind and metadata validation, never by the initial umask.
    process.umask(0o077);
    const listening = once(server, "listening");
    server.listen(`${path}/http.sock`);
    await listening;
    const socketPath = `/proc/${process.pid}/fd/${descriptor}/http.sock`;
    const metadata = lstatSync(socketPath);
    if (!sameObject(fstatSync(descriptor), lstatSync(path)) || !metadata.isSocket() || metadata.uid !== uid || metadata.gid !== gid
      || (metadata.mode & 0o7777) !== 0o700) unsafeSocket();
    noAcl(socketPath);
    chmodSync(socketPath, 0o620);
    if (!sameObject(metadata, checkedSocket(socketPath, uid, gid))) unsafeSocket();
  } finally { closeSync(descriptor); }
}

async function main() {
  process.umask(0o077);
  if (process.argv[2] === "--prepare-gateway") return prepareGateway();
  if (["--verify-gateway-directory", "--verify-gateway-socket"].includes(process.argv[2])) {
    verifyGatewayGroup();
    return verifyGatewayPath(gatewayDirectory, 1105, 1104, process.argv[2] === "--verify-gateway-socket");
  }
  if (process.argv.length !== 2 || process.getuid() !== 1105 || process.getgid() !== 1105) unsafeSocket();
  verifyGatewayGroup();
  const password = readPassword(process.env.OPENCODE_SERVER_PASSWORD_FILE);
  const tcp = createProxyServer(password);
  const gateway = createProxyServer(password, true);
  const shutdown = async () => {
    const timer = setTimeout(() => process.exit(1), 10_000);
    await Promise.all([tcp.close(), gateway.close()]);
    clearTimeout(timer);
  };
  try {
    await listenGateway(gateway.server);
    const listening = once(tcp.server, "listening");
    tcp.server.listen(4101, "127.0.0.1");
    await listening;
  } catch (error) { await shutdown(); throw error; }
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error("ERROR: OpenCode authentication bridge failed closed"); process.exitCode = 1; });
}
