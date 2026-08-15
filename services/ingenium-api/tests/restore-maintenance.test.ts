import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, linkSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import {
  closeDbForMaintenance,
  getDb,
  resetDbForTest,
  validateRestoreSecuritySchemaForMaintenance,
} from "../../../packages/ingenium-core/lib/db.js";
import { createProject } from "../../../packages/ingenium-core/lib/tools/projects.js";
import * as authentication from "../../../packages/ingenium-core/lib/tools/authentication.js";
import * as contextConversations from "../../../packages/ingenium-core/lib/tools/context-conversations.js";
import * as coordination from "../../../packages/ingenium-core/lib/tools/coordination.js";
import * as identity from "../../../packages/ingenium-core/lib/tools/identity.js";
import * as invitations from "../../../packages/ingenium-core/lib/tools/invitations.js";
import * as mcpCredentials from "../../../packages/ingenium-core/lib/tools/mcp-credentials.js";
import * as organizations from "../../../packages/ingenium-core/lib/tools/organizations.js";
import * as runtimes from "../../../packages/ingenium-core/lib/tools/runtimes.js";
import * as securityTokens from "../../../packages/ingenium-core/lib/tools/security-tokens.js";
import * as tasks from "../../../packages/ingenium-core/lib/tools/tasks.js";
import {
  authorizeRestore,
  authorizeRestoreExecution,
  confirmRestore,
  createSnapshot,
  executeRestore,
  getRestoreExecutionRun,
  previewRestore,
} from "../../../packages/ingenium-core/lib/tools/backups.js";

type ChildResult = { code: number | null; stdout: string; stderr: string };

let fixtureRoot: string;
let coreDbPath: string;
let openCodeDbPath: string;
let globalProjectId: string;
let runId: string;
let supervisor: Server;
let health: Server;
let healthPort: number;
const processStates = new Map<string, "RUNNING" | "STOPPED">();
const processActions: string[] = [];
const fixtureScript = resolve(__dirname, "fixtures/restore-maintenance-fixture.sh");
const maintenanceScript = resolve(__dirname, "../dist/scripts/restore-maintenance.js");
const migrationsDirectory = resolve(__dirname, "../../../packages/ingenium-core/data/migrations");
const securityFixture: {
  userId: string;
  servicePrincipalId: string;
  runtimeId: string;
  authSessionToken: string;
  scopedToken: string;
  mcpToken: string;
  invitationToken: string;
  runtimeLaunchToken: string;
  runtimeBrowserToken: string;
  runtimeBrowserHost: string;
  preserved: string;
} = {
  userId: "",
  servicePrincipalId: "",
  runtimeId: "",
  authSessionToken: "",
  scopedToken: "",
  mcpToken: "",
  invitationToken: "",
  runtimeLaunchToken: "",
  runtimeBrowserToken: "",
  runtimeBrowserHost: "",
  preserved: "",
};

function runFixture(environment: NodeJS.ProcessEnv): Promise<ChildResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn("/bin/sh", [fixtureScript], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("exit", (code) => resolveResult({ code, stdout, stderr }));
  });
}

async function queuePreparedRestore(idempotencyPrefix: string): Promise<string> {
  const source = await createSnapshot(globalProjectId, "manual", coreDbPath, openCodeDbPath);
  return queueRestore(source.backupId, idempotencyPrefix);
}

function queueRestore(backupId: string, idempotencyPrefix: string): string {
  const plan = previewRestore(globalProjectId, { backupId, dryRun: true, idempotencyKey: `${idempotencyPrefix}-preview` });
  const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
  const ready = confirmRestore(globalProjectId, plan.id, {
    confirmationToken: authorization.confirmationToken,
    expectedRevision: authorization.plan.revision,
    idempotencyKey: `${idempotencyPrefix}-confirm`,
  });
  const execution = authorizeRestoreExecution(globalProjectId, ready.id, ready.revision);
  const run = executeRestore(globalProjectId, ready.id, {
    executionToken: execution.executionToken,
    expectedRevision: execution.plan.revision,
    idempotencyKey: `${idempotencyPrefix}-execute`,
  }).run;
  closeDbForMaintenance();
  return run.id;
}

