import { afterEach, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseInitProjectArgs } from "./scripts/init-project.js";
import { resolveExtensionProject } from "./project-resolver.js";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = resolve(extensionRoot, "../..");
const dockerfilePath = join(repositoryRoot, "Dockerfile");
const tscPath = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const temporaryDirectories: string[] = [];
const originalProject = process.env.INGENIUM_PROJECT;
const originalToken = process.env.INGENIUM_API_TOKEN;
const originalTokenFile = process.env.INGENIUM_API_TOKEN_FILE;
const configuredPluginPaths = [
  "packages/ingenium-extension/auto-observer.ts",
  "packages/ingenium-extension/observer.ts",
  "packages/ingenium-extension/resource-sync.ts",
];

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
  return outputDirectory;
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
  for (const pluginPath of configuredPluginPaths) {
    const target = join(worktree, pluginPath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(repositoryRoot, pluginPath), target);
    expect(readFileSync(target, "utf8")).toBe(readFileSync(join(repositoryRoot, pluginPath), "utf8"));
  }
  return worktree;
}

function writeProtectedFallbackToken(worktree: string, token: string): void {
  const directory = join(worktree, ".opencode");
  mkdirSync(directory, { recursive: true });
  const tokenPath = join(directory, ".ingenium-api-token");
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
  if (originalToken === undefined) delete process.env.INGENIUM_API_TOKEN;
  else process.env.INGENIUM_API_TOKEN = originalToken;
  if (originalTokenFile === undefined) delete process.env.INGENIUM_API_TOKEN_FILE;
  else process.env.INGENIUM_API_TOKEN_FILE = originalTokenFile;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("ingenium-init-project production runtime contract", () => {
  it("publishes the package bin and installs a stable runtime command without node_modules/.bin", () => {
    const packageJson = JSON.parse(readFileSync(join(extensionRoot, "package.json"), "utf8")) as {
      bin?: Record<string, string>;
    };
    const dockerfile = readFileSync(dockerfilePath, "utf8");

    expect(packageJson.bin?.["ingenium-init-project"]).toBe("./dist/scripts/init-project.js");
    expect(dockerfile).toContain("/app/packages/ingenium-extension/dist ./packages/ingenium-extension/dist");
    expect(dockerfile).toContain("/usr/local/bin/ingenium-init-project");
    expect(dockerfile).toContain("/usr/local/bin/ingenium-init-project --help");
    expect(dockerfile).not.toContain("/app/node_modules/.bin/ingenium-init-project");
    for (const pluginPath of configuredPluginPaths) {
      expect(dockerfile).toContain(`/app/${pluginPath} ./${pluginPath}`);
    }
    expect(dockerfile).toContain(`"plugin":[${configuredPluginPaths.map((pluginPath) => JSON.stringify(pluginPath)).join(",")}]`);
    expect(dockerfile).not.toContain("packages/ingenium-extension/dist/auto-observer.js");
  });

  it("builds the CLI distribution and executes --help through a runtime symlink", async () => {
    const distribution = buildCliDistribution();
    const entrypoint = join(distribution, "scripts", "init-project.js");
    const command = createRuntimeSymlink(entrypoint);

    expect(existsSync(entrypoint)).toBe(true);
    const result = await executeCli(command, ["--help"], { ...process.env }, true);

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--project <name>");
  });

  it("uses --project before INGENIUM_PROJECT for a dry-run preflight without provisioning", async () => {
    const distribution = buildCliDistribution();
    const entrypoint = join(distribution, "scripts", "init-project.js");
    const command = createRuntimeSymlink(entrypoint);
    const worktree = temporaryDirectory("ingenium-init-project-worktree-");
    mkdirSync(join(worktree, "docs"), { recursive: true });
    writeFileSync(join(worktree, "docs", "index.md"), "# Runtime CLI fixture\n", "utf8");
    const requests: Array<{ url: string; method: string }> = [];
    const server = createServer((request, response) => {
      requests.push({ url: request.url ?? "", method: request.method ?? "" });
      response.writeHead(200, { "Content-Type": "application/json" });
      if (request.url?.startsWith("/api/v1/repository/resources/sync")) {
        response.end(JSON.stringify({ data: { summary: {
          skill: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
          agent: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
          plugin: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 0 },
        } } }));
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
          INGENIUM_PROJECT: "environment-project",
          INGENIUM_WORKTREE: worktree,
        },
        true,
      );

      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ project: "ingenium", dryRun: true, scope: "all" });
      expect(requests).toEqual([
        { method: "GET", url: "/api/v1/auth/preflight" },
        { method: "POST", url: "/api/v1/docs/repository/sync?project=ingenium" },
        { method: "POST", url: "/api/v1/repository/resources/sync?project=ingenium" },
      ]);
      expect(existsSync(join(worktree, ".opencode", ".ingenium-sync-state.json"))).toBe(false);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  });

  it("fails closed at packaged CLI authentication preflight before provisioning or projection", async () => {
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
        INGENIUM_WORKTREE: worktree,
      };
      delete environment.INGENIUM_API_TOKEN;
      delete environment.INGENIUM_API_TOKEN_FILE;
      const result = await executeCli(command, ["--apply", "--project", "denied-project"], environment, true);

      expect(result.code).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Unable to authenticate with Ingenium API\n");
      expect(result.stderr).not.toContain("http://");
      expect(requests).toEqual([
        { method: "GET", url: "/api/v1/auth/preflight", sentBearer: false },
      ]);
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }
  });

  it("runs the built runtime CLI against packaged canonical scanner artifacts", async () => {
    const distribution = buildCliDistribution();
    const entrypoint = join(distribution, "scripts", "init-project.js");
    const command = createRuntimeSymlink(entrypoint);
    const worktree = createRuntimeWorktree();
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({ url: request.url ?? "", method: request.method ?? "", body: Buffer.concat(chunks).toString("utf8") });
        response.writeHead(200, { "Content-Type": "application/json" });
        if (request.url?.startsWith("/api/v1/repository/resources/sync")) {
          response.end(JSON.stringify({ data: { summary: {
            skill: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 10 },
            agent: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 11 },
            plugin: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 3 },
          } } }));
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
          INGENIUM_WORKTREE: worktree,
        },
        true,
      );

      expect(result.code, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ project: "ingenium", dryRun: true, scope: "all" });
      expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
        { method: "GET", url: "/api/v1/auth/preflight" },
        { method: "POST", url: "/api/v1/docs/repository/sync?project=ingenium" },
        { method: "POST", url: "/api/v1/repository/resources/sync?project=ingenium" },
      ]);

      const payload = JSON.parse(requests[2]!.body) as { manifest: {
        skills: Array<{ path: string }>;
        agents: Array<{ path: string; name: string }>;
        plugins: Array<{ path: string; source: string }>;
      } };
      expect(payload.manifest.skills).toHaveLength(10);
      expect(payload.manifest.skills.every((entry) => /\.opencode\/skills\/[^/]+\/SKILL\.md$/.test(entry.path))).toBe(true);
      expect(payload.manifest.agents.map((entry) => entry.path)).not.toContain(".opencode/agents/browser-agent-errors.md");
      expect(payload.manifest.plugins.map((entry) => entry.path)).toEqual(configuredPluginPaths);
      for (const plugin of payload.manifest.plugins) {
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
      response.writeHead(200, { "Content-Type": "application/json" });
      if (request.url === "/api/v1/auth/preflight") {
        response.end(JSON.stringify({ data: { authenticated: true } }));
        return;
      }
      if (request.url?.startsWith("/api/v1/repository/resources/sync")) {
        response.end(JSON.stringify({ data: { summary: {
          skill: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 10 },
          agent: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 11 },
          plugin: { created: 0, updated: 0, renamed: 0, archived: 0, removed: 0, unchanged: 3 },
        } } }));
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
        INGENIUM_WORKTREE: worktree,
      };
      delete environment.INGENIUM_API_TOKEN;
      delete environment.INGENIUM_API_TOKEN_FILE;
      const result = await executeCli(command, ["--apply", "--project", "packaged-plugin-project"], environment, true);

      expect(result.code, result.stderr).toBe(0);
      expect(result.stdout).not.toContain(token);
      expect(result.stderr).not.toContain(token);
      expect(requests).toEqual([
        { method: "GET", url: "/api/v1/auth/preflight", authenticated: true },
        { method: "POST", url: "/api/v1/projects", authenticated: true },
        { method: "POST", url: "/api/v1/docs/repository/sync?project=packaged-plugin-project", authenticated: true },
        { method: "POST", url: "/api/v1/repository/resources/sync?project=packaged-plugin-project", authenticated: true },
      ]);
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
