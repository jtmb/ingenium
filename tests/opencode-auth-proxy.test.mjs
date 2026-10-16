import assert from "node:assert/strict";
import { execFile, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import * as fs from "node:fs";
import http from "node:http";
import net from "node:net";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createProxyServer, listenGateway, readPassword, removeVerifiedGatewaySocket, verifyGatewayPath } from "../scripts/opencode-auth-proxy.mjs";

const password = "fixture_".padEnd(64, "p");
const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
const origin = "http://opencode.localhost:3000";
const aclAvailable = spawnSync("getfacl", ["--version"], { stdio: "ignore" }).status === 0;
const aclSkip = aclAvailable ? false : "getfacl unavailable: guarded socket/ACL checks require admitted in-image verification";

function temporary(t) {
  const path = fs.mkdtempSync("/tmp/opencode/auth-proxy-");
  fs.chmodSync(path, 0o700);
  t.after(() => fs.rmSync(path, { recursive: true, force: true }));
  return path;
}

async function listen(server, address = { host: "127.0.0.1", port: 0 }) {
  const listening = once(server, "listening");
  server.listen(address);
  await listening;
  return server.address();
}

function request(options, path = "/", headers = {}, body) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ ...options, path, headers, method: body === undefined ? "GET" : "POST", agent: false }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    outgoing.on("error", reject);
    outgoing.setTimeout(2_000, () => outgoing.destroy(new Error("fixture request timeout")));
    outgoing.end(body);
  });
}

function frame(text, masked = false) {
  const payload = Buffer.from(text);
  assert.ok(payload.length < 126);
  if (!masked) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const mask = Buffer.from([1, 2, 3, 4]);
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, payload.map((byte, index) => byte ^ mask[index % 4])]);
}

function reader(socket) {
  let buffer = Buffer.alloc(0);
  let waiting;
  let ended;
  const check = () => {
    if (!waiting) return;
    const length = waiting.length(buffer);
    if (length) {
      const result = buffer.subarray(0, length);
      buffer = buffer.subarray(length);
      const { resolve } = waiting;
      waiting = undefined;
      resolve(result);
    } else if (ended) { waiting.reject(ended); waiting = undefined; }
  };
  socket.on("data", (chunk) => { buffer = Buffer.concat([buffer, chunk]); check(); });
  socket.on("error", (error) => { ended = error; check(); });
  socket.on("close", () => { ended ??= new Error("socket closed before fixture read"); check(); });
  return (length) => new Promise((resolve, reject) => { waiting = { length, resolve, reject }; check(); });
}

const headerLength = (buffer) => buffer.indexOf("\r\n\r\n") < 0 ? 0 : buffer.indexOf("\r\n\r\n") + 4;
const frameLength = (buffer) => buffer.length >= 2 && buffer.length >= 2 + buffer[1] ? 2 + buffer[1] : 0;