async function snapshotLegacyRestoreDatabase(sourcePath: string): Promise<{ backupId: string }> {
  closeDbForMaintenance();
  const livePath = process.env.INGENIUM_CORE_DB_PATH;
  process.env.INGENIUM_CORE_DB_PATH = sourcePath;
  let snapshot: { backupId: string };
  try {
    snapshot = await createSnapshot(globalProjectId, "manual", sourcePath, openCodeDbPath);
  } finally {
    closeDbForMaintenance();
    if (livePath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
    else process.env.INGENIUM_CORE_DB_PATH = livePath;
  }
  const source = new Database(sourcePath, { readonly: true });
  const record = source.prepare("SELECT * FROM backup_records WHERE id = ?").get(snapshot.backupId) as Record<string, unknown>;
  source.close();
  getDb(coreDbPath).prepare(`INSERT INTO backup_records
    (id, project_id, filename, size_bytes, sha256, backup_type, components, status, error_message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    record.id, record.project_id, record.filename, record.size_bytes, record.sha256,
    record.backup_type, record.components, record.status, record.error_message, record.created_at,
  );
  return snapshot;
}

function createLegacyRestoreDatabase(path: string, throughMigration: number): void {
  const database = new Database(path);
  try {
    for (const file of readdirSync(migrationsDirectory)
      .filter((name) => /^\d{3}_.*\.sql$/.test(name)
        && !name.endsWith("_upgrade.sql")
        && Number(name.slice(0, 3)) <= throughMigration)
      .sort()) {
      database.exec(readFileSync(resolve(migrationsDirectory, file), "utf8"));
      if (file.startsWith("012_")) {
        const timestamp = "2026-08-14T00:00:00.000Z";
        database.prepare(
          "INSERT INTO projects (id, name, path, is_global, created_at, updated_at) VALUES (?, 'global-default', '/legacy-restore', 1, ?, ?)",
        ).run(globalProjectId, timestamp, timestamp);
      }
    }
  } finally {
    database.close();
  }
}

function seedLegacyAuthentication(path: string): {
  sessionToken: string;
  scopedToken: string;
  preserved: string;
} {
  const database = new Database(path);
  try {
    database.pragma("foreign_keys = ON");
    const timestamp = "2026-08-14T00:01:00.000Z";
    const future = "2027-08-14T00:01:00.000Z";
    const organizationId = "00000000-0000-4000-8000-000000000093";
    const sessionToken = "L".repeat(43);
    const scopedToken = "S".repeat(43);
    const digest = (value: string) => createHash("sha256").update(value).digest("hex");
    database.prepare(
      "INSERT INTO users (id, email_normalized, display_name, created_at, updated_at) VALUES (?, 'legacy-restore@example.test', 'Legacy Restore', ?, ?)",
    ).run(securityFixture.userId, timestamp, timestamp);
    database.prepare(
      "INSERT INTO organization_memberships (organization_id, user_id, role, created_at, updated_at) VALUES (?, ?, 'owner', ?, ?)",
    ).run(organizationId, securityFixture.userId, timestamp, timestamp);
    database.prepare(
      "UPDATE bootstrap_state SET state = 'claimed', owner_user_id = ?, claimed_at = ?, revision = 1, updated_at = ? WHERE singleton = 1",
    ).run(securityFixture.userId, timestamp, timestamp);
    database.prepare(
      "INSERT INTO auth_identities (id, user_id, provider, issuer, subject, created_at, updated_at) VALUES (?, ?, 'local', 'local', ?, ?, ?)",
    ).run(randomUUID(), securityFixture.userId, securityFixture.userId, timestamp, timestamp);
    database.prepare(`INSERT INTO password_credentials
      (user_id, password_hash, salt, scrypt_n, scrypt_r, scrypt_p, created_at, updated_at)
      VALUES (?, ?, ?, 65536, 8, 1, ?, ?)`).run(
      securityFixture.userId, "a".repeat(64), "b".repeat(32), timestamp, timestamp,
    );
    database.prepare(
      "INSERT INTO auth_totp_factors (id, user_id, encrypted_secret, enabled_at, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(randomUUID(), securityFixture.userId, "legacy-totp-preserved-material-1234", timestamp, timestamp);
    database.prepare(
      "INSERT INTO auth_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)",
    ).run(randomUUID(), securityFixture.userId, "c".repeat(64), timestamp);
    database.prepare(`INSERT INTO auth_sessions
      (id, user_id, token_hash, security_epoch, idle_expires_at, absolute_expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, 0, ?, ?, ?, ?)`).run(
      randomUUID(), securityFixture.userId, digest(sessionToken), future, future, timestamp, timestamp,
    );
    database.prepare(`INSERT INTO scoped_api_tokens
      (id, user_id, name, token_prefix, token_hash, scopes_json, organization_id, project_id, expires_at, created_at)
      VALUES (?, ?, 'Legacy restore token', ?, ?, '["projects:read"]', ?, ?, ?, ?)`).run(
      randomUUID(), securityFixture.userId, scopedToken.slice(0, 16), digest(scopedToken), organizationId,
      globalProjectId, future, timestamp,
    );
    database.prepare(`INSERT INTO auth_one_time_states
      (id, purpose, user_id, state_hash, expires_at, created_at)
      VALUES (?, 'password_reset', ?, ?, ?, ?)`).run(
      randomUUID(), securityFixture.userId, "d".repeat(64), future, timestamp,
    );
    return {
      sessionToken,
      scopedToken,
      preserved: JSON.stringify({
        password: database.prepare("SELECT * FROM password_credentials WHERE user_id = ?").get(securityFixture.userId),
        identity: database.prepare("SELECT * FROM auth_identities WHERE user_id = ?").get(securityFixture.userId),
        totp: database.prepare("SELECT * FROM auth_totp_factors WHERE user_id = ?").get(securityFixture.userId),
        recovery: database.prepare("SELECT * FROM auth_recovery_codes WHERE user_id = ?").get(securityFixture.userId),
      }),
    };
  } finally {
    database.close();
  }
}

function supervisorResponse(state: "RUNNING" | "STOPPED"): string {
  return `<methodResponse><params><param><value><struct><member><name>statename</name><value><string>${state}</string></value></member></struct></value></param></params></methodResponse>`;
}

beforeAll(async () => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "ingenium-restore-fixture-"));
  coreDbPath = join(fixtureRoot, "data");
  openCodeDbPath = join(fixtureRoot, "opencode.db");
  const backupsDir = join(fixtureRoot, "backups");
  const stagingDir = join(fixtureRoot, "restore-staging");
  const maintenanceDir = join(fixtureRoot, "maintenance");
  const signingKeyPath = join(fixtureRoot, "backup-signing-key");
  const journalKeyPath = join(fixtureRoot, "restore-journal-key");
  const tokenPath = join(fixtureRoot, "api-token");
  mkdirSync(maintenanceDir, { mode: 0o700 });
  chmodSync(maintenanceDir, 0o700);
  writeFileSync(signingKeyPath, Buffer.alloc(32, 19), { mode: 0o600 });
  writeFileSync(journalKeyPath, Buffer.alloc(32, 23), { mode: 0o600 });
  writeFileSync(tokenPath, "t".repeat(43), { mode: 0o600 });
  process.env.INGENIUM_CORE_DB_PATH = coreDbPath;
  process.env.INGENIUM_BACKUPS_DIR = backupsDir;
  process.env.INGENIUM_RESTORE_STAGING_DIR = stagingDir;
  process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE = signingKeyPath;
  process.env.OPENCODE_DB_PATH = openCodeDbPath;
  process.env.INGENIUM_TRUSTED_ARTIFACT_UID = String(process.getuid?.() ?? 0);
  process.env.INGENIUM_TRUSTED_ARTIFACT_GID = String(process.getgid?.() ?? 0);

  getDb(coreDbPath);
  globalProjectId = createProject("global-default", true).id;
  createProject("source-only");
  const openCode = new Database(openCodeDbPath);
  openCode.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY); INSERT INTO sessions VALUES ('source');");
  openCode.close();

  const db = getDb(coreDbPath);
  const organizationId = (db.prepare("SELECT organization_id FROM projects WHERE id = ?").get(globalProjectId) as { organization_id: string }).organization_id;
  const user = identity.createUser("restore-security@example.test", "Restore Security");
  securityFixture.userId = user.id;
  organizations.addOrganizationMember(organizationId, user.id, "owner");
  const timestamp = new Date().toISOString();
  const future = new Date(Date.now() + 60 * 60_000).toISOString();
  db.prepare("INSERT INTO auth_identities (id, user_id, provider, issuer, subject, created_at, updated_at) VALUES (?, ?, 'local', 'local', ?, ?, ?)")
    .run(randomUUID(), user.id, user.id, timestamp, timestamp);
  db.prepare(`INSERT INTO password_credentials
    (user_id, password_hash, salt, scrypt_n, scrypt_r, scrypt_p, created_at, updated_at)
    VALUES (?, ?, ?, 65536, 8, 1, ?, ?)`).run(user.id, "a".repeat(64), "b".repeat(32), timestamp, timestamp);
  db.prepare("INSERT INTO auth_totp_factors (id, user_id, encrypted_secret, enabled_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), user.id, "totp-preserved-material-1234567890", timestamp, timestamp);
  db.prepare("INSERT INTO auth_recovery_codes (id, user_id, code_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), user.id, "c".repeat(64), timestamp);
  const authSession = authentication.createSession(user.id);
  securityFixture.authSessionToken = authSession.token;
  const scoped = securityTokens.createScopedApiToken({ userId: user.id }, ["projects:read"], new Date(future), {
    organizationId,
    projectId: globalProjectId,
  });
  securityFixture.scopedToken = scoped.token;
  securityFixture.servicePrincipalId = securityTokens.createServicePrincipal(organizationId, "Restore fixture principal");
  const mcp = mcpCredentials.createMcpCredential({
    servicePrincipalId: securityFixture.servicePrincipalId,
    kind: "runtime",
    audience: "runtime",
    name: "Restore fixture runtime",
    scopes: ["child-mcp:runtime"],
    organizationId,
    projectId: globalProjectId,
    workspaceId: "restore-fixture-workspace",
    launcherWorktree: "/workspace/restore-fixture",
    expiresAt: new Date(future),
    createdByUserId: user.id,
  });
  securityFixture.mcpToken = mcp.token;
  let runtime = runtimes.createRuntimeInstance("restore-fixture-workspace", {
    cpuMillis: 1000,
    memoryBytes: 1_073_741_824,
    pidsLimit: 256,
    diskBytes: 2_147_483_648,
    processLimit: 128,
  });
  runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "PROVISIONING", actorType: "system", actorId: "restore-test" });
  runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "STARTING", actorType: "system", actorId: "restore-test" });
  runtime = runtimes.transitionRuntime({ id: runtime.id, expectedRevision: runtime.revision, toState: "READY", actorType: "system", actorId: "restore-test" });
  securityFixture.runtimeId = runtime.id;
  runtimes.bindRuntimeCapability(runtime.id, mcp.id);
  securityFixture.runtimeLaunchToken = runtimes.issueRuntimeLaunchTicket({ runtimeId: runtime.id, ownerUserId: user.id, audience: "web" }).token;
  const exchangeProof = "e".repeat(43);
  const browserLaunch = runtimes.issueRuntimeBrowserLaunchTicket({
    runtimeId: runtime.id,
    ownerUserId: user.id,
    authSessionId: authSession.session.id,
    audience: "web",
    rootDomain: "runtime.example.test",
    launcherOrigin: "https://dashboard.example.test",
    exchangeProof,
  });
  securityFixture.runtimeBrowserHost = browserLaunch.host;
  securityFixture.runtimeBrowserToken = runtimes.consumeRuntimeBrowserLaunchTicket({
    exchangeProof,
    audience: "web",
    origin: browserLaunch.origin,
    host: browserLaunch.host,
    launcherOrigin: browserLaunch.launcherOrigin,
  })!.token;
  db.prepare(`INSERT INTO auth_one_time_states
    (id, purpose, user_id, state_hash, expires_at, created_at) VALUES (?, 'password_reset', ?, ?, ?, ?)`).run(
    randomUUID(), user.id, "d".repeat(64), future, timestamp,
  );
  const providerId = randomUUID();
  db.prepare(`INSERT INTO oidc_providers
    (id, name, issuer, client_id, redirect_uri, signature_algorithm, created_at, updated_at)
    VALUES (?, 'restore-fixture', 'https://issuer.example.test', 'client', 'https://dashboard.example.test/callback', 'RS256', ?, ?)`)
    .run(providerId, timestamp, timestamp);
  db.prepare(`INSERT INTO oidc_authorization_states
    (id, provider_id, state_hash, transaction_hash, nonce_hash, encrypted_pkce_verifier, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    randomUUID(), providerId, "e".repeat(64), "f".repeat(64), "1".repeat(64), "encrypted-pkce-verifier-material-123", future, timestamp,
  );
  db.prepare(`INSERT INTO mail_oauth_attempts
    (state_hash, organization_id, owner_kind, owner_user_id, account_id, provider, actor_type, expires_at, created_at)
    VALUES (?, ?, 'user', ?, 'restore-account', 'gmail', 'user', ?, ?)`).run("2".repeat(64), organizationId, user.id, future, timestamp);
  const conversation = contextConversations.createContextConversation(globalProjectId, {
    title: "Restore authorization",
    visibility: "private",
    ownerUserId: user.id,
  });
  contextConversations.authorizeContextMaintenanceAction(globalProjectId, conversation.id, {
    operation: "archive_conversation",
    expectedRevision: 0,
  });
  securityFixture.invitationToken = invitations.issueInvitation(organizationId, "invitee@example.test", "member");
  const task = tasks.createTask(globalProjectId, "Restore reservation");
  tasks.reserveTask(globalProjectId, task.id, {
    owner: "restore-owner",
    worktree: "restore-worktree",
    reservationToken: "r".repeat(43),
    expectedRevision: task.revision,
    idempotencyKey: "restore-reserve",
  });
  const ownershipToken = "o".repeat(43);
  const registered = coordination.registerCoordinationSession(globalProjectId, {
    worktreeId: "restore-worktree",
    sessionId: "restore-session",
    incarnation: 1,
    ownershipToken,
    ttlMs: 60_000,
    idempotencyKey: "restore-register",
  });
  coordination.claimCoordinationBatch(globalProjectId, {
    worktreeId: "restore-worktree",
    sessionId: "restore-session",
    incarnation: 1,
    expectedRevision: registered.revision,
    fence: registered.fence,
    ownershipToken,
    idempotencyKey: "restore-claim",
    claims: [{ claim: { kind: "path", path: "src/restore.ts" } }],
  });
  const pendingSource = await createSnapshot(globalProjectId, "manual", coreDbPath, openCodeDbPath);
  const pendingPlan = previewRestore(globalProjectId, { backupId: pendingSource.backupId, dryRun: true, idempotencyKey: "pending-preview" });
  authorizeRestore(globalProjectId, pendingPlan.id, pendingPlan.revision);
  securityFixture.preserved = JSON.stringify({
    password: db.prepare("SELECT * FROM password_credentials WHERE user_id = ?").get(user.id),
    identity: db.prepare("SELECT * FROM auth_identities WHERE user_id = ?").get(user.id),
    totp: db.prepare("SELECT * FROM auth_totp_factors WHERE user_id = ?").get(user.id),
    recovery: db.prepare("SELECT * FROM auth_recovery_codes WHERE user_id = ?").get(user.id),
  });
  const source = await createSnapshot(globalProjectId, "manual", coreDbPath, openCodeDbPath);
  createProject("live-only");
  const liveOpenCode = new Database(openCodeDbPath);
  liveOpenCode.exec("DELETE FROM sessions; INSERT INTO sessions VALUES ('live');");
  liveOpenCode.close();

  const plan = previewRestore(globalProjectId, { backupId: source.backupId, dryRun: true, idempotencyKey: "fixture-preview" });
  const authorization = authorizeRestore(globalProjectId, plan.id, plan.revision);
  const ready = confirmRestore(globalProjectId, plan.id, {
    confirmationToken: authorization.confirmationToken,
    expectedRevision: authorization.plan.revision,
    idempotencyKey: "fixture-confirm",
  });
  const execution = authorizeRestoreExecution(globalProjectId, ready.id, ready.revision);
  runId = executeRestore(globalProjectId, ready.id, {
    executionToken: execution.executionToken,
    expectedRevision: execution.plan.revision,
    idempotencyKey: "fixture-execute",
  }).run.id;
  closeDbForMaintenance();

  for (const name of ["ttyd-opencode", "vscode", "opencode-web", "ingenium-api"]) processStates.set(name, "RUNNING");
  supervisor = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { body += chunk; });
    request.on("end", () => {
      const program = body.match(/<string>([^<]+)<\/string>/)?.[1];
      if (program && body.includes("stopProcess")) {
        processActions.push(`stop:${program}`);
        processStates.set(program, "STOPPED");
      }
      if (program && body.includes("startProcess")) {
        processActions.push(`start:${program}`);
        processStates.set(program, "RUNNING");
      }
      response.writeHead(200, { "Content-Type": "text/xml" });
      response.end(supervisorResponse(program ? processStates.get(program) ?? "STOPPED" : "STOPPED"));
    });
  });
  await new Promise<void>((resolveServer) => supervisor.listen(9001, "127.0.0.1", resolveServer));

  health = createServer((request, response) => {
    if (request.url === "/api/v1/health" && request.headers.authorization === `Bearer ${"t".repeat(43)}`) {
      response.writeHead(200).end("{}")
      return;
    }
    response.writeHead(401).end();
  });
  await new Promise<void>((resolveServer) => health.listen(0, "127.0.0.1", () => {
    healthPort = (health.address() as AddressInfo).port;
    resolveServer();
  }));
});

