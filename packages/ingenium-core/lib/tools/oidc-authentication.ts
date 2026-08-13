import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { AUTH_CHALLENGE_MS, decryptAuthSecret, encryptAuthSecret, hashSecurityToken } from "./authentication.js";
import { normalizeEmail } from "./identity.js";

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
  code_challenge_methods_supported?: string[];
}

function isAllowedOidcUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return process.env.NODE_ENV === "test" && url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

function exactIssuer(value: string): string {
  if (!isAllowedOidcUrl(value) || value.endsWith("/")) throw new Error("Invalid OIDC issuer");
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) throw new Error("Invalid OIDC issuer");
  return value;
}

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  if (!isAllowedOidcUrl(url)) throw new Error("OIDC endpoint policy rejected the request");
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("OIDC provider request failed");
  const body = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("OIDC provider returned an invalid response");
  return body as Record<string, unknown>;
}

async function discover(provider: OidcProvider): Promise<OidcDiscovery> {
  const body = await fetchJson(`${provider.issuer}/.well-known/openid-configuration`);
  const discovery = body as unknown as OidcDiscovery;
  if (discovery.issuer !== provider.issuer
    || !isAllowedOidcUrl(discovery.authorization_endpoint)
    || !isAllowedOidcUrl(discovery.token_endpoint)
    || !isAllowedOidcUrl(discovery.jwks_uri)
    || !discovery.code_challenge_methods_supported?.includes("S256")) {
    throw new Error("OIDC discovery validation failed");
  }
  return discovery;
}

export function configureOidcProvider(input: {
  name: string;
  issuer: string;
  clientId: string;
  redirectUri: string;
  signatureAlgorithm?: "RS256" | "ES256";
}): OidcProvider {
  const issuer = exactIssuer(input.issuer);
  if (!isAllowedOidcUrl(input.redirectUri) || !input.clientId || input.clientId.length > 512) throw new Error("Invalid OIDC provider");
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

export function linkOidcIdentity(userId: string, issuer: string, subject: string): void {
  if (!subject || subject.length > 512) throw new Error("Invalid OIDC subject");
  execTransaction(() => {
    const now = new Date().toISOString();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "INSERT INTO auth_identities (id, user_id, provider, issuer, subject, created_at, updated_at) VALUES (?, ?, 'oidc', ?, ?, ?, ?)",
    ).run(randomUUID(), userId, exactIssuer(issuer), subject, now, now);
  });
  checkpointAfterWrite();
}

export async function beginOidcAuthorization(providerId: string): Promise<{ authorizationUrl: string; state: string; transactionToken: string }> {
  const provider = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT * FROM oidc_providers WHERE id = ? AND enabled = 1",
  ).get(providerId) as OidcProvider | undefined;
  if (!provider) throw new Error("OIDC provider is unavailable");
  const discovery = await discover(provider);
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

export async function completeOidcAuthorization(state: string, code: string, transactionToken: string, now = new Date()): Promise<string> {
  let stateHash: string;
  let transactionHash: string;
  try {
    stateHash = hashSecurityToken(state);
    transactionHash = hashSecurityToken(transactionToken);
  } catch {
    throw new Error("OIDC authorization failed");
  }
  const record = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT oidc_authorization_states.id AS state_id, oidc_authorization_states.nonce_hash,
            oidc_authorization_states.encrypted_pkce_verifier, oidc_providers.*
     FROM oidc_authorization_states JOIN oidc_providers ON oidc_providers.id = oidc_authorization_states.provider_id
      WHERE oidc_authorization_states.state_hash = ? AND oidc_authorization_states.transaction_hash = ?
        AND oidc_authorization_states.consumed_at IS NULL
        AND oidc_authorization_states.expires_at > ? AND oidc_providers.enabled = 1`,
  ).get(stateHash, transactionHash, now.toISOString()) as (OidcProvider & { state_id: string; nonce_hash: string; encrypted_pkce_verifier: string }) | undefined;
  if (!record || !code || code.length > 2048) throw new Error("OIDC authorization failed");
  const discovery = await discover(record);
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
  });
  if (typeof tokenResponse.id_token !== "string") throw new Error("OIDC authorization failed");
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
  const verified = await jwtVerify(tokenResponse.id_token, jwks, {
    issuer: record.issuer,
    audience: record.client_id,
    algorithms: [record.signature_algorithm],
    clockTolerance: 5,
    currentDate: now,
    maxTokenAge: "10 minutes",
  });
  const payload = verified.payload;
  if (typeof payload.sub !== "string" || typeof payload.nonce !== "string"
    || hashSecurityToken(payload.nonce) !== record.nonce_hash
    || payload.email_verified !== true || typeof payload.email !== "string") {
    throw new Error("OIDC authorization failed");
  }
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== record.client_id) throw new Error("OIDC authorization failed");
  normalizeEmail(payload.email);
  const userId = execTransaction(() => {
    const database = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const identity = database.prepare(
      `SELECT users.id FROM auth_identities JOIN users ON users.id = auth_identities.user_id
       WHERE auth_identities.issuer = ? AND auth_identities.subject = ? AND users.status = 'active'`,
    ).get(record.issuer, payload.sub) as { id: string } | undefined;
    if (!identity) throw new Error("OIDC authorization failed");
    if (database.prepare("UPDATE oidc_authorization_states SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL")
      .run(now.toISOString(), record.state_id).changes !== 1) throw new Error("OIDC authorization failed");
    return identity.id;
  });
  checkpointAfterWrite();
  return userId;
}