test("real TCP and UDS HTTP/SSE/WebSocket transports preserve authentication and teardown", { timeout: 15_000 }, async (t) => {
  const directory = temporary(t);
  const passwordFile = join(directory, "password");
  fs.writeFileSync(passwordFile, `${password}\n`, { mode: 0o600 });
  const seen = [];
  const upstreamSockets = new Set();
  const closures = new Map();
  const arrivals = new Map();
  function observe(incoming) {
    seen.push({ ...incoming.headers, authorization: incoming.headers.authorization === authorization });
    return incoming.headers.authorization === authorization;
  }
  const upstream = http.createServer((incoming, response) => {
    if (!observe(incoming)) { response.writeHead(401); response.end(); return; }
    response.on("close", () => closures.get(incoming.url)?.());
    arrivals.get(incoming.url)?.();
    if (incoming.url === "/events") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
    } else if (incoming.url === "/hang") {
      incoming.resume();
    } else if (incoming.url === "/broken") {
      incoming.socket.destroy();
    } else if (incoming.url === "/partial") {
      response.writeHead(200, { "content-length": "100" });
      response.write("partial");
      setImmediate(() => response.destroy());
    } else {
      response.writeHead(incoming.url === "/echo" ? 201 : 200, {
        "content-type": "text/plain", connection: "close, x-private-hop", "x-private-hop": "discard", "x-retained": "yes",
      });
      if (incoming.url === "/echo") incoming.pipe(response);
      else response.end("web root");
    }
  });
  upstream.on("connection", (socket) => {
    upstreamSockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.on("close", () => upstreamSockets.delete(socket));
  });
  upstream.on("upgrade", (incoming, socket, head) => {
    if (!observe(incoming)) { socket.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"); return; }
    if (incoming.url === "/refuse") { socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\n\r\ndenied"); return; }
    const accept = createHash("sha1").update(`${incoming.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(Buffer.concat([Buffer.from(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade, x-private-hop\r\nX-Private-Hop: discard\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`), frame("hello")]));
    let pending = Buffer.alloc(0);
    const echo = (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 6 && pending.length >= 6 + (pending[1] & 127)) {
        const length = pending[1] & 127;
        const mask = pending.subarray(2, 6);
        const text = pending.subarray(6, 6 + length).map((byte, index) => byte ^ mask[index % 4]).toString();
        pending = pending.subarray(6 + length);
        if (text === "disconnect") { socket.destroy(); return; }
        socket.write(frame(text));
      }
    };
    socket.on("data", echo);
    socket.on("end", () => socket.end());
    socket.on("close", () => closures.get(incoming.url)?.());
    if (head.length) echo(head);
  });
  const upstreamAddress = await listen(upstream);
  const tcp = createProxyServer(readPassword(passwordFile), false, upstreamAddress.port);
  const gateway = createProxyServer(readPassword(passwordFile), true, upstreamAddress.port);
  t.after(async () => {
    await Promise.all([tcp.close(), gateway.close()]);
    for (const socket of upstreamSockets) socket.destroy();
    await new Promise((done) => upstream.close(done));
  });
  const tcpAddress = await listen(tcp.server);
  const socketPath = join(directory, "transport.sock");
  // Local transport evidence is independent of production UID/ACL provisioning, checked below in-image.
  await listen(gateway.server, socketPath);
  const tcpOptions = { host: "127.0.0.1", port: tcpAddress.port };
  for (const headers of [{}, { authorization: "Basic invalid" }, { authorization: `${authorization.slice(0, -1)}x` }, { "x-ingenium-authenticated-user": "local-gateway" }]) {
    assert.equal((await request(tcpOptions, "/", headers)).status, 401);
  }
  assert.equal(seen.length, 0, "unauthorized TCP must not contact upstream");

  for (const [name, options, credentials] of [
    ["TCP", tcpOptions, { authorization }],
    ["UDS", { socketPath }, { authorization: "Bearer hostile" }],
  ]) {
    await t.test(`${name}: Basic injection, hostile headers, Host/Origin, response and request bodies`, async () => {
      const result = await request(options, "/", {
        ...credentials, host: "hostile.invalid", origin,
        "proxy-authorization": "Basic hostile", connection: "close, x-private-hop, authorization, host",
        "x-private-hop": "discard", "x-forwarded-host": "hostile.invalid", "x-forwarded-user": "admin", forwarded: "for=attacker",
        "x-ingenium-authenticated-user": "admin", "x-client-identity": "admin", "x-auth-request-user": "admin", "x-original-url": "/evil",
        "x-retained": "yes", te: "trailers",
      });
      assert.equal(result.status, 200, "valid TCP or gateway UDS must reach the Basic-protected V2 upstream");
      assert.equal(result.body, "web root");
      assert.equal(result.headers["x-retained"], "yes");
      assert.equal(result.headers["x-private-hop"], undefined);
      const forwarded = seen.at(-1);
      assert.equal(forwarded.authorization, true);
      assert.equal(forwarded.host, name === "UDS" ? "opencode.localhost:3000" : "127.0.0.1:4098");
      assert.equal(forwarded.origin, origin);
      for (const key of ["proxy-authorization", "x-private-hop", "x-forwarded-host", "x-forwarded-user", "forwarded", "x-ingenium-authenticated-user", "x-client-identity", "x-auth-request-user", "x-original-url", "te", "trailer"]) assert.equal(forwarded[key], undefined, key);
      const posted = await request(options, "/echo", { ...credentials, trailer: "x-evil", "transfer-encoding": "chunked" }, "streamed request body");
      assert.equal(posted.status, 201);
      assert.equal(posted.body, "streamed request body");
      assert.equal(seen.at(-1).trailer, undefined);
      assert.equal((await request(options, "/broken", credentials)).status, 502);
      await assert.rejects(request(options, "/partial", credentials), /aborted/);
    });

    await t.test(`${name}: aborted request cancels an upstream without response headers`, async () => {
      const arrived = new Promise((done) => arrivals.set("/hang", done));
      const closed = new Promise((done) => closures.set("/hang", done));
      const outgoing = http.get({ ...options, path: "/hang", headers: credentials, agent: false });
      outgoing.on("error", () => {});
      await arrived;
      outgoing.destroy();
      await closed;
    });

    await t.test(`${name}: SSE streams before end and cancels upstream on disconnect`, async () => {
      const closed = new Promise((done) => closures.set("/events", done));
      const outgoing = http.get({ ...options, path: "/events", headers: credentials, agent: false });
      const [response] = await once(outgoing, "response");
      const [chunk] = await once(response, "data");
      assert.equal(chunk.toString(), "data: first\n\n");
      assert.equal(response.complete, false);
      response.destroy();
      outgoing.destroy();
      await closed;
    });

    await t.test(`${name}: WebSocket bidirectional frames, both upgrade heads, and disconnect cleanup`, async () => {
      const closed = new Promise((done) => closures.set("/ws", done));
      const socket = net.createConnection(name === 'UDS' ? { path: options.socketPath } : options);
      const read = reader(socket);
      t.after(() => socket.destroy());
      await once(socket, "connect");
      const lines = { Host: "hostile.invalid", Origin: origin, Connection: "Upgrade, x-private-hop", Upgrade: "websocket", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", "Sec-WebSocket-Version": "13", "X-Private-Hop": "discard", ...credentials };
      const handshake = `GET /ws HTTP/1.1\r\n${Object.entries(lines).map(([key, value]) => `${key}: ${value}\r\n`).join("")}\r\n`;
      socket.write(Buffer.concat([Buffer.from(handshake), frame("client head", true)]));
      const headers = (await read(headerLength)).toString();
      assert.match(headers, /^HTTP\/1.1 101 /);
      assert.match(headers, /sec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/i);
      assert.doesNotMatch(headers, /x-private-hop/i);
      assert.equal((await read(frameLength)).subarray(2).toString(), "hello");
      assert.equal((await read(frameLength)).subarray(2).toString(), "client head");
      socket.write(frame("round trip", true));
      assert.equal((await read(frameLength)).subarray(2).toString(), "round trip");
      if (name === "TCP") socket.destroy();
      else {
        const downstreamClosed = once(socket, "close");
        socket.write(frame("disconnect", true));
        await downstreamClosed;
      }
      await closed;
    });

    await t.test(`${name}: WebSocket rejection forwards HTTP status/body and closes`, async () => {
      const result = await request(options, "/refuse", { ...credentials, origin, connection: "Upgrade", upgrade: "websocket" });
      assert.equal(result.status, 403);
      assert.equal(result.body, "denied");
    });
  }
  assert.equal((await request(tcpOptions, "/", { connection: "Upgrade", upgrade: "websocket" })).status, 401);
  assert.equal((await request(tcpOptions, "/", { authorization, connection: "Upgrade", upgrade: "other" })).status, 400);
  assert.equal((await request({ socketPath })).status, 200, "browser gateway needs no caller credential");
  const before = seen.length;
  assert.equal((await request({ socketPath }, "/", { origin: "https://hostile.invalid" })).status, 403);
  assert.equal(seen.length, before, "hostile browser Origin must not gain upstream Basic authority");
  fs.chmodSync(directory, 0o710);
  assert.throws(() => readPassword(passwordFile));
  fs.chmodSync(directory, 0o700);
  fs.chmodSync(passwordFile, 0o640);
  assert.throws(() => readPassword(passwordFile));
});

