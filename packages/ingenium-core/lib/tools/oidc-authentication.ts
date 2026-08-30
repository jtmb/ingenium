import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { AUTH_CHALLENGE_MS, decryptAuthSecret, encryptAuthSecret, hashSecurityToken } from "./authentication.js";
import { EndpointPolicyError, safeEndpointFetch } from "./endpoint-policy.js";
import { normalizeEmail } from "./identity.js";
import { appendSecurityAuditEvent } from "./security-audit.js";

const OIDC_REQUEST_TIMEOUT_MS = 5_000;
const OIDC_CALLBACK_BUDGET_MS = 15_000;
const OIDC_DOCUMENT_MAX_BYTES = 64 * 1024;
const OIDC_JWKS_MAX_BYTES = 256 * 1024;
const OIDC_TOKEN_REQUEST_MAX_BYTES = 16 * 1024;
const OIDC_JWKS_CACHE_MAX = 100;
const OIDC_JWKS_CACHE_MS = 10 * 60_000;
const OIDC_JWKS_COOLDOWN_MS = 30_000;
const JSON_CONTENT_TYPES = ["application/json", "application/*+json"] as const;

export type OidcErrorKind = "authentication" | "timeout" | "upstream";

export class OidcError extends Error {
  constructor(public readonly kind: OidcErrorKind, options?: ErrorOptions) {
    super(kind === "authentication" ? "OIDC authorization failed" : "OIDC provider request failed", options);
    this.name = "OidcError";
  }
}

export interface OidcLoopbackTestPolicy {
  readonly loopbackOrigin: string;
}

export interface OidcProvider {
  id: string;
  name: string;
  issuer: string;
  client_id: string;
  redirect_uri: string;
  signature_algorithm: "RS256" | "ES256";
  enabled: number;
}

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  code_challenge_methods_supported: string[];
}

interface JwksCacheEntry {
  readonly identity: string;
  readonly jwks: ReturnType<typeof createRemoteJWKSet>;
}

const callbackSignal = new AsyncLocalStorage<AbortSignal>();
const jwksCache = new Map<string, JwksCacheEntry>();

function validatedLoopbackOrigin(policy: OidcLoopbackTestPolicy | undefined): string | undefined {
  if (!policy) return undefined;
  let url: URL;
  try {
    url = new URL(policy.loopbackOrigin);
  } catch {
    throw new OidcError("authentication");
  }
  const port = Number(url.port);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port
    || !Number.isSafeInteger(port) || port <= 1_024 || port > 65_535
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || policy.loopbackOrigin !== url.origin) {
    throw new OidcError("authentication");
  }
  return url.origin;
}

function validateDnsName(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".") || isIP(hostname)) return false;
  const labels = hostname.split(".");
  return labels.length >= 2 && labels.every((label) => label.length >= 1 && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

function assertOidcUrl(
  value: string,
  testPolicy?: OidcLoopbackTestPolicy,
): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OidcError("upstream");
  }
  if (url.username || url.password || url.hash || url.hostname.endsWith(".")) throw new OidcError("upstream");
  const loopbackOrigin = validatedLoopbackOrigin(testPolicy);
  if (loopbackOrigin && url.origin === loopbackOrigin && url.protocol === "http:" && url.hostname === "127.0.0.1") return url;
  if (url.protocol !== "https:" || !validateDnsName(url.hostname)) throw new OidcError("upstream");
  const port = url.port ? Number(url.port) : 443;
  if (port !== 443) throw new OidcError("upstream");
  return url;
}

function exactIssuer(value: string, testPolicy?: OidcLoopbackTestPolicy): string {
  const url = assertOidcUrl(value, testPolicy);
  if (value.endsWith("/") || url.search || url.hash || value !== url.toString().replace(/\/$/, "")) {
    throw new OidcError("authentication");
  }
  return value;
}