afterAll(async () => {
  if (supervisor) await new Promise<void>((resolveServer) => supervisor.close(() => resolveServer()));
  if (health) await new Promise<void>((resolveServer) => health.close(() => resolveServer()));
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_BACKUPS_DIR;
  delete process.env.INGENIUM_RESTORE_STAGING_DIR;
  delete process.env.INGENIUM_BACKUP_SIGNING_KEY_FILE;
  delete process.env.OPENCODE_DB_PATH;
  delete process.env.INGENIUM_TRUSTED_ARTIFACT_UID;
  delete process.env.INGENIUM_TRUSTED_ARTIFACT_GID;
  const stagingRoot = join(fixtureRoot, "restore-staging");
  if (existsSync(stagingRoot)) {
    for (const entry of readdirSync(stagingRoot)) chmodSync(join(stagingRoot, entry), 0o700);
  }
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("RESTORE-101 disposable maintenance fixture", () => {
  it("refuses persistent container volume paths", async () => {
    const result = await runFixture({ INGENIUM_RESTORE_FIXTURE_ROOT: "/app/.ingenium" });
    expect(result).toMatchObject({ code: 64, stderr: expect.stringContaining("disposable") });
  });

  it("rejects a same-UID forged active journal before touching either database", async () => {
    writeFileSync(join(fixtureRoot, "maintenance", "journal.json"), JSON.stringify({
      version: 1,
      runId,
      phase: "completed",
      capsule: {},
      targets: {},
      hmac: "0".repeat(64),
    }), { mode: 0o600 });
    const result = await runFixture({
      INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
      RESTORE_FIXTURE_MODE: "recover",
      INGENIUM_API_PORT: String(healthPort),
      INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
      INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
      RESTORE_MAINTENANCE_NODE: process.execPath,
      RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
    });
    expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining("JOURNAL_INVALID") });
    rmSync(join(fixtureRoot, "maintenance", "journal.json"));
  });

  it("applies only the prepared paired fixture and restarts every stopped user", async () => {
    const {
      INGENIUM_CORE_DB_PATH: _coreDbPath,
      OPENCODE_DB_PATH: _openCodeDbPath,
      INGENIUM_RESTORE_MAINTENANCE_DIR: _maintenanceDir,
      ...cleanEnvironment
    } = process.env;
    const result = await runFixture({
      ...cleanEnvironment,
      INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
      INGENIUM_API_PORT: String(healthPort),
      INGENIUM_API_TOKEN_FILE: join(fixtureRoot, "api-token"),
      INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
      INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
      RESTORE_MAINTENANCE_NODE: process.execPath,
      RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
    });

    expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
    expect(getDb(coreDbPath).prepare("SELECT name FROM projects WHERE name = 'live-only'").get()).toBeUndefined();
    expect(getRestoreExecutionRun(globalProjectId, runId)).toMatchObject({ state: "completed" });
    const restoredDb = getDb(coreDbPath);
    expect(authentication.resolveSession(securityFixture.authSessionToken)).toBeUndefined();
    expect(securityTokens.resolveScopedApiToken(securityFixture.scopedToken)).toBeUndefined();
    expect(mcpCredentials.resolveMcpCredential(securityFixture.mcpToken, "runtime")).toBeUndefined();
    expect(invitations.previewInvitation(securityFixture.invitationToken)).toBeUndefined();
    expect(runtimes.consumeRuntimeLaunchTicket({
      token: securityFixture.runtimeLaunchToken,
      runtimeId: securityFixture.runtimeId,
      ownerUserId: securityFixture.userId,
      audience: "web",
    })).toBeUndefined();
    expect(runtimes.resolveRuntimeBrowserSession({
      token: securityFixture.runtimeBrowserToken,
      audience: "web",
      host: securityFixture.runtimeBrowserHost,
    })).toBeUndefined();
    expect(restoredDb.prepare("SELECT count(*) AS count FROM auth_one_time_states WHERE consumed_at IS NULL").get()).toEqual({ count: 0 });
    expect(restoredDb.prepare("SELECT count(*) AS count FROM oidc_authorization_states WHERE consumed_at IS NULL").get()).toEqual({ count: 0 });
    expect(restoredDb.prepare("SELECT count(*) AS count FROM mail_oauth_attempts WHERE consumed_at IS NULL").get()).toEqual({ count: 0 });
    expect(restoredDb.prepare("SELECT count(*) AS count FROM context_checkpoint_maintenance_authorizations WHERE consumed_at IS NULL").get()).toEqual({ count: 0 });
    expect(restoredDb.prepare("SELECT count(*) AS count FROM backup_restore_authorizations WHERE consumed_at IS NULL").get()).toEqual({ count: 0 });
    expect(restoredDb.prepare("SELECT count(*) AS count FROM organization_invitations WHERE accepted_at IS NULL AND revoked_at IS NULL").get()).toEqual({ count: 0 });
    expect(restoredDb.prepare("SELECT reservation_state, reservation_token_hash FROM tasks WHERE title = 'Restore reservation'").get())
      .toEqual({ reservation_state: "available", reservation_token_hash: null });
    expect(restoredDb.prepare("SELECT state FROM coordination_sessions WHERE session_id = 'restore-session'").get()).toEqual({ state: "closed" });
    expect(restoredDb.prepare("SELECT state FROM coordination_claims WHERE value = 'src/restore.ts'").get()).toEqual({ state: "released" });
    expect(restoredDb.prepare("SELECT security_epoch FROM users WHERE id = ?").get(securityFixture.userId)).toEqual({ security_epoch: 1 });
    expect(restoredDb.prepare("SELECT security_epoch FROM service_principals WHERE id = ?").get(securityFixture.servicePrincipalId)).toEqual({ security_epoch: 1 });
    expect(restoredDb.prepare("SELECT security_epoch FROM runtime_instances WHERE id = ?").get(securityFixture.runtimeId)).toEqual({ security_epoch: 1 });
    expect(restoredDb.prepare("SELECT generation FROM runtime_browser_generations WHERE runtime_id = ?").get(securityFixture.runtimeId)).toEqual({ generation: 1 });
    expect(JSON.stringify({
      password: restoredDb.prepare("SELECT * FROM password_credentials WHERE user_id = ?").get(securityFixture.userId),
      identity: restoredDb.prepare("SELECT * FROM auth_identities WHERE user_id = ?").get(securityFixture.userId),
      totp: restoredDb.prepare("SELECT * FROM auth_totp_factors WHERE user_id = ?").get(securityFixture.userId),
      recovery: restoredDb.prepare("SELECT * FROM auth_recovery_codes WHERE user_id = ?").get(securityFixture.userId),
    })).toBe(securityFixture.preserved);
    expect(restoredDb.prepare("SELECT count(*) AS count FROM security_audit_events WHERE action = 'restore.tokens_invalidated' AND actor_id = ?").get(runId)).toEqual({ count: 1 });
    expect(restoredDb.prepare("SELECT count(*) AS count FROM backup_restore_execution_phase_events WHERE run_id = ? AND phase_code = 'capsule' AND status = 'completed'").get(runId)).toEqual({ count: 1 });
    const restoredOpenCode = new Database(openCodeDbPath, { readonly: true });
    try {
      expect(restoredOpenCode.prepare("SELECT id FROM sessions").all()).toEqual([{ id: "source" }]);
    } finally {
      restoredOpenCode.close();
    }
    expect([...processStates.values()]).toEqual(["RUNNING", "RUNNING", "RUNNING", "RUNNING"]);
    expect(existsSync(`${coreDbPath}-wal`)).toBe(true);
    expect(existsSync(`${coreDbPath}-shm`)).toBe(true);
    expect(existsSync(`${openCodeDbPath}-wal`)).toBe(true);
    expect(existsSync(`${openCodeDbPath}-shm`)).toBe(true);
    expect(existsSync(join(fixtureRoot, "maintenance", "journal.json"))).toBe(false);
    expect(existsSync(join(fixtureRoot, "maintenance", "lock"))).toBe(false);
    expect(readdirSync(join(fixtureRoot, "maintenance", "archive"))).toHaveLength(1);
  });

  it("upgrades a valid migration-093 snapshot before recording invalidation", async () => {
    const sourcePath = join(fixtureRoot, "migration-093-source.db");
    createLegacyRestoreDatabase(sourcePath, 93);
    const source = await snapshotLegacyRestoreDatabase(sourcePath);
    const legacyRunId = queueRestore(source.backupId, "migration-093");
    processActions.length = 0;

    const result = await runFixture({
      INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
      INGENIUM_API_PORT: String(healthPort),
      INGENIUM_API_TOKEN_FILE: join(fixtureRoot, "api-token"),
      INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
      INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
      RESTORE_MAINTENANCE_NODE: process.execPath,
      RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
    });

    expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
    expect(getRestoreExecutionRun(globalProjectId, legacyRunId)).toMatchObject({ state: "completed" });
    const restored = getDb(coreDbPath);
    expect(restored.prepare(
      "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('auth_sessions', 'mcp_credentials', 'runtime_browser_sessions')",
    ).get()).toEqual({ count: 3 });
    expect(restored.prepare("SELECT count(*) AS count FROM password_credentials").get()).toEqual({ count: 0 });
    expect(restored.prepare(
      "SELECT count(*) AS count FROM security_audit_events WHERE action = 'restore.tokens_invalidated' AND actor_id = ?",
    ).get(legacyRunId)).toEqual({ count: 1 });
    expect(processActions).toContain("start:ingenium-api");
  });

  it("upgrades migration-093-derived early auth while preserving policy and revoking tokens", async () => {
    const sourcePath = join(fixtureRoot, "migration-095-source.db");
    createLegacyRestoreDatabase(sourcePath, 95);
    const legacy = seedLegacyAuthentication(sourcePath);
    const source = await snapshotLegacyRestoreDatabase(sourcePath);
    const legacyRunId = queueRestore(source.backupId, "migration-095");

    const result = await runFixture({
      INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
      INGENIUM_API_PORT: String(healthPort),
      INGENIUM_API_TOKEN_FILE: join(fixtureRoot, "api-token"),
      INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
      INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
      RESTORE_MAINTENANCE_NODE: process.execPath,
      RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
    });

    expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
    expect(getRestoreExecutionRun(globalProjectId, legacyRunId)).toMatchObject({ state: "completed" });
    expect(authentication.resolveSession(legacy.sessionToken)).toBeUndefined();
    expect(securityTokens.resolveScopedApiToken(legacy.scopedToken)).toBeUndefined();
    const restored = getDb(coreDbPath);
    expect(restored.prepare("SELECT count(*) AS count FROM auth_one_time_states WHERE consumed_at IS NULL").get())
      .toEqual({ count: 0 });
    expect(restored.prepare("SELECT security_epoch FROM users WHERE id = ?").get(securityFixture.userId))
      .toEqual({ security_epoch: 1 });
    expect(JSON.stringify({
      password: restored.prepare("SELECT * FROM password_credentials WHERE user_id = ?").get(securityFixture.userId),
      identity: restored.prepare("SELECT * FROM auth_identities WHERE user_id = ?").get(securityFixture.userId),
      totp: restored.prepare("SELECT * FROM auth_totp_factors WHERE user_id = ?").get(securityFixture.userId),
      recovery: restored.prepare("SELECT * FROM auth_recovery_codes WHERE user_id = ?").get(securityFixture.userId),
    })).toBe(legacy.preserved);
  });

  it("rejects an ambiguous migration-093 credential group during maintenance preflight", () => {
    const sourcePath = join(fixtureRoot, "partial-migration-094-source.db");
    createLegacyRestoreDatabase(sourcePath, 93);
    const partial = new Database(sourcePath);
    partial.exec("ALTER TABLE users ADD COLUMN security_epoch INTEGER NOT NULL DEFAULT 0 CHECK(security_epoch >= 0)");
    partial.close();
    processActions.length = 0;
    process.env.INGENIUM_RESTORE_MAINTENANCE_MODE = "execute";
    process.env.INGENIUM_RESTORE_TEST_ROOT = fixtureRoot;
    try {
      expect(() => validateRestoreSecuritySchemaForMaintenance(sourcePath)).toThrow(/Migration 094 is in a PARTIAL state/);
    } finally {
      delete process.env.INGENIUM_RESTORE_MAINTENANCE_MODE;
      delete process.env.INGENIUM_RESTORE_TEST_ROOT;
    }
    expect(processActions).toEqual([]);
    expect(existsSync(join(fixtureRoot, "maintenance", "journal.json"))).toBe(false);
    expect(existsSync(join(fixtureRoot, "maintenance", "lock"))).toBe(false);
    expect(getDb(coreDbPath).prepare("SELECT id FROM users WHERE id = ?").get(securityFixture.userId)).toBeDefined();
  });

  it("restricts the non-root test executor to its disposable fixture root", () => {
    const outsideRoot = mkdtempSync(join(tmpdir(), "restore-maintenance-outside-"));
    const outsidePath = join(outsideRoot, "source.db");
    new Database(outsidePath).close();
    process.env.INGENIUM_RESTORE_MAINTENANCE_MODE = "execute";
    process.env.INGENIUM_RESTORE_TEST_ROOT = fixtureRoot;
    try {
      expect(() => validateRestoreSecuritySchemaForMaintenance(outsidePath))
        .toThrow("Restore security migration is restricted to the fixed maintenance executor");
    } finally {
      delete process.env.INGENIUM_RESTORE_MAINTENANCE_MODE;
      delete process.env.INGENIUM_RESTORE_TEST_ROOT;
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("rolls the database pair back when the atomic invalidation audit fails", async () => {
    const liveSession = authentication.createSession(securityFixture.userId);
    getDb(coreDbPath).exec(`CREATE TRIGGER restore_test_reject_invalidation_audit
      BEFORE INSERT ON security_audit_events
      WHEN NEW.action = 'restore.tokens_invalidated'
      BEGIN SELECT RAISE(ABORT, 'injected restore invalidation audit failure'); END;`);
    const faultRunId = await queuePreparedRestore("audit-failure");
    getDb(coreDbPath).exec("DROP TRIGGER restore_test_reject_invalidation_audit");
    closeDbForMaintenance();

    const result = await runFixture({
      INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
      INGENIUM_API_PORT: String(healthPort),
      INGENIUM_API_TOKEN_FILE: join(fixtureRoot, "api-token"),
      INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
      INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
      RESTORE_MAINTENANCE_NODE: process.execPath,
      RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
    });

    expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining("VERIFY_FAILED") });
    expect(existsSync(join(fixtureRoot, "maintenance", "journal.json"))).toBe(true);
    const recovery = await runFixture({
      INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
      RESTORE_FIXTURE_MODE: "recover",
      INGENIUM_API_PORT: String(healthPort),
      INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
      INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
      RESTORE_MAINTENANCE_NODE: process.execPath,
      RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
    });
    expect(recovery, recovery.stderr).toMatchObject({ code: 0, stderr: "" });
    expect(getRestoreExecutionRun(globalProjectId, faultRunId)).toMatchObject({ state: "rolled_back" });
    expect(authentication.resolveSession(liveSession.token)).toBeDefined();
    expect(getDb(coreDbPath).prepare(
      "SELECT count(*) AS count FROM security_audit_events WHERE action = 'restore.tokens_invalidated' AND actor_id = ?",
    ).get(faultRunId)).toEqual({ count: 0 });
  });

  it("fails closed for injected unreadable proc fd directories and descriptors", async () => {
    for (const fault of ["fd-dir", "fd"] as const) {
      const faultRunId = await queuePreparedRestore(`proc-${fault}`);
      expect(getRestoreExecutionRun(globalProjectId, faultRunId)).toMatchObject({ state: "queued" });
      const result = await runFixture({
        INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
        INGENIUM_API_PORT: String(healthPort),
        INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
        INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
        RESTORE_FIXTURE_PROC_FAULT: fault,
        RESTORE_MAINTENANCE_NODE: process.execPath,
        RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
      });
      expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining("HOLDER_REFUSED") });
      expect(getRestoreExecutionRun(globalProjectId, faultRunId)).toMatchObject({ state: "rolled_back" });
      expect(existsSync(join(fixtureRoot, "maintenance", "journal.json"))).toBe(false);
    }
  });

  it("denies a delayed hardlink open after target locking", async () => {
    const alias = join(fixtureRoot, "delayed-open-alias");
    const faultRunId = await queuePreparedRestore("delayed-hardlink");
    linkSync(coreDbPath, alias);
    const child = spawn(process.execPath, ["-e", [
      "const fs = require('node:fs');",
      "const [ready, target, result] = process.argv.slice(1);",
      "process.stdout.write('ready\\n');",
      "const timer = setInterval(() => { if (!fs.existsSync(ready)) return; try { fs.openSync(target, 'r'); fs.writeFileSync(result, 'OPENED'); } catch (error) { fs.writeFileSync(result, error.code); } clearInterval(timer); process.exit(0); }, 5);",
    ].join(" "), join(fixtureRoot, "target-lock.ready"), alias, join(fixtureRoot, "target-lock.result")], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      await new Promise<void>((resolveReady, reject) => { child.once("error", reject); child.stdout!.once("data", () => resolveReady()); });
      const result = await runFixture({
        INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
        INGENIUM_API_PORT: String(healthPort),
        INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
        INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
        RESTORE_FIXTURE_TARGET_LOCK_PROBE: "1",
        RESTORE_MAINTENANCE_NODE: process.execPath,
        RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
      });
      expect(result, result.stderr).toMatchObject({ code: 0, stderr: "" });
      expect(getRestoreExecutionRun(globalProjectId, faultRunId)).toMatchObject({ state: "completed" });
    } finally {
      if (child.exitCode === null) await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
      if (existsSync(alias)) unlinkSync(alias);
    }
  });

  it("rejects an already-open hardlink alias by inode", async () => {
    const alias = join(fixtureRoot, "already-open-alias");
    const faultRunId = await queuePreparedRestore("open-hardlink");
    linkSync(coreDbPath, alias);
    const child = spawn(process.execPath, ["-e", [
      "const fs = require('node:fs');",
      "const fd = fs.openSync(process.argv[1], 'r');",
      "process.stdout.write(String(fd) + '\\n');",
      "setInterval(() => fd, 1000);",
    ].join(" "), alias], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      const fd = await new Promise<string>((resolveFd, reject) => {
        child.once("error", reject);
        child.stdout!.once("data", (data: Buffer) => resolveFd(data.toString().trim()));
      });
      const procRoot = join(fixtureRoot, "proc-open-alias");
      mkdirSync(join(procRoot, "1", "fd"), { recursive: true });
      symlinkSync(`/proc/${child.pid}/fd/${fd}`, join(procRoot, "1", "fd", "0"));
      const result = await runFixture({
        INGENIUM_RESTORE_FIXTURE_ROOT: fixtureRoot,
        INGENIUM_API_PORT: String(healthPort),
        INGENIUM_TRUSTED_ARTIFACT_UID: String(process.getuid?.() ?? 0),
        INGENIUM_TRUSTED_ARTIFACT_GID: String(process.getgid?.() ?? 0),
        RESTORE_FIXTURE_PROC_ROOT: procRoot,
        RESTORE_MAINTENANCE_NODE: process.execPath,
        RESTORE_MAINTENANCE_SCRIPT: maintenanceScript,
      });
      expect(result).toMatchObject({ code: 1, stderr: expect.stringContaining("HOLDER_REFUSED") });
      expect(getRestoreExecutionRun(globalProjectId, faultRunId)).toMatchObject({ state: "rolled_back" });
    } finally {
      child.kill("SIGTERM");
      if (child.exitCode === null) await new Promise<void>((resolveExit) => child.once("exit", () => resolveExit()));
      if (existsSync(alias)) unlinkSync(alias);
    }
  });
});
