import { afterEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { INIT_PROJECT_VERSION, parseInitProjectArgs } from "./scripts/init-project.js";
import { resolveExtensionProject } from "./project-resolver.js";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(extensionRoot, "../..");
const serverRoot = join(repositoryRoot, "services", "ingenium-server");
const dockerfilePath = join(repositoryRoot, "Dockerfile");
const runtimeLauncherPath = join(repositoryRoot, "scripts", "run-init-project.sh");
const tscPath = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const temporaryDirectories: string[] = [];
const originalProject = process.env.INGENIUM_PROJECT;
const originalToken = process.env.INGENIUM_MCP_CREDENTIAL;
const originalTokenFile = process.env.INGENIUM_MCP_CREDENTIAL_FILE;
const originalAudience = process.env.INGENIUM_MCP_AUDIENCE;
const originalWorkspace = process.env.INGENIUM_WORKSPACE_ID;
const storageMappingHash = "a".repeat(64);
const extensionPluginPaths = [
  "packages/ingenium-extension/plugins/auto-observer.ts",
  "packages/ingenium-extension/plugins/observer.ts",
  "packages/ingenium-extension/plugins/resource-sync.ts",
  "packages/ingenium-extension/plugins/lifecycle.ts",
];
const ponytailPluginPath = "packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs";
const configuredPluginPaths = [...extensionPluginPaths, ponytailPluginPath];
const manifestPluginPaths = [...configuredPluginPaths].sort();
const manifestHash = "b".repeat(64);

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function buildCliDistribution(): string {
  const outputDirectory = temporaryDirectory("ingenium-init-project-dist-");
  const build = spawnSync(
    process.execPath,
    [tscPath, "--project", "tsconfig.json", "--outDir", outputDirectory],
    { cwd: extensionRoot, encoding: "utf8", timeout: 60_000 },
  );
  const output = `${build.stdout}\n${build.stderr}`;
  expect(build.error, output).toBeUndefined();
  expect(build.status, output).toBe(0);
  const transportDirectory = temporaryDirectory("ingenium-init-project-transport-");
  const transportBuild = spawnSync(
    process.execPath,
    [tscPath, "--project", "tsconfig.json", "--outDir", transportDirectory],
    { cwd: serverRoot, encoding: "utf8", timeout: 60_000 },
  );
  const transportOutput = `${transportBuild.stdout}\n${transportBuild.stderr}`;
  expect(transportBuild.error, transportOutput).toBeUndefined();
  expect(transportBuild.status, transportOutput).toBe(0);
  cpSync(join(transportDirectory, "config"), join(outputDirectory, "config"), { recursive: true });
  cpSync(join(transportDirectory, "lib"), join(outputDirectory, "lib"), { recursive: true });
  copyFileSync(join(transportDirectory, "scripts", "mcp-server.js"), join(outputDirectory, "scripts", "mcp-transport.js"));
  symlinkSync(join(repositoryRoot, "node_modules"), join(outputDirectory, "node_modules"), "dir");
  return outputDirectory;
}

function handlesMcpControlRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
): boolean {
  const url = new URL(request.url ?? "/", "http://localhost");
  const project = url.searchParams.get("project") ?? "runtime-project";
  if (url.pathname === "/api/v1/mcp-tools") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ project, project_id: "runtime-project-id", data: [{
      category: "Repository",
      tools: ["repository_sync"].map((name) => ({
        tool_name: `ingenium_${name}`,
        enabled: true,
      })),
    }] }));
    return true;
  }
  const toolState = /^\/api\/v1\/mcp-tools\/(ingenium_repository_sync)\/state$/.exec(url.pathname);
  if (toolState) {
    const toolName = toolState[1]!;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ project, project_id: "runtime-project-id", data: {
      tool_name: toolName,
      enabled: true,
      authorization: {
        action: "repository.execute",
        resource: "repository",
        permission: "execute",
        target: "project",
        scopes: ["repository:sync"],
        launcherBinding: "required",
      },
    } }));
    return true;
  }
  return false;
}

function initializeGitWorktree(worktree: string): void {
  const initialized = spawnSync("git", ["init", "--quiet"], { cwd: worktree, encoding: "utf8", timeout: 10_000 });
  expect(initialized.error, initialized.stderr).toBeUndefined();
  expect(initialized.status, initialized.stderr).toBe(0);
}

