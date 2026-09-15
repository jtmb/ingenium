import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "ingenium-core";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import { csrfMiddleware } from "../lib/middleware/csrf.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { cloudflareRouter } from "../lib/routes/cloudflare.js";

vi.mock("ingenium-core", async (importOriginal) => ({
  ...await importOriginal<typeof import("ingenium-core")>(),
  safeEndpointFetch: vi.fn(),
}));

const PASSPHRASE = "cloudflare-api-passphrase";
const TOKEN = "eyJhIjoiY2xvdWRmbGFyZS1hcGktdGVzdC10b2tlbiJ9.test";
let tempDir = "";
let apiServer: Server;
let supervisorServer: Server;
let baseUrl = "";
let principals: Record<string, Express.Request["principal"]> = {};
let csrfTokens: Record<string, string> = {};
let connectorPresent = false;
let connectorState = "STOPPED";
let malformedSupervisorResponse = false;
let supervisorRequests: string[] = [];
let routesFile = "";
let credentialHandoffFile = "";
let databaseNumber = 0;
let rejectSupervisorStop = false;

const trustedIngress = {
  tunnelName: "ingenium-production",
  routes: Object.fromEntries(core.cloudflareTunnel.CLOUDFLARE_SERVICE_IDS.map((service) => [service, [{
    publicUrl: `https://${service}.example.com/`,
    target: core.cloudflareTunnel.CLOUDFLARE_SERVICE_TARGETS[service],
  }]])),
};

function processStruct(): string {
  return `<struct><member><name>name</name><value><string>cloudflare-tunnel</string></value></member><member><name>statename</name><value><string>${connectorState}</string></value></member><member><name>start</name><value><i4>1</i4></value></member><member><name>now</name><value><i4>2</i4></value></member><member><name>spawnerr</name><value><string></string></value></member><member><name>pid</name><value><i4>1</i4></value></member><member><name>exitstatus</name><value><i4>0</i4></value></member><member><name>stop</name><value><i4>0</i4></value></member></struct>`;
}

function supervisorResponse(): string {
  return `<methodResponse><params><param><value><array><data>${connectorPresent ? `<value>${processStruct()}</value>` : ""}</data></array></value></param></params></methodResponse>`;
}

function validConfig(enabled = true): core.cloudflareTunnel.CloudflareTunnelConfig {
  const config = core.cloudflareTunnel.defaultCloudflareTunnelConfig();
  return {
    ...config,
    enabled,
    tunnelName: "ingenium-production",
    services: {
      ...config.services,
      dashboard: { enabled: true, publicUrl: "https://dashboard.example.com/" },
      opencode: { enabled: true, publicUrl: "https://opencode.example.com/" },
      cli: { enabled: true, publicUrl: "https://cli.example.com/" },
      vscode: { enabled: true, publicUrl: "https://vscode.example.com/" },
      api: { enabled: true, publicUrl: "https://api.example.com/" },
    },
  };
}

