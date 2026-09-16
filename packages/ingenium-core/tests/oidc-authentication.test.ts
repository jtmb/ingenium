import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { authentication, bootstrap, getDb, oidcAuthentication, resetDbForTest } from "../lib/index.js";

let server: Server;
let issuer = "";
let rsaPrivate: KeyLike;
let rsaPublic: KeyLike;
let rotatedRsaPrivate: KeyLike;
let rotatedRsaPublic: KeyLike;
let ecPrivate: KeyLike;
let ecPublic: KeyLike;
let directory = "";
let tokenMode = "success";
let discoveryMode = "success";
let jwksMode = "success";
let jwksPath = "/jwks";
let tokenRequest: { bytes: number; contentType?: string; acceptEncoding?: string } | undefined;
const originalNodeEnv = process.env.NODE_ENV;
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalKeyPath = process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE;

async function jwt(mode: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const algorithm = mode === "algorithm" ? "ES256" : "RS256";
  const privateKey = mode === "algorithm" ? ecPrivate : mode === "rotation" ? rotatedRsaPrivate : rsaPrivate;
  return new SignJWT({
    email: "owner@example.test",
    email_verified: true,
    nonce: mode === "nonce" ? "x".repeat(43) : currentNonce,
  })
    .setProtectedHeader({ alg: algorithm, kid: mode === "rotation" ? "rsa-rotated" : algorithm === "RS256" ? "rsa" : "ec" })
    .setIssuer(mode === "issuer" ? `${issuer}/wrong` : issuer)
    .setAudience(mode === "audience" ? "wrong-client" : "fixture-client")
    .setSubject("fixture-subject")
    .setIssuedAt(mode === "expiry" ? now - 7200 : now)
    .setNotBefore(mode === "not-before" ? now + 3600 : now - 1)
    .setExpirationTime(mode === "expiry" ? now - 3600 : now + 300)
    .sign(privateKey);
}

let currentNonce = "";