function repositoryResponse(resources = true) {
  return { data: {
    dryRun: true,
    generation: 0,
    manifestHash,
    docs: { summary: { created: 0, updated: 0, renamed: 0, restored: 0, archived: 0, unchanged: 1 } },
    ...(resources ? { resources: { summary: {
      skill: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
      agent: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
      plugin: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
      command: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
    } } } : {}),
  } };
}

function createRuntimeSymlink(entrypoint: string): string {
  chmodSync(entrypoint, 0o555);
  const command = join(temporaryDirectory("ingenium-init-project-bin-"), "ingenium-init-project");
  symlinkSync(entrypoint, command);
  return command;
}

/** Recreate the repository-owned inputs available beside the packaged CLI. */
function createRuntimeWorktree(): string {
  const worktree = temporaryDirectory("ingenium-init-project-runtime-worktree-");
  copyFileSync(join(repositoryRoot, "opencode.json"), join(worktree, "opencode.json"));
  cpSync(join(repositoryRoot, ".opencode", "skills"), join(worktree, ".opencode", "skills"), { recursive: true });
  cpSync(join(repositoryRoot, ".opencode", "agents"), join(worktree, ".opencode", "agents"), { recursive: true });
  const agentsRoot = join(worktree, ".opencode", "agents");
  for (const path of readdirSync(agentsRoot, { recursive: true, encoding: "utf8" })) {
    if (path.endsWith(".md")) chmodSync(join(agentsRoot, path), 0o644);
  }
  writeFileSync(join(worktree, ".opencode", "agents", "sync-diagnostics.md"), "# Sync diagnostic\n", "utf8");
  for (const pluginPath of extensionPluginPaths) {
    const target = join(worktree, pluginPath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repositoryRoot, pluginPath), target);
    expect(readFileSync(target, "utf8")).toBe(readFileSync(join(repositoryRoot, pluginPath), "utf8"));
  }
  cpSync(join(repositoryRoot, "packages", "ingenium-extension", "ponytail"), join(worktree, "packages", "ingenium-extension", "ponytail"), { recursive: true });
  initializeGitWorktree(worktree);
  return worktree;
}

function writeProtectedFallbackToken(worktree: string, token: string): void {
  const directory = join(worktree, ".opencode");
  mkdirSync(directory, { recursive: true });
  const tokenPath = join(directory, ".ingenium-repository-sync-credential");
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  chmodSync(tokenPath, 0o600);
}