test("guarded socket rejects symlinks, modes, foreign owner, live/kernel owner, and removes only owned stale inode", { skip: aclSkip, timeout: 10_000 }, async (t) => {
  const root = temporary(t);
  const directory = join(root, "gateway");
  fs.mkdirSync(directory);
  fs.chmodSync(directory, 0o2710);
  const uid = process.getuid();
  const gid = process.getgid();
  const path = join(directory, "http.sock");
  const untouched = join(root, "untouched");
  fs.writeFileSync(untouched, "do not unlink");
  fs.symlinkSync(untouched, path);
  await assert.rejects(removeVerifiedGatewaySocket(directory, uid, gid));
  assert.equal(fs.lstatSync(path).isSymbolicLink(), true);
  fs.unlinkSync(path);
  fs.writeFileSync(path, "foreign regular file");
  await assert.rejects(removeVerifiedGatewaySocket(directory, uid, gid));
  assert.equal(fs.readFileSync(path, "utf8"), "foreign regular file");
  fs.unlinkSync(path);
  const live = net.createServer((socket) => socket.destroy());
  await listen(live, path);
  t.after(() => live.close());
  fs.chmodSync(path, 0o620);
  const inode = fs.lstatSync(path).ino;
  await assert.rejects(removeVerifiedGatewaySocket(directory, uid, gid), /LIVE/);
  assert.equal(fs.lstatSync(path).ino, inode);
  fs.chmodSync(path, 0o600);
  await assert.rejects(removeVerifiedGatewaySocket(directory, uid, gid), /UNSAFE/);
  assert.equal(fs.lstatSync(path).ino, inode);
  await new Promise((done) => live.close(done));
  // Node's native pipe binding makes a real bound-but-not-listening kernel socket; no transport is mocked.
  const child = spawn(process.execPath, ["--input-type=module", "-e", `import fs from 'node:fs'; const {Pipe,constants}=process.binding('pipe_wrap'); const s=new Pipe(constants.SERVER); if(s.bind(${JSON.stringify(path)})!==0)process.exit(1); fs.chmodSync(${JSON.stringify(path)},0o620);process.send('ready');process.on('message',()=>{});`], { stdio: ["ignore", "ignore", "ignore", "ipc"], env: {} });
  t.after(() => child.kill("SIGKILL"));
  await once(child, "message");
  const kernelOwned = fs.lstatSync(path).ino;
  await assert.rejects(removeVerifiedGatewaySocket(directory, uid, gid), /UNSAFE/);
  assert.equal(fs.lstatSync(path).ino, kernelOwned);
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  if (uid === 0) {
    fs.chownSync(path, 1106, gid);
    await assert.rejects(removeVerifiedGatewaySocket(directory, uid, gid), /UNSAFE/);
    assert.ok(fs.lstatSync(path).isSocket());
    fs.chownSync(path, uid, gid);
  }
  await removeVerifiedGatewaySocket(directory, uid, gid);
  assert.equal(fs.existsSync(path), false);
  assert.equal(fs.readFileSync(untouched, "utf8"), "do not unlink");
  const proxy = createProxyServer(password, true);
  t.after(() => proxy.close());
  const mask = process.umask();
  try { await listenGateway(proxy.server, directory, uid, gid); } finally { process.umask(mask); }
  verifyGatewayPath(directory, uid, gid, true);
  assert.equal(fs.lstatSync(path).mode & 0o7777, 0o620);
  const alias = join(root, "alias");
  fs.symlinkSync(directory, alias);
  assert.throws(() => verifyGatewayPath(alias, uid, gid, true));
});

