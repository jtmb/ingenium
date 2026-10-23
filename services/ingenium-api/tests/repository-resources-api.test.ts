import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import express from "express";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { getDb, MAX_ATTACHMENT_SIZE, projects, resetDbForTest } from "ingenium-core";
import { repositoryRouter } from "../lib/routes/repository.js";
import { errorHandler } from "../lib/middleware/errors.js";
import {
  createRepositorySyncIngress,
  isExactRepositorySyncRequest,
  REPOSITORY_SYNC_BODY_LIMIT,
  REPOSITORY_SYNC_PATH,
  repositorySyncContentTypeGate,
} from "../lib/middleware/repository-sync-ingress.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const directory = mkdtempSync(join(tmpdir(), "ingenium-repository-resources-api-"));
const projectName = "repository-resources-api";
let server: Server;
let baseUrl: string;
let projectId: string;
let ordinaryRouteReached = false;
let defaultJsonParserCalls = 0;
let urlencodedParserCalls = 0;
let repositoryParserCalls = 0;
let abortObserved: (() => void) | undefined;
let activeHold: { started: () => void; release: Promise<void> } | undefined;
const binding = {
  workspaceId: "repository-api-workspace",
  launcherWorktree: "/fixtures/repository-api",
  storageMappingHash: createHash("sha256").update("repository-api-binding").digest("hex"),
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function entry<T extends Record<string, unknown>>(identity: string, semantic: T): T & { identity: string; sha256: string } {
  return { identity, sha256: createHash("sha256").update(stable(semantic)).digest("hex"), ...semantic };
}

function manifest() {
  const skill = entry("skill:api", {
    path: ".opencode/skills/api-skill/SKILL.md", name: "api-skill",
    skillMd: "---\nname: api-skill\ndescription: \"API\"\n---\n\nBody\n", body: "Body\n", description: "API",
    category: "workflow", tags: ["api"], alwaysApply: false, metadata: { tags: ["api"] }, fileTree: {},
  });
  const agent = entry("agent:api", {
    path: ".opencode/agents/chat/api-agent.md", name: "api-agent", category: "chat",
    frontmatter: "name: api-agent\ndescription: \"API agent\"", body: "Body\n", description: "API agent", mode: "subagent",
    permissions: { read: "allow" }, metadata: { hidden: true }, skills: [], mirrors: [], enabled: true,
  });
  const plugin = entry("plugin:api", {
    path: ".opencode/plugins/api-plugin.ts", name: "api-plugin", source: "export {};\n", fileType: "regular", isSymlink: false, enabled: true, order: 0, options: {},
  });
  return { version: 2, skills: [skill], agents: [agent], plugins: [plugin] };
}

async function request(body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}/api/v1/repository/resources/sync?project=${projectName}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

function armHold(): { started: Promise<void>; release: () => void } {
  let markStarted!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  activeHold = { started: markStarted, release: released };
  return { started, release };
}

async function postExact(body: string, mode?: "hold" | "success"): Promise<Response> {
  return fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(mode ? { "x-test-ingress": mode } : {}) },
    body,
  });
}