function executeCli(
  entrypoint: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  executeDirectly = false,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(executeDirectly ? entrypoint : process.execPath, executeDirectly ? args : [entrypoint, ...args], {
      cwd: extensionRoot,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", rejectResult);
    child.once("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

afterEach(() => {
  if (originalProject === undefined) delete process.env.INGENIUM_PROJECT;
  else process.env.INGENIUM_PROJECT = originalProject;
  if (originalToken === undefined) delete process.env.INGENIUM_MCP_CREDENTIAL;
  else process.env.INGENIUM_MCP_CREDENTIAL = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_MCP_CREDENTIAL_FILE;
  else process.env.INGENIUM_MCP_CREDENTIAL_FILE = originalTokenFile;
  if (originalAudience === undefined) delete process.env.INGENIUM_MCP_AUDIENCE;
  else process.env.INGENIUM_MCP_AUDIENCE = originalAudience;
  if (originalWorkspace === undefined) delete process.env.INGENIUM_WORKSPACE_ID;
  else process.env.INGENIUM_WORKSPACE_ID = originalWorkspace;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ingenium-init-project production runtime contract", () => {
  it("publishes the package bin and installs a stable runtime command without node_modules/.bin", () => {
    const packageJson = JSON.parse(readFileSync(join(extensionRoot, "package.json"), "utf8")) as {
      bin?: Record<string, string>;
      version?: string;
    };
    const dockerfile = readFileSync(dockerfilePath, "utf8");
    const runtimeLauncher = readFileSync(runtimeLauncherPath, "utf8");

    expect(packageJson.bin?.["ingenium-init-project"]).toBe("./dist/scripts/init-project.js");
    expect(INIT_PROJECT_VERSION).toBe(packageJson.version);
    expect(dockerfile).toContain("/app/packages/ingenium-extension/dist ./packages/ingenium-extension/dist");
    expect(dockerfile).toContain("/usr/local/bin/ingenium-init-project");
    expect(dockerfile).toContain("/usr/local/bin/ingenium-init-project --help");
    expect(dockerfile).toContain("/usr/local/bin/ingenium-init-project --version");
    expect(dockerfile).toContain("/app/scripts/run-init-project.sh)\" = \"root:root:555\"");
    expect(dockerfile).not.toContain("/app/node_modules/.bin/ingenium-init-project");
    expect(dockerfile).toContain("plugin-source-closure.mjs");
    expect(dockerfile).toContain("/tmp/ingenium-extension-plugin-sources ./packages/ingenium-extension");
    expect(dockerfile).toContain("smoke-opencode-plugin-load.mjs /app/packages/ingenium-extension /usr/local/bin/opencode");
    expect(dockerfile).not.toContain("/app/packages/ingenium-extension/skill-sync.ts ./packages/ingenium-extension/skill-sync.ts");
    expect(dockerfile).not.toContain("/app/packages/ingenium-extension/ponytail ./packages/ingenium-extension/ponytail");
    const configuredV2PluginPaths = [
      "auto-observer",
      "observer",
      "resource-sync",
      "lifecycle",
      "ponytail",
    ].map((name) => `/app/packages/ingenium-extension/plugins/v2/${name}`);
    expect(dockerfile).toContain(`"plugins":${JSON.stringify(configuredV2PluginPaths)}`);
    expect(dockerfile).not.toContain("packages/ingenium-extension/dist/auto-observer.js");
    expect(runtimeLauncher.indexOf("--help|--version)")).toBeLessThan(runtimeLauncher.indexOf("normalize-agent-profiles.sh"));
  });

  it("executes help and version without runtime binding or worktree side effects", async () => {
    const distribution = buildCliDistribution();
    const entrypoint = join(distribution, "scripts", "init-project.js");
    const command = createRuntimeSymlink(entrypoint);
    const worktree = temporaryDirectory("ingenium-init-project-info-");
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      INGENIUM_API_URL: "http://127.0.0.1:1/api/v1",
      INGENIUM_WORKTREE: worktree,
      INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/missing-credential",
      INGENIUM_MCP_AUDIENCE: "repository-sync",
      INGENIUM_WORKSPACE_ID: "missing-workspace",
    };
    delete environment.INGENIUM_MCP_CREDENTIAL;

    expect(existsSync(entrypoint)).toBe(true);
    const before = readdirSync(worktree);
    const help = await executeCli(command, ["--help"], environment, true);
    const version = await executeCli(command, ["--version"], environment, true);
    const invalid = await executeCli(command, ["--help", "--version"], environment, true);

    expect(help.code, help.stderr).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("Usage:");
    expect(help.stdout).toContain("--project <name>");
    expect(version).toEqual({ code: 0, stdout: `${INIT_PROJECT_VERSION}\n`, stderr: "" });
    expect(invalid.code).toBe(2);
    expect(invalid.stdout).toBe("");
    expect(invalid.stderr).toMatch(/cannot be combined with other arguments/);
    expect(readdirSync(worktree)).toEqual(before);
  });

  it("uses --project before INGENIUM_PROJECT and attests it through the packaged MCP launcher", async () => {
    const distribution = buildCliDistribution();
    const entrypoint = join(distribution, "scripts", "init-project.js");
    const command = createRuntimeSymlink(entrypoint);
    const worktree = temporaryDirectory("ingenium-init-project-worktree-");
    mkdirSync(join(worktree, "docs"), { recursive: true });
    writeFileSync(join(worktree, "docs", "index.md"), "# Runtime CLI fixture\n", "utf8");
    writeProtectedFallbackToken(worktree, "d".repeat(32));
    initializeGitWorktree(worktree);
    const requests: Array<{ url: string; method: string }> = [];
    const server = createServer((request, response) => {
      requests.push({ url: request.url ?? "", method: request.method ?? "" });
      if (handlesMcpControlRequest(request, response)) return;
      response.writeHead(200, { "Content-Type": "application/json" });
      if (request.url === "/api/v1/auth/preflight") {
        response.end(JSON.stringify({ data: {
          authenticated: true, scopes: ["projects:read", "repository:sync"], organizationId: "runtime-org-id",
          projectId: "runtime-project-id", projectIds: ["runtime-project-id"], audience: "repository-sync",
           workspaceId: "runtime-workspace", launcherWorktree: worktree, storageMappingHash, restartRequiredOnCredentialChange: true,
        } }));
        return;
      }
      if (request.url === "/api/v1/projects/ingenium/detail") {
        response.end(JSON.stringify({ data: { project: { id: "runtime-project-id" } } }));
        return;
      }
      if (request.url?.startsWith("/api/v1/repository/sync")) {
        response.end(JSON.stringify(repositoryResponse()));
        return;
      }
      response.end(JSON.stringify({ data: { summary: { created: 0, updated: 0, renamed: 0, restored: 0, archived: 0, unchanged: 1 } } }));
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to start init-project test API");
      const result = await executeCli(
        command,
        ["--dry-run", "--project", "ingenium"],
        {
          ...process.env,
          INGENIUM_API_URL: `http://127.0.0.1:${address.port}/api/v1`,
          INGENIUM_TRUSTED_API_URL: `http://127.0.0.1:${address.port}/api/v1`,
          INGENIUM_PROJECT: "environment-project",
          INGENIUM_WORKTREE: worktree,
          INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-repository-sync-credential",
          INGENIUM_MCP_AUDIENCE: "repository-sync",
          INGENIUM_WORKSPACE_ID: "runtime-workspace",
        },
        true,
      );

      expect(result.code, `${result.stderr}\n${result.stdout}\n${JSON.stringify(requests)}`).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ project: "ingenium", dryRun: true, scope: "all" });
      expect(requests.map(({ url }) => url)).toContain("/api/v1/repository/sync?project=ingenium");
      expect(requests.some(({ url }) => url.startsWith("/api/v1/coordination/"))).toBe(false);
      expect(requests.some(({ url }) => url.startsWith("/api/v1/docs/repository/sync"))).toBe(false);
      expect(requests.some(({ url }) => url.startsWith("/api/v1/repository/resources/sync"))).toBe(false);
      expect(existsSync(join(worktree, ".opencode", ".ingenium-sync-state.json"))).toBe(false);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  });

  it("fails closed for authentication without starting repository synchronization", async () => {
    const distribution = buildCliDistribution();
    const entrypoint = join(distribution, "scripts", "init-project.js");
    const command = createRuntimeSymlink(entrypoint);
    const worktree = temporaryDirectory("ingenium-init-project-auth-failure-");
    mkdirSync(join(worktree, "docs"), { recursive: true });
    writeFileSync(join(worktree, "docs", "index.md"), "# Auth fixture\n", "utf8");
    const requests: Array<{ url: string; method: string; sentBearer: boolean }> = [];
    const server = createServer((request, response) => {
      requests.push({
        url: request.url ?? "",
        method: request.method ?? "",
        sentBearer: request.headers.authorization !== undefined,
      });
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: { code: "UNAUTHORIZED", detail: "internal diagnostic" } }));
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to start denied init-project test API");
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        INGENIUM_API_URL: `http://127.0.0.1:${address.port}/api/v1`,
        INGENIUM_TRUSTED_API_URL: `http://127.0.0.1:${address.port}/api/v1`,
        INGENIUM_WORKTREE: worktree,
      };
      delete environment.INGENIUM_MCP_CREDENTIAL;
      delete environment.INGENIUM_MCP_CREDENTIAL_FILE;
      delete environment.INGENIUM_WORKSPACE_ID;
      const result = await executeCli(command, ["--apply", "--project", "denied-project"], environment, true);

      expect(result.code).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Unable to authenticate with Ingenium API\n");
      expect(result.stderr).not.toContain("http://");
      expect(requests).toEqual([]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }

  }, 30_000);

  it("runs the built runtime CLI against packaged canonical scanner artifacts", async () => {
    const distribution = buildCliDistribution();
    const entrypoint = join(distribution, "scripts", "init-project.js");
    const command = createRuntimeSymlink(entrypoint);
    const worktree = createRuntimeWorktree();
    mkdirSync(join(worktree, ".opencode/commands"), { recursive: true });
    writeFileSync(join(worktree, ".opencode/commands/check.md"), "Run $ARGUMENTS\n");
    writeProtectedFallbackToken(worktree, "c".repeat(32));
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({ url: request.url ?? "", method: request.method ?? "", body: Buffer.concat(chunks).toString("utf8") });
        if (handlesMcpControlRequest(request, response)) return;
        response.writeHead(200, { "Content-Type": "application/json" });
        if (request.url === "/api/v1/auth/preflight") {
          response.end(JSON.stringify({ data: {
            authenticated: true, scopes: ["projects:read", "repository:sync"], organizationId: "runtime-org-id",
            projectId: "runtime-project-id", projectIds: ["runtime-project-id"], audience: "repository-sync",
             workspaceId: "runtime-workspace", launcherWorktree: worktree, storageMappingHash, restartRequiredOnCredentialChange: true,
          } }));
          return;
        }
        if (request.url === "/api/v1/projects/ingenium/detail") {
          response.end(JSON.stringify({ data: { project: { id: "runtime-project-id" } } }));
          return;
        }
        if (request.url?.startsWith("/api/v1/repository/sync")) {
          response.end(JSON.stringify({ data: {
            dryRun: true,
            generation: 0,
            manifestHash,
            docs: { summary: { created: 0, updated: 0, renamed: 0, restored: 0, archived: 0, unchanged: 0 } },
            resources: { summary: {
            skill: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 8 },
            agent: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 11 },
            plugin: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 5 },
            command: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 1 },
          } } } }));
          return;
        }
        response.end(JSON.stringify({ data: { summary: { created: 0, updated: 0, renamed: 0, restored: 0, archived: 0, unchanged: 0 } } }));
      });
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to start init-project test API");
      const result = await executeCli(
        command,
        ["--dry-run", "--project", "ingenium"],
        {
          ...process.env,
          INGENIUM_API_URL: `http://127.0.0.1:${address.port}/api/v1`,
          INGENIUM_TRUSTED_API_URL: `http://127.0.0.1:${address.port}/api/v1`,
          INGENIUM_WORKTREE: worktree,
          INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-repository-sync-credential",
          INGENIUM_MCP_AUDIENCE: "repository-sync",
          INGENIUM_WORKSPACE_ID: "runtime-workspace",
        },
        true,
      );

      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ project: "ingenium", dryRun: true, scope: "all", commands: { skipped: 1 } });
      expect(requests.map(({ url }) => url)).toContain("/api/v1/repository/sync?project=ingenium");
      expect(requests.some(({ url }) => url.startsWith("/api/v1/coordination/"))).toBe(false);

      const resourceRequest = requests.find((request) => request.url === "/api/v1/repository/sync?project=ingenium");
      expect(resourceRequest).toBeDefined();
      const payload = JSON.parse(resourceRequest!.body) as { resourcesManifest: {
        skills: Array<{ path: string }>;
        agents: Array<{ path: string; name: string }>;
        plugins: Array<{ path: string; source: string }>;
        commands: Array<{ path: string; source: string }>;
      } };
      expect(payload.resourcesManifest.skills).toHaveLength(8);
      expect(payload.resourcesManifest.commands).toEqual([expect.objectContaining({ path: ".opencode/commands/check.md", source: "Run $ARGUMENTS\n" })]);
      expect(payload.resourcesManifest.skills.every((entry) => /\.opencode\/skills\/[^/]+\/SKILL\.md$/.test(entry.path))).toBe(true);
      expect(payload.resourcesManifest.agents).toHaveLength(11);
      expect(payload.resourcesManifest.agents.map((entry) => entry.path)).not.toContain(".opencode/agents/sync-diagnostics.md");
      expect(payload.resourcesManifest.agents.map((entry) => entry.name)).not.toContain("browser-agent");
      expect(payload.resourcesManifest.plugins.map((entry) => entry.path)).toEqual(manifestPluginPaths);
      for (const plugin of payload.resourcesManifest.plugins) {
        expect(plugin.source).toBe(readFileSync(join(repositoryRoot, plugin.path), "utf8"));
      }
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  });

  it("runs the packaged CLI preflight and project initialization through the protected fallback bearer", async () => {
    const distribution = buildCliDistribution();
    const entrypoint = join(distribution, "scripts", "init-project.js");
    const command = createRuntimeSymlink(entrypoint);
    const worktree = createRuntimeWorktree();
    const token = "p".repeat(32);
    writeProtectedFallbackToken(worktree, token);
    const requests: Array<{ url: string; method: string; authenticated: boolean }> = [];
    const server = createServer((request, response) => {
      const authenticated = request.headers.authorization === `Bearer ${token}`;
      requests.push({
        url: request.url ?? "",
        method: request.method ?? "",
        authenticated,
      });
      if (!authenticated) {
        response.writeHead(401, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { code: "UNAUTHORIZED" } }));
        return;
      }
      if (handlesMcpControlRequest(request, response)) return;
      response.writeHead(200, { "Content-Type": "application/json" });
      if (request.url === "/api/v1/auth/preflight") {
        response.end(JSON.stringify({ data: {
          authenticated: true, scopes: ["projects:read", "repository:sync"], organizationId: "runtime-org-id",
          projectId: "runtime-project-id", projectIds: ["runtime-project-id"], audience: "repository-sync",
           workspaceId: "runtime-workspace", launcherWorktree: worktree, storageMappingHash, restartRequiredOnCredentialChange: true,
        } }));
        return;
      }
      if (request.url === "/api/v1/projects/packaged-plugin-project/detail") {
        response.end(JSON.stringify({ data: { project: { id: "runtime-project-id" } } }));
        return;
      }
      if (request.url?.startsWith("/api/v1/repository/sync")) {
        response.end(JSON.stringify({ data: {
          dryRun: false,
          generation: 1,
          manifestHash,
          docs: { summary: { created: 0, updated: 0, renamed: 0, restored: 0, archived: 0, unchanged: 0 } },
          resources: { summary: {
          skill: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 10 },
          agent: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 15 },
            plugin: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 4 },
            command: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
        } } } }));
        return;
      }
      response.end(JSON.stringify({ data: { summary: { created: 0, updated: 0, renamed: 0, restored: 0, archived: 0, unchanged: 0 } } }));
    });
    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unable to start protected init-project test API");
      const environment: NodeJS.ProcessEnv = {
        ...process.env,
        INGENIUM_API_URL: `http://127.0.0.1:${address.port}/api/v1`,
        INGENIUM_TRUSTED_API_URL: `http://127.0.0.1:${address.port}/api/v1`,
        INGENIUM_WORKTREE: worktree,
        INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-repository-sync-credential",
        INGENIUM_MCP_AUDIENCE: "repository-sync",
        INGENIUM_WORKSPACE_ID: "runtime-workspace",
      };
      delete environment.INGENIUM_MCP_CREDENTIAL;
      const result = await executeCli(command, ["--apply", "--project", "packaged-plugin-project"], environment, true);

      expect(result.code, `${result.stderr}\n${result.stdout}\n${JSON.stringify(requests)}`).toBe(0);
      expect(result.stdout).not.toContain(token);
      expect(result.stderr).not.toContain(token);
      expect(requests.filter(({ url }) => url !== "/_ingenium/child-mcp-runtime?project=packaged-plugin-project")
        .every(({ authenticated }) => authenticated)).toBe(true);
      expect(requests).toEqual(expect.arrayContaining([
        expect.objectContaining({ method: "POST", url: "/api/v1/repository/sync?project=packaged-plugin-project", authenticated: true }),
      ]));
      expect(requests.some(({ url }) => url.startsWith("/api/v1/coordination/"))).toBe(false);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  });

  it("parses and validates the explicit project before falling back to environment or worktree identity", () => {
    process.env.INGENIUM_PROJECT = "environment-project";

    expect(parseInitProjectArgs(["--dry-run", "--project", "cli-project"])).toEqual({
      dryRun: true,
      scope: "all",
      project: "cli-project",
    });
    expect(resolveExtensionProject("/workspace", "cli-project")).toBe("cli-project");
    expect(() => parseInitProjectArgs(["--dry-run", "--project", "../unsafe"])).toThrow(/safe project name/);
    expect(() => parseInitProjectArgs(["--dry-run", "--project"])).toThrow(/requires a project name/);
  });
});