function transportPolicy(
  url: URL,
  maxResponseBodyBytes: number,
  testPolicy?: OidcLoopbackTestPolicy,
) {
  const loopback = validatedLoopbackOrigin(testPolicy) === url.origin;
  return {
    allowPrivateNetwork: loopback,
    allowedPorts: loopback ? [Number(url.port)] : [443],
    allowedProtocols: loopback ? ["http:" as const] : ["https:" as const],
    allowedRequestContentTypes: ["application/x-www-form-urlencoded"],
    allowedResponseContentTypes: JSON_CONTENT_TYPES,
    maxRedirects: 0,
    maxRequestBodyBytes: OIDC_TOKEN_REQUEST_MAX_BYTES,
    maxResponseBodyBytes,
    rejectEncodedResponses: true,
    rejectFragments: true,
    rejectIpLiterals: !loopback,
    rejectTrailingDot: true,
    requireDnsHostname: !loopback,
    timeoutMs: OIDC_REQUEST_TIMEOUT_MS,
  };
}

function mapTransportError(error: unknown): OidcError {
  if (error instanceof OidcError) return error;
  if (error instanceof EndpointPolicyError && (error.code === "timeout" || error.code === "aborted")) {
    return new OidcError("timeout", { cause: error });
  }
  return new OidcError("upstream", error instanceof Error ? { cause: error } : undefined);
}

async function oidcFetch(
  urlValue: string,
  init: RequestInit,
  maxResponseBodyBytes: number,
  testPolicy?: OidcLoopbackTestPolicy,
): Promise<Response> {
  const url = assertOidcUrl(urlValue, testPolicy);
  const headers = new Headers(init.headers);
  headers.set("accept", "application/json");
  headers.set("accept-encoding", "identity");
  if (init.body != null && headers.get("content-type")?.toLowerCase() !== "application/x-www-form-urlencoded") {
    throw new OidcError("upstream");
  }
  const outerSignal = callbackSignal.getStore();
  const signal = outerSignal && init.signal ? AbortSignal.any([outerSignal, init.signal]) : outerSignal ?? init.signal;
  try {
    return await safeEndpointFetch(url.toString(), { ...init, headers, redirect: "manual", signal }, transportPolicy(url, maxResponseBodyBytes, testPolicy));
  } catch (error) {
    throw mapTransportError(error);
  }
}

async function fetchJson(
  url: string,
  init: RequestInit,
  testPolicy?: OidcLoopbackTestPolicy,
): Promise<Record<string, unknown>> {
  const response = await oidcFetch(url, init, OIDC_DOCUMENT_MAX_BYTES, testPolicy);
  if (!response.ok) throw new OidcError("upstream");
  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch (error) {
    throw new OidcError("upstream", { cause: error });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new OidcError("upstream");
  return body as Record<string, unknown>;
}

function stringField(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 2_048) throw new OidcError("upstream");
  return value;
}

async function discover(provider: OidcProvider, testPolicy?: OidcLoopbackTestPolicy): Promise<OidcDiscovery> {
  const body = await fetchJson(`${provider.issuer}/.well-known/openid-configuration`, {}, testPolicy);
  const discovery: OidcDiscovery = {
    issuer: stringField(body, "issuer"),
    authorization_endpoint: stringField(body, "authorization_endpoint"),
    token_endpoint: stringField(body, "token_endpoint"),
    jwks_uri: stringField(body, "jwks_uri"),
    code_challenge_methods_supported: Array.isArray(body.code_challenge_methods_supported)
      && body.code_challenge_methods_supported.every((value) => typeof value === "string")
      ? body.code_challenge_methods_supported as string[]
      : [],
  };
  if (discovery.issuer !== provider.issuer || !discovery.code_challenge_methods_supported.includes("S256")) {
    throw new OidcError("upstream");
  }
  assertOidcUrl(discovery.authorization_endpoint, testPolicy);
  assertOidcUrl(discovery.token_endpoint, testPolicy);
  assertOidcUrl(discovery.jwks_uri, testPolicy);
  return discovery;
}

function remoteJwks(provider: OidcProvider, discovery: OidcDiscovery, testPolicy?: OidcLoopbackTestPolicy) {
  const identity = `${provider.id}\u0000${provider.issuer}\u0000${discovery.jwks_uri}\u0000${provider.signature_algorithm}`;
  const current = jwksCache.get(provider.id);
  if (current?.identity === identity) {
    jwksCache.delete(provider.id);
    jwksCache.set(provider.id, current);
    return current.jwks;
  }
  if (current) jwksCache.delete(provider.id);
  while (jwksCache.size >= OIDC_JWKS_CACHE_MAX) jwksCache.delete(jwksCache.keys().next().value!);
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri), {
    [customFetch]: (url, init) => oidcFetch(url.toString(), init ?? {}, OIDC_JWKS_MAX_BYTES, testPolicy),
    cacheMaxAge: OIDC_JWKS_CACHE_MS,
    cooldownDuration: OIDC_JWKS_COOLDOWN_MS,
    timeoutDuration: OIDC_REQUEST_TIMEOUT_MS,
  });
  jwksCache.set(provider.id, { identity, jwks });
  return jwks;
}

