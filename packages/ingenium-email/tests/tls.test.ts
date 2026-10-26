import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { connect, createServer, type Server } from "node:tls";
import { mailTlsOptions } from "../lib/tls.js";

let dir: string;
let server: Server;
let port: number;
const previous = process.env.INGENIUM_EMAIL_CA_FILE;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ingenium-mail-ca-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost", "-keyout", join(dir, "key.pem"), "-out", join(dir, "ca.pem")], { stdio: "ignore" });
  server = createServer({ key: readFileSync(join(dir, "key.pem")), cert: readFileSync(join(dir, "ca.pem")) }, socket => socket.end());
  server.on("tlsClientError", () => {});
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});
afterEach(() => { if (previous === undefined) delete process.env.INGENIUM_EMAIL_CA_FILE; else process.env.INGENIUM_EMAIL_CA_FILE = previous; });
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); rmSync(dir, { recursive: true }); });
function handshake(servername = "localhost") {
  return new Promise<void>((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port, servername, ...mailTlsOptions() }, () => { socket.destroy(); resolve(); });
    socket.once("error", error => { socket.destroy(); reject(error); });
  });
}
describe("private mail certificate trust", () => {
  it("keeps the default trust store when not configured and rejects a private certificate", async () => {
    delete process.env.INGENIUM_EMAIL_CA_FILE;
    expect(mailTlsOptions()).toBeUndefined();
    await expect(handshake()).rejects.toHaveProperty("code", "DEPTH_ZERO_SELF_SIGNED_CERT");
  });
  it("accepts the configured certificate with a real TLS handshake", async () => {
    process.env.INGENIUM_EMAIL_CA_FILE = join(dir, "ca.pem");
    await expect(handshake()).resolves.toBeUndefined();
  });
  it("still rejects a certificate for a different hostname", async () => {
    process.env.INGENIUM_EMAIL_CA_FILE = join(dir, "ca.pem");
    await expect(handshake("other.invalid")).rejects.toHaveProperty("code", "ERR_TLS_CERT_ALTNAME_INVALID");
  });
  it("fails closed for a missing configured bundle", () => {
    process.env.INGENIUM_EMAIL_CA_FILE = join(dir, "missing.pem");
    expect(() => mailTlsOptions()).toThrow();
  });
  it("fails closed for malformed or oversized bundles", () => {
    const path = join(dir, "bad.pem"); process.env.INGENIUM_EMAIL_CA_FILE = path;
    writeFileSync(path, "not a certificate"); expect(() => mailTlsOptions()).toThrow("Invalid mail CA bundle");
    writeFileSync(path, "-----BEGIN CERTIFICATE-----" + "x".repeat(1_048_576)); expect(() => mailTlsOptions()).toThrow("Invalid mail CA bundle");
  });
});