test("guarded directory and socket reject extended/default ACLs without unlink", { skip: aclSkip || (spawnSync("setfacl", ["--version"], { stdio: "ignore" }).status === 0 ? false : "setfacl unavailable"), timeout: 5_000 }, async (t) => {
  const directory = temporary(t);
  fs.chmodSync(directory, 0o2710);
  const uid = process.getuid();
  const gid = process.getgid();
  await promisify(execFile)("setfacl", ["-m", "d:u:1106:--x", directory]);
  assert.throws(() => verifyGatewayPath(directory, uid, gid));
  await promisify(execFile)("setfacl", ["-k", directory]);
  const proxy = createProxyServer(password, true);
  t.after(() => proxy.close());
  const mask = process.umask();
  try { await listenGateway(proxy.server, directory, uid, gid); } finally { process.umask(mask); }
  const path = join(directory, "http.sock");
  const inode = fs.lstatSync(path).ino;
  await promisify(execFile)("setfacl", ["-m", "u:1106:-w-", path]);
  assert.throws(() => verifyGatewayPath(directory, uid, gid, true));
  await assert.rejects(removeVerifiedGatewaySocket(directory, uid, gid));
  assert.equal(fs.lstatSync(path).ino, inode);
});

test("actual UID1104/GID1104 can connect; unrelated UID1106 cannot traverse or connect", { skip: aclSkip || (process.getuid() === 0 ? false : "requires admitted in-image root/UID isolation fixture"), timeout: 8_000 }, async (t) => {
  const directory = temporary(t);
  fs.chmodSync(directory, 0o755);
  const gateway = join(directory, "gateway");
  fs.mkdirSync(gateway);
  fs.chownSync(gateway, 1105, 1104);
  const groups = process.getgroups();
  process.setgroups([...new Set([...groups, 1104])]);
  try { fs.chmodSync(gateway, 0o2710); } finally { process.setgroups(groups); }
  assert.equal(fs.lstatSync(gateway).mode & 0o7777, 0o2710);
  const secretDirectory = join(directory, "private");
  fs.mkdirSync(secretDirectory, { mode: 0o700 });
  fs.chownSync(secretDirectory, 1105, 1105);
  const passwordFile = join(secretDirectory, "password");
  fs.writeFileSync(passwordFile, password, { mode: 0o600 });
  fs.chownSync(passwordFile, 1105, 1105);
  const upstream = http.createServer((incoming, response) => { response.writeHead(incoming.headers.authorization === authorization ? 200 : 401); response.end(); });
  const { port } = await listen(upstream);
  t.after(() => upstream.close());
  const source = new URL("../scripts/opencode-auth-proxy.mjs", import.meta.url).href;
  const child = spawn("setpriv", ["--reuid=1105", "--regid=1105", "--clear-groups", process.execPath, "--input-type=module", "-e", `if(process.getuid()!==1105||process.getgid()!==1105||process.getgroups().some(g=>g!==1105))throw Error('WRONG_IDENTITY'); const {createProxyServer,readPassword,listenGateway}=await import(${JSON.stringify(source)}); const proxy=createProxyServer(readPassword(${JSON.stringify(passwordFile)}),true,${port}); await listenGateway(proxy.server,${JSON.stringify(gateway)}); process.send('ready'); process.once('message',async()=>{await proxy.close();process.disconnect()});`], { env: { PATH: process.env.PATH }, stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let childError = "";
  child.stderr.on("data", (chunk) => { childError = (childError + chunk.toString()).slice(-4096); });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.send("close");
    await exited;
  });
  const [ready] = await Promise.race([
    once(child, "message"),
    once(child, "exit").then(([code, signal]) => { throw new Error(`gateway child exited ${code ?? signal}: ${childError}`); }),
    once(child, "error").then(([error]) => { throw new Error(`gateway child error: ${childError}`, { cause: error }); }),
  ]);
  assert.equal(ready, "ready");
  verifyGatewayPath(gateway, 1105, 1104, true);
  for (const uid of [1104, 1106]) {
    const program = `process.setgroups([]);process.setgid(${uid});process.setuid(${uid}); const fs=await import('node:fs');const http=await import('node:http');try{fs.accessSync(${JSON.stringify(gateway)},fs.constants.X_OK);console.log('traverse')}catch(e){console.log(e.code)} const r=http.get({socketPath:${JSON.stringify(join(gateway, "http.sock"))},path:'/'},s=>{console.log(s.statusCode);s.resume()});r.on('error',e=>console.log(e.code));`;
    const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", program], { env: {}, timeout: 2_000 });
    assert.equal(stdout.trim(), uid === 1104 ? "traverse\n200" : "EACCES\nEACCES");
  }
});