function auditOidc(outcome: "success" | "failure", actorId?: string): void {
  appendSecurityAuditEvent({ actorType: actorId ? "user" : "system", actorId, action: "auth.oidc.callback", outcome });
}

function jwtFailure(error: unknown): OidcError {
  if (error instanceof OidcError) return error;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (code.startsWith("ERR_JWKS_")) return new OidcError("upstream", error instanceof Error ? { cause: error } : undefined);
  return new OidcError("authentication", error instanceof Error ? { cause: error } : undefined);
}

export function clearOidcTransportCachesForTest(): void {
  jwksCache.clear();
}

export function oidcTransportCacheSizeForTest(): number {
  return jwksCache.size;
}

export function configureOidcProvider(input: {
  name: string;
  issuer: string;
  clientId: string;
  redirectUri: string;
  signatureAlgorithm?: "RS256" | "ES256";
}, testPolicy?: OidcLoopbackTestPolicy): OidcProvider {
  const issuer = exactIssuer(input.issuer, testPolicy);
  assertOidcUrl(input.redirectUri, testPolicy);
  if (!input.name.trim() || !input.clientId || input.clientId.length > 512) throw new OidcError("authentication");
  const provider = execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const id = randomUUID();
    const now = new Date().toISOString();
    database.prepare(
      `INSERT INTO oidc_providers (id, name, issuer, client_id, redirect_uri, signature_algorithm, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, input.name.trim(), issuer, input.clientId, input.redirectUri, input.signatureAlgorithm ?? "RS256", now, now);
    return database.prepare("SELECT * FROM oidc_providers WHERE id = ?").get(id) as OidcProvider;
  });
  checkpointAfterWrite();
  return provider;
}

export function listOidcProviders(): OidcProvider[] {
  return getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT id, name, issuer, client_id, redirect_uri, signature_algorithm, enabled FROM oidc_providers ORDER BY name LIMIT 100",
  ).all() as OidcProvider[];
}

export function linkOidcIdentity(userId: string, issuer: string, subject: string, testPolicy?: OidcLoopbackTestPolicy): void {
  if (!subject || subject.length > 512) throw new OidcError("authentication");
  execTransaction(() => {
    const now = new Date().toISOString();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "INSERT INTO auth_identities (id, user_id, provider, issuer, subject, created_at, updated_at) VALUES (?, ?, 'oidc', ?, ?, ?, ?)",
    ).run(randomUUID(), userId, exactIssuer(issuer, testPolicy), subject, now, now);
  });
  checkpointAfterWrite();
}

export async function beginOidcAuthorization(
  providerId: string,
  testPolicy?: OidcLoopbackTestPolicy,
): Promise<{ authorizationUrl: string; state: string; transactionToken: string }> {
  const provider = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT * FROM oidc_providers WHERE id = ? AND enabled = 1",
  ).get(providerId) as OidcProvider | undefined;
  if (!provider) throw new OidcError("authentication");
  const discovery = await discover(provider, testPolicy);
  const state = randomBytes(32).toString("base64url");
  const transactionToken = randomBytes(32).toString("base64url");
  const nonce = randomBytes(32).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `INSERT INTO oidc_authorization_states
     (id, provider_id, state_hash, transaction_hash, nonce_hash, encrypted_pkce_verifier, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), provider.id, hashSecurityToken(state), hashSecurityToken(transactionToken), hashSecurityToken(nonce), encryptAuthSecret(verifier),
    new Date(Date.now() + AUTH_CHALLENGE_MS).toISOString(), new Date().toISOString()));
  checkpointAfterWrite();
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", provider.client_id);
  url.searchParams.set("redirect_uri", provider.redirect_uri);
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return { authorizationUrl: url.toString(), state, transactionToken };
}