beforeAll(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-cloudflare-api-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
  process.env.NODE_ENV = "test";
  routesFile = join(tempDir, "cloudflare-routes.json");
  credentialHandoffFile = join(tempDir, "cloudflare-tunnel.handoff");
  writeFileSync(routesFile, JSON.stringify(trustedIngress), { mode: 0o600 });
  process.env.INGENIUM_CLOUDFLARE_ROUTES_FILE = routesFile;
  process.env.INGENIUM_CLOUDFLARE_CREDENTIAL_HANDOFF_FILE = credentialHandoffFile;
  const socketPath = join(tempDir, "supervisor.sock");
  supervisorServer = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      supervisorRequests.push(body);
      if (rejectSupervisorStop && body.includes("supervisor.stopProcess")) {
        response.writeHead(503).end();
        return;
      }
      if (body.includes("supervisor.startProcess")) connectorState = "RUNNING";
      if (body.includes("supervisor.stopProcess")) connectorState = "STOPPED";
      response.writeHead(200, { "Content-Type": "text/xml" });
      response.end(malformedSupervisorResponse
        ? "stale"
        : body.includes("supervisor.getAllProcessInfo")
          ? supervisorResponse()
          : "<methodResponse><params><param><value><boolean>1</boolean></value></param></params></methodResponse>");
    });
  });
  await new Promise<void>((resolve) => supervisorServer.listen(socketPath, resolve));
  process.env.SUPERVISOR_SERVER_URL = `unix://${socketPath}`;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.principal = principals[String(req.headers["x-test-principal"] ?? "")];
    next();
  });
  app.use(csrfMiddleware);
  app.use(authorizationMiddleware);
  app.use("/api/v1/services/cloudflare", cloudflareRouter);
  app.use(errorHandler);
  apiServer = createServer(app);
  await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(apiServer.address() as AddressInfo).port}/api/v1/services/cloudflare`;
});

beforeEach(() => {
  vi.mocked(core.safeEndpointFetch).mockReset().mockResolvedValue(new Response(null, { status: 401 }));
  core.vault.sealVault();
  core.resetDbForTest();
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, `data-${++databaseNumber}.db`);
  const project = core.projects.createProject("global-default", true);
  const admin = core.identity.createUser(`cloudflare-admin-${Date.now()}@example.test`, "Cloudflare Admin");
  const editor = core.identity.createUser(`cloudflare-editor-${Date.now()}@example.test`, "Cloudflare Editor");
  core.getDb().prepare("INSERT INTO installation_admins (user_id, created_at) VALUES (?, ?)").run(admin.id, new Date().toISOString());
  const recent = core.authentication.createSession(admin.id, new Date(), "cloudflare", true);
  const stale = core.authentication.createSession(admin.id);
  const editorRecent = core.authentication.createSession(editor.id, new Date(), "cloudflare", true);
  principals = {
    recent: { type: "user", id: admin.id, scopes: ["user:*"], session: recent.session },
    stale: { type: "user", id: admin.id, scopes: ["user:*"], session: stale.session },
    editor: { type: "user", id: editor.id, scopes: ["user:*"], session: editorRecent.session },
    compatibility: { type: "compatibility", id: "legacy-server-bearer", scopes: ["legacy:*"] },
  };
  csrfTokens = { recent: recent.csrfToken, stale: stale.csrfToken, editor: editorRecent.csrfToken };
  expect(core.vault.initializeVault(project.id, PASSPHRASE, PASSPHRASE).ok).toBe(true);
  connectorPresent = false;
  connectorState = "STOPPED";
  malformedSupervisorResponse = false;
  rejectSupervisorStop = false;
  supervisorRequests = [];
});

afterAll(async () => {
  await new Promise<void>((resolve) => apiServer.close(() => resolve()));
  await new Promise<void>((resolve) => supervisorServer.close(() => resolve()));
  core.vault.sealVault();
  core.resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.SUPERVISOR_SERVER_URL;
  delete process.env.INGENIUM_CLOUDFLARE_ROUTES_FILE;
  delete process.env.INGENIUM_CLOUDFLARE_CREDENTIAL_HANDOFF_FILE;
  rmSync(tempDir, { recursive: true, force: true });
});

async function request(path = "", options: RequestInit & { principal?: string; csrf?: boolean } = {}): Promise<Response> {
  const { principal, csrf = true, ...init } = options;
  const token = principal ? csrfTokens[principal] : undefined;
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(principal ? { "x-test-principal": principal } : {}),
      ...(token && csrf ? { Origin: "http://localhost:3000", "x-csrf-token": token } : {}),
      ...init.headers,
    },
  });
}

describe("Cloudflare API source boundary", () => {
  it("requires a browser installation admin, CSRF, and recent step-up for writes", async () => {
    expect((await request()).status).toBe(401);
    expect((await request("", { principal: "editor" })).status).toBe(403);
    expect((await request("", { principal: "compatibility" })).status).toBe(403);
    const stale = await request("", { method: "PUT", principal: "stale", body: JSON.stringify({ config: validConfig() }) });
    expect(stale.status).toBe(403);
    expect((await stale.json()).error.code).toBe("STEP_UP_REQUIRED");
    const noCsrf = await request("", { method: "PUT", principal: "recent", csrf: false, body: JSON.stringify({ config: validConfig() }) });
    expect(noCsrf.status).toBe(403);
    expect((await noCsrf.json()).error.code).toBe("CSRF_REJECTED");
  });

  it("creates, reads with redaction, updates, and disables exact service mappings", async () => {
    const create = await request("", {
      method: "PUT",
      principal: "recent",
      body: JSON.stringify({ config: validConfig(), token: { action: "replace", value: TOKEN } }),
    });
    const createdText = await create.text();
    expect(create.status).toBe(200);
    expect(createdText).not.toContain(TOKEN);
    expect(JSON.parse(createdText).data).toMatchObject({
      desired: { enabled: true, configuration: "valid" },
      inventory: { status: "ready", error: null },
      token: { configured: true, readiness: "ready" },
      connector: { state: "absent" },
    });

    const read = await request("", { principal: "recent" });
    const readText = await read.text();
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toContain("no-store");
    expect(readText).not.toContain(TOKEN);
    expect(JSON.parse(readText).data.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ service: "opencode", target: "authenticated-production-opencode-audience-gateway", health: "unavailable" }),
    ]));

    const disabled = validConfig(false);
    disabled.services.api.enabled = false;
    const update = await request("", {
      method: "PUT",
      principal: "recent",
      body: JSON.stringify({ config: disabled, token: { action: "clear" } }),
    });
    expect(update.status).toBe(200);
    expect((await update.json()).data).toMatchObject({
      desired: { enabled: false },
      token: { configured: false, readiness: "missing" },
      config: { services: { api: { enabled: false } } },
    });
  });

  it("rejects malformed, unsafe, and arbitrary runtime mappings", async () => {
    const unsafe = validConfig();
    unsafe.services.opencode.publicUrl = "http://opencode.localhost:3000/";
    expect((await request("", { method: "PUT", principal: "recent", body: JSON.stringify({ config: unsafe }) })).status).toBe(422);
    const untrusted = validConfig();
    untrusted.services.dashboard.publicUrl = "https://other.example.com/";
    expect((await request("", { method: "PUT", principal: "recent", body: JSON.stringify({ config: untrusted }) })).status).toBe(422);
    expect((await request("", { method: "PUT", principal: "recent", body: JSON.stringify({ config: { ...validConfig(), upstream: "http://127.0.0.1:4098" } }) })).status).toBe(422);
    expect((await request("/connect", { method: "POST", principal: "recent", body: JSON.stringify({ args: ["--url", "http://127.0.0.1"] }) })).status).toBe(422);
  });

  it.each(["replace", "clear"] as const)("leaves config and token unchanged when PUT %s cannot persist", async (action) => {
    await request("", { method: "PUT", principal: "recent", body: JSON.stringify({
      config: validConfig(), token: { action: "replace", value: TOKEN },
    }) });
    const before = core.getDb().prepare("SELECT * FROM vault_items").all();
    core.getDb().exec(`CREATE TEMP TRIGGER reject_cloudflare_save BEFORE INSERT ON settings
      WHEN NEW.key = 'cloudflare_tunnel_config' BEGIN SELECT RAISE(ABORT, 'injected config failure'); END`);

    const response = await request("", { method: "PUT", principal: "recent", body: JSON.stringify({
      config: validConfig(false), token: { action, ...(action === "replace" ? { value: `${TOKEN}-new` } : {}) },
    }) });

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(TOKEN);
    expect(core.getDb().prepare("SELECT * FROM vault_items").all()).toEqual(before);
    const read = await request("", { principal: "recent" });
    expect((await read.json()).data.config).toEqual(validConfig());
  });

  it("fails closed when the operator route inventory is writable by other users", async () => {
    chmodSync(routesFile, 0o666);
    try {
      const response = await request("", { principal: "recent" });
      expect(response.status).toBe(200);
      expect((await response.json()).data).toMatchObject({
        desired: { configuration: "invalid" },
        inventory: { status: "invalid" },
      });
    } finally {
      chmodSync(routesFile, 0o600);
    }
  });

  it("does not persist config or token changes if disabling the connector fails", async () => {
    await request("", { method: "PUT", principal: "recent", body: JSON.stringify({
      config: validConfig(), token: { action: "replace", value: TOKEN },
    }) });
    const before = core.getDb().prepare("SELECT * FROM vault_items").all();
    connectorPresent = true;
    connectorState = "RUNNING";
    rejectSupervisorStop = true;

    const response = await request("", { method: "PUT", principal: "recent", body: JSON.stringify({
      config: validConfig(false), token: { action: "clear" },
    }) });

    expect(response.status).toBe(503);
    expect(core.getDb().prepare("SELECT * FROM vault_items").all()).toEqual(before);
    const read = await request("", { principal: "recent" });
    expect((await read.json()).data.config).toEqual(validConfig());
  });

  it.each(["invalid", "sealed"])("rejects an %s token operation before stopping a running connector", async (state) => {
    await request("", { method: "PUT", principal: "recent", body: JSON.stringify({
      config: validConfig(), token: { action: "replace", value: TOKEN },
    }) });
    connectorPresent = true;
    connectorState = "RUNNING";
    if (state === "sealed") core.vault.sealVault();
    const response = await request("", { method: "PUT", principal: "recent", body: JSON.stringify({
      config: validConfig(false), token: { action: "replace", value: state === "invalid" ? "short" : TOKEN },
    }) });
    expect(response.status).toBe(state === "invalid" ? 422 : 409);
    expect(supervisorRequests.some((body) => body.includes("supervisor.stopProcess"))).toBe(false);
  });

  it("reports a missing connector honestly instead of claiming a connection", async () => {
    await request("", { method: "PUT", principal: "recent", body: JSON.stringify({ config: validConfig(), token: { action: "replace", value: TOKEN } }) });

    const response = await request("/connect", { method: "POST", principal: "recent" });

    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("CLOUDFLARE_CONNECTOR_UNAVAILABLE");
    expect(supervisorRequests.some((body) => body.includes("supervisor.startProcess"))).toBe(false);
  });

  it("reports stale or unreadable supervisor evidence as unavailable", async () => {
    malformedSupervisorResponse = true;

    const response = await request("", { principal: "recent" });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      desired: { enabled: false },
      connector: { state: "unavailable" },
    });
  });

  it("probes all five selected public HTTPS origins without credentials or redirects", async () => {
    await request("", { method: "PUT", principal: "recent", body: JSON.stringify({
      config: validConfig(), token: { action: "replace", value: TOKEN },
    }) });
    expect(core.safeEndpointFetch).not.toHaveBeenCalled();
    connectorPresent = true;
    connectorState = "RUNNING";
    vi.mocked(core.safeEndpointFetch).mockImplementation(async (url) => {
      if (url.includes("cli.")) throw new Error("DNS or TLS failure");
      return new Response(null, { status: url.includes("vscode.") ? 502 : url.includes("api.") ? 403 : 200 });
    });

    const response = await request("", { principal: "recent" });
    const { data } = await response.json();
    expect(data.routes.map(({ health }: { health: string }) => health)).toEqual([
      "reachable", "reachable", "unavailable", "unavailable", "reachable",
    ]);
    expect(core.safeEndpointFetch).toHaveBeenCalledTimes(5);
    for (const service of core.cloudflareTunnel.CLOUDFLARE_SERVICE_IDS) {
      expect(core.safeEndpointFetch).toHaveBeenCalledWith(`https://${service}.example.com/`, {
        method: "HEAD", credentials: "omit", redirect: "error",
      }, expect.objectContaining({
        allowPrivateNetwork: false, allowedProtocols: ["https:"], allowedPorts: [443],
        maxRedirects: 0, maxResponseBodyBytes: 1_048_576, timeoutMs: 3_000,
      }));
    }
  });

  it.each(["disabled", "sealed", "invalid inventory"])("does not probe routes with %s state", async (state) => {
    const config = validConfig();
    if (state === "disabled") config.services.dashboard.enabled = false;
    await request("", { method: "PUT", principal: "recent", body: JSON.stringify({
      config, token: { action: "replace", value: TOKEN },
    }) });
    connectorPresent = true;
    connectorState = "RUNNING";
    if (state === "sealed") core.vault.sealVault();
    if (state === "invalid inventory") chmodSync(routesFile, 0o666);
    try {
      const response = await request("", { principal: "recent" });
      expect((await response.json()).data.routes[0].health).toBe(state === "disabled" ? "disabled" : "blocked");
      expect(core.safeEndpointFetch).toHaveBeenCalledTimes(state === "disabled" ? 4 : 0);
    } finally {
      chmodSync(routesFile, 0o600);
    }
  });

  it.each(["timeout", "redirect", "private_address"] as const)("reports %s probe rejection as unavailable", async (code) => {
    await request("", { method: "PUT", principal: "recent", body: JSON.stringify({
      config: validConfig(), token: { action: "replace", value: TOKEN },
    }) });
    connectorPresent = true;
    connectorState = "RUNNING";
    vi.mocked(core.safeEndpointFetch).mockRejectedValue(new core.EndpointPolicyError(code, "probe rejected"));
    const response = await request("", { principal: "recent" });
    expect((await response.json()).data.routes.every(({ health }: { health: string }) => health === "unavailable")).toBe(true);
  });

  it("uses only the fixed supervisor connector action when the runtime adapter exists", async () => {
    connectorPresent = true;
    await request("", { method: "PUT", principal: "recent", body: JSON.stringify({ config: validConfig(), token: { action: "replace", value: TOKEN } }) });

    const connected = await request("/connect", { method: "POST", principal: "recent" });
    expect(connected.status).toBe(200);
    const connectedData = (await connected.json()).data;
    expect(connectedData).toMatchObject({ connector: { state: "running" } });
    expect(connectedData.routes.map(({ health }: { health: string }) => health)).toEqual(Array(5).fill("reachable"));
    expect(supervisorRequests).toContainEqual(expect.stringContaining("<string>cloudflare-tunnel</string>"));
    expect(supervisorRequests.join("\n")).not.toContain(TOKEN);
    expect(existsSync(credentialHandoffFile)).toBe(false);

    const disconnected = await request("/disconnect", { method: "POST", principal: "recent" });
    expect(disconnected.status).toBe(200);
    expect((await disconnected.json()).data).toMatchObject({ connector: { state: "stopped" } });
  });
});