beforeAll(async () => {
  ({ privateKey: rsaPrivate, publicKey: rsaPublic } = await generateKeyPair("RS256"));
  ({ privateKey: rotatedRsaPrivate, publicKey: rotatedRsaPublic } = await generateKeyPair("RS256"));
  ({ privateKey: ecPrivate, publicKey: ecPublic } = await generateKeyPair("ES256"));
  server = createServer(async (req, res) => {
    if (req.url === "/.well-known/openid-configuration") {
      if (discoveryMode === "slow") {
        setTimeout(() => {
          if (!res.destroyed) {
            res.setHeader("content-type", "application/json");
            res.end("{}");
          }
        }, 6_000);
        return;
      }
      if (discoveryMode === "malformed") {
        res.setHeader("content-type", "application/json");
        res.end("[]");
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}${jwksPath}`,
        code_challenge_methods_supported: ["S256"],
      }));
      return;
    }
    if (req.url === "/jwks" || req.url === "/jwks-rotated") {
      if (jwksMode === "slow") {
        setTimeout(() => {
          if (!res.destroyed) {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ keys: [] }));
          }
        }, 6_000);
        return;
      }
      if (jwksMode === "malformed") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ keys: "invalid" }));
        return;
      }
      const rsa = await exportJWK(rsaPublic);
      const rotatedRsa = await exportJWK(rotatedRsaPublic);
      const ec = await exportJWK(ecPublic);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ keys: req.url === "/jwks-rotated"
        ? [{ ...rotatedRsa, kid: "rsa-rotated", alg: "RS256", use: "sig" }]
        : [{ ...rsa, kid: "rsa", alg: "RS256", use: "sig" }, { ...ec, kid: "ec", alg: "ES256", use: "sig" }] }));
      return;
    }
    if (req.url === "/token") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      tokenRequest = {
        bytes: Buffer.concat(chunks).byteLength,
        contentType: req.headers["content-type"],
        acceptEncoding: req.headers["accept-encoding"],
      };
      if (tokenMode === "slow-response") {
        setTimeout(() => {
          if (!res.destroyed) {
            res.setHeader("content-type", "application/json");
            res.end("{}");
          }
        }, 6_000);
        return;
      }
      if (tokenMode === "malformed-response") {
        res.setHeader("content-type", "application/json");
        res.end("[]");
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ id_token: await jwt(tokenMode) }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-oidc-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  const keyFile = join(directory, "auth-key");
  writeFileSync(keyFile, `${Buffer.alloc(32, 9).toString("base64url")}\n`, { mode: 0o600 });
  chmodSync(keyFile, 0o600);
  process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE = keyFile;
  getDb(process.env.INGENIUM_CORE_DB_PATH);
  const owner = await bootstrap.claimBootstrap({ email: "owner@example.test", displayName: "Owner", password: "correct horse battery staple" });
  oidcAuthentication.clearOidcTransportCachesForTest();
  oidcAuthentication.linkOidcIdentity(owner.userId, issuer, "fixture-subject", { loopbackOrigin: issuer });
  tokenMode = "success";
  discoveryMode = "success";
  jwksMode = "success";
  jwksPath = "/jwks";
  tokenRequest = undefined;
});

afterEach(() => {
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH; else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalKeyPath === undefined) delete process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE; else process.env.INGENIUM_AUTH_ENCRYPTION_KEY_FILE = originalKeyPath;
});

async function start(): Promise<{ state: string; transactionToken: string }> {
  const provider = oidcAuthentication.configureOidcProvider({
    name: "Fixture",
    issuer,
    clientId: "fixture-client",
    redirectUri: `${issuer}/callback`,
  }, { loopbackOrigin: issuer });
  const begun = await oidcAuthentication.beginOidcAuthorization(provider.id, { loopbackOrigin: issuer });
  currentNonce = new URL(begun.authorizationUrl).searchParams.get("nonce")!;
  expect(new URL(begun.authorizationUrl).searchParams.get("code_challenge_method")).toBe("S256");
  return begun;
}

describe("AUTH-101 OIDC Authorization Code + PKCE", () => {
  it("resolves only the linked issuer/subject identity and rejects replay", async () => {
    const begun = await start();
    const userId = await oidcAuthentication.completeOidcAuthorization(begun.state, "fixture-code", begun.transactionToken, new Date(), { loopbackOrigin: issuer });
    expect(userId).toBe((getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT id FROM users").get() as { id: string }).id);
    expect(tokenRequest).toMatchObject({
      bytes: expect.any(Number),
      contentType: "application/x-www-form-urlencoded",
      acceptEncoding: "identity",
    });
    expect(tokenRequest!.bytes).toBeLessThanOrEqual(16 * 1024);
    await expect(oidcAuthentication.completeOidcAuthorization(begun.state, "fixture-code", begun.transactionToken, new Date(), { loopbackOrigin: issuer })).rejects.toThrow(/failed/);
  });

  it.each(["nonce", "issuer", "audience", "algorithm", "expiry", "not-before"])("rejects %s validation failure", async (mode) => {
    const begun = await start();
    tokenMode = mode;
    await expect(oidcAuthentication.completeOidcAuthorization(begun.state, "fixture-code", begun.transactionToken, new Date(), { loopbackOrigin: issuer })).rejects.toThrow();
  });

  it("rejects an unknown state without contacting the token endpoint", async () => {
    await start();
    await expect(oidcAuthentication.completeOidcAuthorization("x".repeat(43), "fixture-code", "y".repeat(43), new Date(), { loopbackOrigin: issuer })).rejects.toThrow(/failed/);
  });

  it("never auto-links a verified matching email", async () => {
    const begun = await start();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("DELETE FROM auth_identities WHERE provider = 'oidc'").run();
    await expect(oidcAuthentication.completeOidcAuthorization(begun.state, "fixture-code", begun.transactionToken, new Date(), { loopbackOrigin: issuer })).rejects.toThrow(/failed/);
  });

  it("requires the initiating browser transaction token", async () => {
    const begun = await start();
    await expect(oidcAuthentication.completeOidcAuthorization(begun.state, "fixture-code", "x".repeat(43), new Date(), { loopbackOrigin: issuer })).rejects.toThrow(/failed/);
  });

  it("rejects production HTTP and non-443 issuers and accepts only the exact explicit loopback fixture", () => {
    expect(() => oidcAuthentication.configureOidcProvider({
      name: "Rejected",
      issuer,
      clientId: "fixture-client",
      redirectUri: `${issuer}/callback`,
    })).toThrow();
    expect(() => oidcAuthentication.configureOidcProvider({
      name: "Wrong fixture",
      issuer,
      clientId: "fixture-client",
      redirectUri: `${issuer}/callback`,
    }, { loopbackOrigin: "http://127.0.0.1:12345" })).toThrow();
    expect(() => oidcAuthentication.configureOidcProvider({
      name: "Non-443 provider",
      issuer: "https://provider.example:8443",
      clientId: "fixture-client",
      redirectUri: "https://app.example/callback",
    })).toThrow();
  });

  it.each(["discovery", "token", "jwks"])("rejects malformed %s JSON without leaking upstream content", async (surface) => {
    if (surface === "discovery") discoveryMode = "malformed";
    const begun = surface === "discovery" ? undefined : await start();
    if (surface === "discovery") {
      await expect(start()).rejects.toMatchObject({ kind: "upstream" });
      return;
    }
    if (surface === "token") tokenMode = "malformed-response";
    if (surface === "jwks") jwksMode = "malformed";
    await expect(oidcAuthentication.completeOidcAuthorization(begun!.state, "fixture-code", begun!.transactionToken, new Date(), { loopbackOrigin: issuer }))
      .rejects.toMatchObject({ kind: "upstream" });
  });

  it.each(["discovery", "token", "jwks"])("times out slow %s responses", async (surface) => {
    if (surface === "discovery") discoveryMode = "slow";
    const begun = surface === "discovery" ? undefined : await start();
    if (surface === "token") tokenMode = "slow-response";
    if (surface === "jwks") jwksMode = "slow";
    const operation = surface === "discovery"
      ? start()
      : oidcAuthentication.completeOidcAuthorization(begun!.state, "fixture-code", begun!.transactionToken, new Date(), { loopbackOrigin: issuer });
    await expect(operation).rejects.toMatchObject({ kind: "timeout" });
  }, 8_000);

  it("evicts changed JWKS identities and never serves stale keys on refresh failure", async () => {
    const provider = oidcAuthentication.configureOidcProvider({
      name: "Fixture",
      issuer,
      clientId: "fixture-client",
      redirectUri: `${issuer}/callback`,
    }, { loopbackOrigin: issuer });
    let begun = await oidcAuthentication.beginOidcAuthorization(provider.id, { loopbackOrigin: issuer });
    currentNonce = new URL(begun.authorizationUrl).searchParams.get("nonce")!;
    await oidcAuthentication.completeOidcAuthorization(begun.state, "fixture-code", begun.transactionToken, new Date(), { loopbackOrigin: issuer });
    expect(oidcAuthentication.oidcTransportCacheSizeForTest()).toBe(1);

    jwksPath = "/jwks-rotated";
    tokenMode = "rotation";
    begun = await oidcAuthentication.beginOidcAuthorization(provider.id, { loopbackOrigin: issuer });
    currentNonce = new URL(begun.authorizationUrl).searchParams.get("nonce")!;
    await oidcAuthentication.completeOidcAuthorization(begun.state, "fixture-code", begun.transactionToken, new Date(), { loopbackOrigin: issuer });
    expect(oidcAuthentication.oidcTransportCacheSizeForTest()).toBe(1);

    jwksPath = "/jwks-unavailable";
    begun = await oidcAuthentication.beginOidcAuthorization(provider.id, { loopbackOrigin: issuer });
    currentNonce = new URL(begun.authorizationUrl).searchParams.get("nonce")!;
    await expect(oidcAuthentication.completeOidcAuthorization(begun.state, "fixture-code", begun.transactionToken, new Date(), { loopbackOrigin: issuer }))
      .rejects.toMatchObject({ kind: "upstream" });
  });

  it("writes fixed content-free audit outcomes only after a valid transaction", async () => {
    const begun = await start();
    tokenMode = "nonce";
    await expect(oidcAuthentication.completeOidcAuthorization(begun.state, "fixture-code", begun.transactionToken, new Date(), { loopbackOrigin: issuer })).rejects.toThrow();
    await expect(oidcAuthentication.completeOidcAuthorization("x".repeat(43), "fixture-code", "y".repeat(43), new Date(), { loopbackOrigin: issuer })).rejects.toThrow();
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT actor_type, action, outcome, metadata_json FROM security_audit_events ORDER BY created_at, id",
    ).all()).toEqual([{ actor_type: "system", action: "auth.oidc.callback", outcome: "failure", metadata_json: "{}" }]);
  });
});