export function resolveOidcTransactionProviderId(state: string, transactionToken: string, now = new Date()): string | undefined {
  try {
    return (getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      `SELECT oidc_authorization_states.provider_id AS providerId
       FROM oidc_authorization_states JOIN oidc_providers ON oidc_providers.id = oidc_authorization_states.provider_id
       WHERE oidc_authorization_states.state_hash = ? AND oidc_authorization_states.transaction_hash = ?
         AND oidc_authorization_states.consumed_at IS NULL AND oidc_authorization_states.expires_at > ?
         AND oidc_providers.enabled = 1`,
    ).get(hashSecurityToken(state), hashSecurityToken(transactionToken), now.toISOString()) as { providerId: string } | undefined)?.providerId;
  } catch {
    return undefined;
  }
}

export async function completeOidcAuthorization(
  state: string,
  code: string,
  transactionToken: string,
  now = new Date(),
  testPolicy?: OidcLoopbackTestPolicy,
): Promise<string> {
  let stateHash: string;
  let transactionHash: string;
  try {
    stateHash = hashSecurityToken(state);
    transactionHash = hashSecurityToken(transactionToken);
  } catch {
    throw new OidcError("authentication");
  }
  const record = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT oidc_authorization_states.id AS state_id, oidc_authorization_states.nonce_hash,
            oidc_authorization_states.encrypted_pkce_verifier, oidc_providers.*
     FROM oidc_authorization_states JOIN oidc_providers ON oidc_providers.id = oidc_authorization_states.provider_id
      WHERE oidc_authorization_states.state_hash = ? AND oidc_authorization_states.transaction_hash = ?
        AND oidc_authorization_states.consumed_at IS NULL
        AND oidc_authorization_states.expires_at > ? AND oidc_providers.enabled = 1`,
  ).get(stateHash, transactionHash, now.toISOString()) as (OidcProvider & { state_id: string; nonce_hash: string; encrypted_pkce_verifier: string }) | undefined;
  if (!record || !code || code.length > 2_048) throw new OidcError("authentication");
  const budgetSignal = AbortSignal.timeout(OIDC_CALLBACK_BUDGET_MS);
  try {
    const userId = await callbackSignal.run(budgetSignal, async () => {
      const discovery = await discover(record, testPolicy);
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: record.client_id,
        redirect_uri: record.redirect_uri,
        code_verifier: decryptAuthSecret(record.encrypted_pkce_verifier),
      });
      const tokenResponse = await fetchJson(discovery.token_endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: tokenBody,
      }, testPolicy);
      if (typeof tokenResponse.id_token !== "string" || tokenResponse.id_token.length > OIDC_DOCUMENT_MAX_BYTES) {
        throw new OidcError("authentication");
      }
      let verified;
      try {
        verified = await jwtVerify(tokenResponse.id_token, remoteJwks(record, discovery, testPolicy), {
          issuer: record.issuer,
          audience: record.client_id,
          algorithms: [record.signature_algorithm],
          clockTolerance: 5,
          currentDate: now,
          maxTokenAge: "10 minutes",
        });
      } catch (error) {
        throw jwtFailure(error);
      }
      const payload = verified.payload;
      if (typeof payload.sub !== "string" || typeof payload.nonce !== "string"
        || hashSecurityToken(payload.nonce) !== record.nonce_hash
        || payload.email_verified !== true || typeof payload.email !== "string") {
        throw new OidcError("authentication");
      }
      if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== record.client_id) {
        throw new OidcError("authentication");
      }
      normalizeEmail(payload.email);
      const resolvedUserId = execTransaction(() => {
        const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
        const identity = database.prepare(
          `SELECT users.id FROM auth_identities JOIN users ON users.id = auth_identities.user_id
           WHERE auth_identities.issuer = ? AND auth_identities.subject = ? AND users.status = 'active'`,
        ).get(record.issuer, payload.sub) as { id: string } | undefined;
        if (!identity) throw new OidcError("authentication");
        if (database.prepare("UPDATE oidc_authorization_states SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
          .run(now.toISOString(), record.state_id).changes !== 1) throw new OidcError("authentication");
        return identity.id;
      });
      checkpointAfterWrite();
      return resolvedUserId;
    });
    auditOidc("success", userId);
    return userId;
  } catch (error) {
    auditOidc("failure");
    if (budgetSignal.aborted) throw new OidcError("timeout", error instanceof Error ? { cause: error } : undefined);
    throw error instanceof OidcError ? error : new OidcError("authentication", error instanceof Error ? { cause: error } : undefined);
  }
}
