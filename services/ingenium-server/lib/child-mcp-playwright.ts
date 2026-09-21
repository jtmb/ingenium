import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, mkdtemp, open, realpath, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import type { ChildMcpRuntimeDefinitionResponse } from "./child-mcp-gateway.js";
import type { LauncherAuthorizationBinding } from "./tool-state-gate.js";

export const PLAYWRIGHT_CHILD_MCP_BROWSER_PATH = "/opt/ingenium-playwright/chromium";
export const PLAYWRIGHT_CHILD_MCP_EXECUTABLE = "/app/node_modules/.bin/playwright-mcp";

export function resolveManagedPlaywright() {
  const require = createRequire(import.meta.url);
  const mcpEntry = require.resolve("@playwright/mcp");
  const mcpRequire = createRequire(mcpEntry);
  return {
    playwrightPath: mcpRequire.resolve("playwright"),
    cliPath: join(dirname(mcpRequire.resolve("playwright/package.json")), "cli.js"),
    executablePath: join(dirname(mcpEntry), "cli.js"),
    browserExecutablePath: (mcpRequire("playwright") as {
      chromium: { executablePath(): string };
    }).chromium.executablePath(),
  };
}

export const PLAYWRIGHT_CHILD_MCP_ARGS = [
  "--headless",
  "--browser=chromium",
  "--executable-path",
  PLAYWRIGHT_CHILD_MCP_BROWSER_PATH,
  "--isolated",
  "--caps=vision",
  "--block-service-workers",
  "--output-mode=file",
  "--output-max-size=52428800",
] as const;

export function isManagedPlaywrightDefinition(definition: ChildMcpRuntimeDefinitionResponse): boolean {
  return definition.name === "playwright"
    && definition.executable === PLAYWRIGHT_CHILD_MCP_EXECUTABLE
    && definition.scope === "project"
    && definition.owned
    && Object.keys(definition.environment ?? {}).length === 0
    && definition.args.length === PLAYWRIGHT_CHILD_MCP_ARGS.length
    && definition.args.every((argument, index) => argument === PLAYWRIGHT_CHILD_MCP_ARGS[index]);
}

function redact(value: unknown, outputDirectory: string): unknown {
  if (typeof value === "string") return value.replaceAll(outputDirectory, "[playwright-output]");
  if (Array.isArray(value)) return value.map((entry) => redact(entry, outputDirectory));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, redact(entry, outputDirectory)]),
  );
}

export class ManagedPlaywrightRuntime {
  private readonly records = new Map<string, {
    version: 1;
    serverName: string;
    ownerPid: number;
    project: string;
    projectId: string;
    organizationId: string;
    workspaceId: string;
    launcherWorktree: string;
    outputDirectory: string;
    createdAt: string;
    cancellationRequestedAt?: string;
    cleanedAt?: string;
  }>();

  constructor(
    private readonly browserExecutablePath = PLAYWRIGHT_CHILD_MCP_BROWSER_PATH,
    private readonly executablePath = PLAYWRIGHT_CHILD_MCP_EXECUTABLE,
    private readonly stateDirectory = join(process.env.INGENIUM_HOME ?? join(homedir(), ".ingenium"), "playwright-runtime"),
  ) {}