async function rawPostExact(headers: Record<string, string>, body = "{}"): Promise<{
  status: number;
  headers: Headers;
  body: any;
}> {
  const endpoint = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      hostname: endpoint.hostname,
      port: Number(endpoint.port),
      path: `${REPOSITORY_SYNC_PATH}?project=${projectName}`,
      method: "POST",
      headers,
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode ?? 0,
        headers: new Headers(Object.entries(res.headers).flatMap(([key, value]) => value === undefined
          ? []
          : [[key, Array.isArray(value) ? value.join(", ") : value]])),
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function proveSingleSlotAvailable(): Promise<void> {
  const hold = armHold();
  const held = postExact("{}", "hold");
  await hold.started;
  const concurrent = await postExact("{}", "success");
  expect(concurrent.status).toBe(429);
  expect(concurrent.headers.get("retry-after")).toBe("1");
  expect(await concurrent.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  hold.release();
  expect((await held).status).toBe(200);
}

async function abortExactRequest(): Promise<void> {
  const endpoint = new URL(baseUrl);
  const observed = new Promise<void>((resolve) => { abortObserved = resolve; });
  await new Promise<void>((resolve) => {
    const req = httpRequest({
      hostname: endpoint.hostname,
      port: Number(endpoint.port),
      path: `${REPOSITORY_SYNC_PATH}?project=${projectName}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "1024" },
    });
    req.on("error", () => resolve());
    req.on("close", () => resolve());
    req.write('{"docsManifest":', () => req.destroy());
  });
  await observed;
  abortObserved = undefined;
}

beforeAll(async () => {
  process.env.INGENIUM_HOME = join(directory, "home");
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  projectId = projects.createProject(projectName).id;
  const app = express();
  app.use(repositorySyncContentTypeGate);
  const defaultJsonParser = express.json({ limit: "2mb" });
  app.use((req, res, next) => {
    if (isExactRepositorySyncRequest(req)) {
      next();
      return;
    }
    defaultJsonParserCalls += 1;
    defaultJsonParser(req, res, next);
  });
  const urlencodedParser = express.urlencoded({ limit: `${Math.round(MAX_ATTACHMENT_SIZE / (1024 * 1024))}mb`, extended: true });
  app.use((req, res, next) => {
    urlencodedParserCalls += 1;
    urlencodedParser(req, res, next);
  });
  app.use((req, _res, next) => {
    (req as any).principal = {
      type: "service",
      id: "repository-sync-principal",
      scopes: ["projects:read", "repository:sync"],
      tokenId: "repository-sync-token",
      organizationId: "repository-sync-organization",
      projectId: req.get("x-test-wrong-project") === "1" ? "wrong-project" : projectId,
      projectIds: [projectId],
      audience: "repository-sync",
      ...binding,
      workspaceId: req.get("x-test-workspace") ?? binding.workspaceId,
    };
    next();
  });
  const parser = express.json({ limit: REPOSITORY_SYNC_BODY_LIMIT });
  app.use(createRepositorySyncIngress((req, res, next) => {
    repositoryParserCalls += 1;
    parser(req, res, (error?: unknown) => {
      if ((error as { type?: unknown } | undefined)?.type === "request.aborted") abortObserved?.();
      next(error);
    });
  }));
  app.post(REPOSITORY_SYNC_PATH, (req, res, next) => {
    const mode = req.get("x-test-ingress");
    if (mode === "success") {
      res.json({ parsed: true });
      return;
    }
    if (mode === "hold" && activeHold) {
      const hold = activeHold;
      activeHold = undefined;
      hold.started();
      void hold.release.then(() => res.json({ parsed: true }));
      return;
    }
    next();
  });
  app.post("/api/v1/ordinary", (_req, res) => {
    ordinaryRouteReached = true;
    res.json({ parsed: true });
  });
  app.post(`${REPOSITORY_SYNC_PATH}-near`, (req, res) => res.json({ parsed: req.body }));
  app.use("/api/v1/repository", repositoryRouter);
  app.use(errorHandler);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterAll(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  delete process.env.INGENIUM_HOME;
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("repository resources sync API", () => {
  it("accepts a bounded combined repository projection above the default API limit", async () => {
    const content = "x".repeat(450_000);
    const docsManifest = {
      files: Array.from({ length: 3 }, (_, index) => ({
        path: `docs/large-${index}.md`,
        content,
        sha256: createHash("sha256").update(content).digest("hex"),
        fileType: "regular",
        isSymlink: false,
      })),
    };
    const source = "x".repeat(200_000);
    const plugins = Array.from({ length: 4 }, (_, index) => entry(`plugin:large-${index}`, {
      path: `.opencode/plugins/large-${index}.ts`, name: `large-${index}`, source,
      fileType: "regular", isSymlink: false, enabled: true, order: index, options: {},
    }));
    const body = {
      docsManifest,
      resourcesManifest: { version: 2, skills: [], agents: [], plugins },
      dryRun: true,
      expectedGeneration: 0,
    };
    const serialized = JSON.stringify(body);
    expect(Buffer.byteLength(serialized)).toBeGreaterThan(2 * 1024 * 1024);

    const response = await fetch(`${baseUrl}/api/v1/repository/sync?project=${projectName}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: serialized,
    });
    expect(response.status, await response.text()).toBe(200);

    const ordinary = await fetch(`${baseUrl}/api/v1/ordinary`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: "x".repeat(2_100_000) }),
    });
    expect(ordinary.ok).toBe(false);
    expect(ordinaryRouteReached).toBe(false);
  });

  it("keeps the exact parser behind auth, authorization, and rate limiting and executes it once", async () => {
    const source = readFileSync(new URL("../scripts/api-server.ts", import.meta.url), "utf8");
    const mediaGate = source.indexOf("app.use(repositorySyncContentTypeGate);");
    expect(mediaGate).toBeLessThan(source.indexOf("const defaultJsonParser"));
    expect(mediaGate).toBeLessThan(source.indexOf("app.use(express.urlencoded"));
    const ingress = source.indexOf("app.use(createRepositorySyncIngress());");
    for (const middleware of [
      "app.use(rateLimit);",
      "app.use(authMiddleware);",
      "app.use(authorizationMiddleware);",
      "app.use(recordCoordinationAttestationFailure);",
    ]) expect(source.indexOf(middleware)).toBeLessThan(ingress);

    const before = repositoryParserCalls;
    expect((await postExact("{}", "success")).status).toBe(200);
    expect(repositoryParserCalls - before).toBe(1);
  });

  it("rejects unsupported exact-route media and encodings before every parser and semaphore", async () => {
    const before = {
      json: defaultJsonParserCalls,
      urlencoded: urlencodedParserCalls,
      repository: repositoryParserCalls,
    };
    const largeForm = `payload=${"x".repeat(2_100_000)}`;
    const requests = [
      rawPostExact({ "Content-Length": "2" }),
      fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: largeForm,
      }),
      fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Encoding": "gzip" },
        body: gzipSync(Buffer.from(largeForm)),
      }),
      fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=fixture" }, body: "--fixture--",
      }),
      fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}",
      }),
      fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": "application/json; charset=latin1" }, body: "{}",
      }),
      fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": "application/json; charset=utf-8; profile=fixture" }, body: "{}",
      }),
      fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" }, body: gzipSync(Buffer.from("{}")),
      }),
      fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": "application/json", "Content-Transfer-Encoding": "base64" }, body: "e30=",
      }),
      rawPostExact({ "Content-Type": "application/json", "Transfer-Encoding": "chunked" }),
    ];
    for (const pending of requests) {
      const response = await pending;
      expect(response.status).toBe(415);
      expect(response.headers.get("content-type")).toContain("application/json");
      const body = response instanceof Response ? await response.json() : response.body;
      expect(body).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });
    }
    expect({
      json: defaultJsonParserCalls,
      urlencoded: urlencodedParserCalls,
      repository: repositoryParserCalls,
    }).toEqual(before);
    await proveSingleSlotAvailable();
  });

  it("accepts valid JSON media variants and leaves near routes on existing parsers", async () => {
    for (const contentType of ["application/json", "Application/JSON; Charset=UTF-8", 'application/json; charset="utf-8"']) {
      const response = await fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": contentType, "x-test-ingress": "success" }, body: "{}",
      });
      expect(response.status).toBe(200);
    }
    const identity = await fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Encoding": "identity", "x-test-ingress": "success" },
      body: "{}",
    });
    expect(identity.status).toBe(200);

    const beforeRepository = repositoryParserCalls;
    const near = await fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}-near?project=${projectName}`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "value=parsed",
    });
    expect(near.status).toBe(200);
    expect(await near.json()).toEqual({ parsed: { value: "parsed" } });
    expect(repositoryParserCalls).toBe(beforeRepository);
  });

  it("sanitizes malformed, compressed oversized, exact-limit, deep, and high-cardinality bodies", async () => {
    const malformed = await postExact("{");
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: { code: "MALFORMED_JSON" } });

    const prefix = '{"docsManifest":{"files":[],"padding":"';
    const suffix = '"},"resourcesManifest":{"version":2,"skills":[],"agents":[],"plugins":[]},"dryRun":true,"expectedGeneration":0}';
    const exactBody = `${prefix}${"x".repeat(REPOSITORY_SYNC_BODY_LIMIT - prefix.length - suffix.length)}${suffix}`;
    expect(Buffer.byteLength(exactBody)).toBe(REPOSITORY_SYNC_BODY_LIMIT);
    const exact = await postExact(exactBody);
    expect(exact.status).toBe(400);
    expect(await exact.json()).toMatchObject({ error: { code: "INVALID_REPOSITORY_SYNC" } });

    const oversizedBody = `${exactBody} `;
    const oversized = await postExact(oversizedBody);
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });

    const compressed = await fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
      body: gzipSync(Buffer.from(oversizedBody)),
    });
    expect(compressed.status).toBe(415);
    expect(await compressed.json()).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });

    const unsupported = await fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Encoding": "unsupported" },
      body: "{}",
    });
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toMatchObject({ error: { code: "UNSUPPORTED_MEDIA_TYPE" } });

    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 18; depth += 1) nested = { nested };
    const deep = await postExact(JSON.stringify({
      docsManifest: { files: [] }, resourcesManifest: { version: 2, skills: [], agents: [], plugins: [], nested },
      dryRun: true, expectedGeneration: 0,
    }));
    expect(deep.status).toBe(400);
    expect(await deep.json()).toMatchObject({ error: { code: "INVALID_REPOSITORY_SYNC" } });

    const cardinality = await postExact(JSON.stringify({
      docsManifest: { files: [] }, resourcesManifest: { version: 2, skills: Array(513).fill(null), agents: [], plugins: [] },
      dryRun: true, expectedGeneration: 0,
    }));
    expect(cardinality.status).toBe(400);
    expect(await cardinality.json()).toMatchObject({ error: { code: "INVALID_REPOSITORY_SYNC" } });
  });

  it("keeps near paths and methods on the 2 MiB parser", async () => {
    const body = JSON.stringify({ content: "x".repeat(2_100_000) });
    const before = repositoryParserCalls;
    for (const [method, path] of [
      ["POST", `${REPOSITORY_SYNC_PATH}/`],
      ["POST", "/api/v1/repository/%73ync"],
      ["POST", "/api/v1/repository//sync"],
      ["POST", `${REPOSITORY_SYNC_PATH}-near`],
      ["PUT", REPOSITORY_SYNC_PATH],
    ]) {
      const response = await fetch(`${baseUrl}${path}?project=${projectName}`, {
        method, headers: { "Content-Type": "application/json" }, body,
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
    }
    expect(repositoryParserCalls).toBe(before);
  });

  it("releases the single slot exactly once after success, parser error, and abort", async () => {
    await proveSingleSlotAvailable();
    await proveSingleSlotAvailable();

    expect((await postExact("{")).status).toBe(400);
    await proveSingleSlotAvailable();

    await abortExactRequest();
    await proveSingleSlotAvailable();
  });

  it("denies the legacy split endpoint without mutating repository rows", async () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const before = db.prepare("SELECT COUNT(*) AS count FROM skills WHERE project_id = ?").get(projectId);
    for (const payload of [
      { manifest: manifest(), dryRun: false },
      { manifest: manifest(), dryRun: false, expectedGeneration: 0, claim: { accepted_epoch: 1, fence: 0 } },
    ]) {
      expect(await request(payload)).toEqual({
        status: 409,
        body: {
          error: {
            code: "REPOSITORY_SYNC_ENDPOINT_REQUIRED",
            message: "Use the repository synchronization endpoint",
          },
        },
      });
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM skills WHERE project_id = ?").get(projectId)).toEqual(before);
  });

  it("atomically applies one principal-bound generation and returns its bounded stale generation", async () => {
    const body = { docsManifest: { files: [] }, resourcesManifest: { version: 2, skills: [], agents: [], plugins: [] }, dryRun: false, expectedGeneration: 0 };
    const response = await fetch(`${baseUrl}/api/v1/repository/sync?project=${projectName}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const applied = await response.json();
    expect(response.status, JSON.stringify(applied)).toBe(200);
    expect(applied.data).toMatchObject({ dryRun: false, generation: 1, manifestHash: expect.stringMatching(/^[0-9a-f]{64}$/) });

    const stale = await fetch(`${baseUrl}/api/v1/repository/sync?project=${projectName}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatchObject({ code: "MANIFEST_GENERATION_CONFLICT", currentGeneration: 1 });
  });

  it("rejects a repository-sync principal bound to another project", async () => {
    const response = await fetch(`${baseUrl}/api/v1/repository/sync?project=${projectName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-wrong-project": "1" },
      body: JSON.stringify({ docsManifest: { files: [] }, dryRun: true, expectedGeneration: 0 }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Resource not found" } });
  });

  it("previews, applies, and reads back commands without drift and rejects stale or foreign submissions", async () => {
    const command = entry("command:api", {
      name: "check", path: ".opencode/commands/check.md", source: "Run $ARGUMENTS\n", fileType: "regular", isSymlink: false,
    });
    const content = "# Command sync fixture\n";
    const body = {
      docsManifest: { files: [{ path: "docs/commands.md", content, sha256: createHash("sha256").update(content).digest("hex"), fileType: "regular", isSymlink: false }] },
      resourcesManifest: { ...manifest(), commands: [command] }, expectedGeneration: 0, dryRun: true,
    };
    const post = async (input: unknown, headers: Record<string, string> = {}) => {
      const response = await fetch(`${baseUrl}${REPOSITORY_SYNC_PATH}?project=${projectName}`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-test-workspace": "command-workspace", ...headers }, body: JSON.stringify(input),
      });
      return { status: response.status, body: await response.json() };
    };
    const db = getDb();
    expect(await post(body)).toMatchObject({ status: 200, body: { data: { generation: 0, resources: { summary: { command: { created: 1 } } } } } });
    expect(db.prepare("SELECT * FROM commands WHERE project_id = ?").all(projectId)).toEqual([]);
    expect(await post({ ...body, dryRun: false })).toMatchObject({ status: 200, body: { data: { generation: 1, resources: { summary: { command: { created: 1 } }, confirmed: [
      expect.anything(), expect.anything(), expect.anything(), { type: "command", identity: command.identity, path: command.path, sha256: command.sha256 },
    ] } } } });
    const snapshot = () => ["commands", "skills", "agents", "plugins", "docs_pages"].map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
    const before = snapshot();
    expect(await post({ ...body, dryRun: false, expectedGeneration: 1 })).toMatchObject({ status: 200, body: { data: {
      generation: 2, docs: { summary: { unchanged: 1 } },
      resources: { summary: { command: { unchanged: 1 }, skill: { unchanged: 1 }, agent: { unchanged: 1 }, plugin: { unchanged: 1 } } },
    } } });
    expect(snapshot()).toEqual(before);
    expect(await post({ ...body, dryRun: false })).toMatchObject({ status: 409, body: { error: { code: "MANIFEST_GENERATION_CONFLICT", currentGeneration: 2 } } });
    expect(await post({ ...body, expectedGeneration: 2, dryRun: false, resourcesManifest: { ...body.resourcesManifest, commands: [{ ...command, source: "tampered" }] } }))
      .toMatchObject({ status: 422, body: { error: { code: "INVALID_REPOSITORY_SYNC" } } });
    expect(await post({ ...body, expectedGeneration: 2, worktreeId: `worktree-${"f".repeat(64)}` })).toMatchObject({ status: 422 });
    expect(await post({ ...body, dryRun: false }, { "x-test-wrong-project": "1" })).toMatchObject({ status: 404 });
    expect(await post(body, { "x-test-workspace": "independent-worktree" })).toMatchObject({ status: 200, body: { data: { generation: 0 } } });
    expect(snapshot()).toEqual(before);
  });
});