  private async writeRecord(directory: string, name: string, record: unknown): Promise<void> {
    const temporary = join(directory, `${name}.tmp`);
    const file = await open(temporary, "w", 0o600);
    try {
      await file.writeFile(JSON.stringify(record));
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, join(directory, name));
    const parent = await open(directory, "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  }

  async materialize(
    definition: ChildMcpRuntimeDefinitionResponse,
    binding: LauncherAuthorizationBinding | undefined,
    project: string,
  ): Promise<ChildMcpRuntimeDefinitionResponse> {
    if (definition.name !== "playwright") return definition;
    if (!isManagedPlaywrightDefinition(definition)) {
      throw new Error("PLAYWRIGHT_CHILD_MCP_DEFINITION_INVALID");
    }
    if (this.records.has(definition.name)) throw new Error("PLAYWRIGHT_CHILD_MCP_CLEANUP_REQUIRED");
    if (!binding
      || !binding.project
      || !binding.projectId
      || !binding.organizationId
      || !binding.workspaceId
      || !binding.launcherWorktree
      || binding.project !== project) {
      throw new Error("PLAYWRIGHT_CHILD_MCP_IDENTITY_REQUIRED");
    }
    try {
      await access(this.browserExecutablePath, constants.X_OK);
      const resolvedBrowserPath = await realpath(this.browserExecutablePath);
      if (!(await lstat(resolvedBrowserPath)).isFile()
        || (this.browserExecutablePath === PLAYWRIGHT_CHILD_MCP_BROWSER_PATH
          && !resolvedBrowserPath.startsWith("/opt/ingenium-playwright/browsers/"))) {
        throw new Error("unsafe browser path");
      }
    } catch {
      throw new Error("PLAYWRIGHT_CHILD_MCP_BROWSER_UNAVAILABLE");
    }

    const identity = createHash("sha256")
      .update(`${binding.organizationId}\0${binding.projectId}\0${binding.workspaceId}\0${binding.launcherWorktree}`)
      .digest("hex")
      .slice(0, 16);
    await mkdir(this.stateDirectory, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.stateDirectory, `${identity}-`));
    const outputDirectory = join(directory, "output");
    const record = {
      version: 1 as const,
      serverName: definition.name,
      ownerPid: process.pid,
      project,
      projectId: binding.projectId,
      organizationId: binding.organizationId,
      workspaceId: binding.workspaceId,
      launcherWorktree: binding.launcherWorktree,
      outputDirectory,
      createdAt: new Date().toISOString(),
    };
    await this.writeRecord(directory, "ownership.json", record);
    this.records.set(definition.name, record);
    await mkdir(outputDirectory, { mode: 0o700 });
    return {
      ...definition,
      executable: this.executablePath,
      args: [
        ...definition.args.map((argument) => argument === PLAYWRIGHT_CHILD_MCP_BROWSER_PATH
          ? this.browserExecutablePath
          : argument),
        `--output-dir=${outputDirectory}`,
      ],
    };
  }

  redactResult<T>(serverName: string, result: T): T {
    const outputDirectory = this.records.get(serverName)?.outputDirectory;
    return outputDirectory ? redact(result, outputDirectory) as T : result;
  }

  async cleanup(serverName: string): Promise<void> {
    const outputDirectory = this.records.get(serverName)?.outputDirectory;
    if (!outputDirectory) return;
    const directory = join(outputDirectory, "..");
    try {
      await this.cancel(serverName);
      await rm(outputDirectory, { recursive: true, force: true });
      // ponytail: retain terminal ownership evidence; add age-based retention if record volume warrants it.
      await this.writeRecord(directory, "ownership.json", {
        ...this.records.get(serverName), cleanedAt: new Date().toISOString(),
      });
      await rm(join(directory, "failed-cleanup.json"), { force: true });
    } catch (error) {
      await this.recordCleanupFailure(serverName);
      throw error;
    }
    this.records.delete(serverName);
  }

  async cancel(serverName: string): Promise<void> {
    const record = this.records.get(serverName);
    if (!record || record.cancellationRequestedAt) return;
    const cancelled = { ...record, cancellationRequestedAt: new Date().toISOString() };
    await this.writeRecord(join(record.outputDirectory, ".."), "ownership.json", cancelled);
    this.records.set(serverName, cancelled);
  }

  async recordCleanupFailure(serverName: string): Promise<void> {
    const record = this.records.get(serverName);
    if (!record) return;
    await this.writeRecord(join(record.outputDirectory, ".."), "failed-cleanup.json", {
      ...record, failedAt: new Date().toISOString(), code: "PLAYWRIGHT_CHILD_MCP_CLEANUP_FAILED",
    });
  }

  async cancelAll(): Promise<void> {
    await Promise.all([...this.records.keys()].map((serverName) => this.cancel(serverName)));
  }

  async recordAllCleanupFailures(): Promise<void> {
    await Promise.all([...this.records.keys()].map((serverName) => this.recordCleanupFailure(serverName)));
  }

  async cleanupAll(): Promise<void> {
    await Promise.all([...this.records.keys()].map((serverName) => this.cleanup(serverName)));
  }
}
