import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  closeSync,
  chmodSync,
  constants,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import {
  MCP103_FRESHNESS_DURATION_MS,
  Mcp103CollectorError,
  buildMcp103Report,
  configuredMcp103Project,
  mcp103HealthCheckOutcome,
  mcp103ToolNamesFromList,
  parseMcp103LocalEntry,
  readMcp103SourceRegistrations,
  serializeMcp103Report,
  type Mcp103LocalEntry,
  type Mcp103TransportSnapshot,
} from "../helpers/mcp-103-collector.js";
import type { McpToolUsefulnessReport } from "../../packages/ingenium-core/lib/tools/mcp-usefulness-report.js";

const ARTIFACT_RELATIVE_ROOT = join("tests", "artifacts", "test-runs");
const ARTIFACT_FILENAME = "mcp-usefulness-report.json";
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

class Mcp103CleanupError extends Mcp103CollectorError {
  constructor() {
    super();
    this.name = "Mcp103CleanupError";
  }
}

export interface Mcp103Clock {
  now(): Date;
}

export interface Mcp103Connection {
  listTools(): Promise<unknown>;
  callHealthCheck(): Promise<unknown>;
  close(): Promise<void>;
}

export interface Mcp103CollectionResult {
  report: McpToolUsefulnessReport;
  /** Config-derived only; intentionally absent from the persisted pure report. */
  project?: string;
}

export interface Mcp103CollectorOptions {
  repositoryRoot?: string;
  clock?: Mcp103Clock;
  provenance?: "fixture" | "live";
  launch?: (entry: Mcp103LocalEntry, repositoryRoot: string) => Promise<Mcp103Connection>;
}

export interface Mcp103MainOptions extends Mcp103CollectorOptions {
  writeStderr?: (message: string) => void;
}

function fail(): never {
  throw new Mcp103CollectorError();
}

function defaultClock(): Mcp103Clock {
  return { now: () => new Date() };
}

function asUtc(clock: Mcp103Clock): string {
  try {
    return clock.now().toISOString();
  } catch {
    return fail();
  }
}

function bounded<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolveResult, reject) => {
    const timeout = setTimeout(() => reject(new Mcp103CollectorError()), timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timeout);
        resolveResult(value);
      },
      () => {
        clearTimeout(timeout);
        reject(new Mcp103CollectorError());
      },
    );
  });
}

function isContainedBy(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function safeRunId(runId: unknown): runId is string {
  return typeof runId === "string"
    && SAFE_RUN_ID.test(runId)
    && runId !== "."
    && runId !== "..";
}

function assertCanonicalDirectory(path: string): void {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || realpathSync(path) !== path) fail();
  } catch {
    fail();
  }
}

function assertNoSymlinkedAncestors(repositoryRoot: string, target: string): void {
  if (!isContainedBy(repositoryRoot, target)) fail();
  const path = relative(repositoryRoot, target);
  if (path === "" || isAbsolute(path)) fail();
  let cursor = repositoryRoot;
  for (const part of path.split(sep)) {
    if (!part || part === "." || part === "..") fail();
    cursor = join(cursor, part);
    if (!existsSync(cursor)) continue;
    try {
      const metadata = lstatSync(cursor);
      if (metadata.isSymbolicLink()) fail();
    } catch {
      fail();
    }
  }
}

/** The CLI only accepts the canonical checkout root, never a supplied output path. */
export function resolveMcp103RepositoryRoot(candidate = process.cwd()): string {
  const resolved = resolve(candidate);
  if (!isAbsolute(candidate) || candidate !== resolved) fail();
  try {
    if (realpathSync(resolved) !== resolved) fail();
    assertCanonicalDirectory(resolved);
    const config = join(resolved, "opencode.json");
    const metadata = lstatSync(config);
    if (!metadata.isFile() || metadata.isSymbolicLink() || realpathSync(config) !== config) fail();
    return resolved;
  } catch {
    fail();
  }
}

/** Resolve exactly tests/artifacts/test-runs/<safe-run-id>/mcp-usefulness-report.json. */
export function mcp103ArtifactPath(repositoryRoot: string, runId: string): string {
  const root = resolveMcp103RepositoryRoot(repositoryRoot);
  if (!safeRunId(runId)) fail();
  const artifactRoot = join(root, ARTIFACT_RELATIVE_ROOT);
  const outputPath = join(artifactRoot, runId, ARTIFACT_FILENAME);
  const expected = join(ARTIFACT_RELATIVE_ROOT, runId, ARTIFACT_FILENAME);
  if (!isContainedBy(root, outputPath) || relative(root, outputPath) !== expected) fail();
  assertNoSymlinkedAncestors(root, outputPath);
  return outputPath;
}

function ensureMcp103ArtifactDirectory(repositoryRoot: string, runId: string): string {
  const outputPath = mcp103ArtifactPath(repositoryRoot, runId);
  const runDirectory = join(repositoryRoot, ARTIFACT_RELATIVE_ROOT, runId);
  try {
    mkdirSync(runDirectory, { recursive: true, mode: 0o700 });
    chmodSync(runDirectory, 0o700);
    assertNoSymlinkedAncestors(repositoryRoot, runDirectory);
    assertCanonicalDirectory(runDirectory);
    if ((lstatSync(runDirectory).mode & 0o777) !== 0o700) fail();
    return outputPath;
  } catch {
    fail();
  }
}

/** Atomically write one owner-only canonical report file without exposing its path to output. */
export function writeMcp103Artifact(
  repositoryRoot: string,
  runId: string,
  report: McpToolUsefulnessReport,
): void {
  const outputPath = ensureMcp103ArtifactDirectory(repositoryRoot, runId);
  const runDirectory = join(repositoryRoot, ARTIFACT_RELATIVE_ROOT, runId);
  const body = serializeMcp103Report(report);
  const temporaryPath = join(runDirectory, `.${ARTIFACT_FILENAME}.${randomUUID()}.tmp`);
  let descriptor: number | undefined;
  let published = false;

  try {
    if (existsSync(outputPath)) fail();
    assertNoSymlinkedAncestors(repositoryRoot, temporaryPath);
    descriptor = openSync(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    const bytes = Buffer.from(body, "utf8");
    for (let offset = 0; offset < bytes.length;) {
      const written = writeSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (written < 1) fail();
      offset += written;
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;

    const temporaryMetadata = lstatSync(temporaryPath);
    if (!temporaryMetadata.isFile() || temporaryMetadata.isSymbolicLink() || (temporaryMetadata.mode & 0o077) !== 0) fail();
    assertNoSymlinkedAncestors(repositoryRoot, runDirectory);
    if (existsSync(outputPath)) fail();
    // link() atomically publishes the completed file and refuses replacement.
    linkSync(temporaryPath, outputPath);
    published = true;
    unlinkSync(temporaryPath);

    const outputMetadata = lstatSync(outputPath);
    if (!outputMetadata.isFile() || outputMetadata.isSymbolicLink()
      || realpathSync(outputPath) !== outputPath || (outputMetadata.mode & 0o077) !== 0) fail();
    assertNoSymlinkedAncestors(repositoryRoot, outputPath);
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(temporaryPath)) {
      try {
        if (!lstatSync(temporaryPath).isSymbolicLink()) unlinkSync(temporaryPath);
      } catch {
        // The caller receives only the fixed failure category.
      }
    }
    if (published && existsSync(outputPath)) {
      try {
        const metadata = lstatSync(outputPath);
        if (metadata.isFile() && !metadata.isSymbolicLink() && realpathSync(outputPath) === outputPath) {
          unlinkSync(outputPath);
        }
      } catch {
        // The caller receives only the fixed failure category.
      }
    }
    fail();
  }
}

function readConfiguredMcp103Entry(repositoryRoot: string): Mcp103LocalEntry {
  try {
    const config = JSON.parse(readFileSync(join(repositoryRoot, "opencode.json"), "utf8")) as unknown;
    return parseMcp103LocalEntry(config) ?? fail();
  } catch {
    fail();
  }
}

async function closeClient(client: Client, transport: StdioClientTransport, timeoutMs: number): Promise<void> {
  try {
    await bounded(client.close(), timeoutMs);
  } catch {
    try {
      await bounded(transport.close(), timeoutMs);
    } catch {
      // Both close paths collapse to the fixed cleanup failure below.
    }
    fail();
  }
}

/** Launch the configured argv directly through the stdio transport; no shell command is constructed. */
export async function launchMcp103LocalEntry(
  entry: Mcp103LocalEntry,
  repositoryRoot: string,
): Promise<Mcp103Connection> {
  const command = entry.command[0];
  if (!command) fail();
  const transport = new StdioClientTransport({
    command,
    args: [...entry.command.slice(1)],
    cwd: repositoryRoot,
    // This prevents child stderr from becoming CLI output. The collector keeps
    // no buffer and never includes it in evidence.
    stderr: "pipe",
    env: { ...entry.environment },
  });
  const stderr = (transport as unknown as { stderr?: NodeJS.ReadableStream }).stderr;
  stderr?.resume();
  const client = new Client({ name: "mcp-103-collector", version: "1.0.0" });

  try {
    await bounded(client.connect(transport), entry.timeoutMs);
  } catch {
    let cleanupFailed = false;
    try {
      await bounded(transport.close(), entry.timeoutMs);
    } catch {
      cleanupFailed = true;
    }
    if (cleanupFailed) throw new Mcp103CleanupError();
    fail();
  }

  return {
    listTools: () => client.listTools(),
    callHealthCheck: () => client.callTool({ name: "health_check", arguments: {} }),
    close: () => closeClient(client, transport, entry.timeoutMs),
  };
}

export async function collectMcp103Report(options: Mcp103CollectorOptions = {}): Promise<Mcp103CollectionResult> {
  const repositoryRoot = resolveMcp103RepositoryRoot(options.repositoryRoot);
  const entry = readConfiguredMcp103Entry(repositoryRoot);
  const clock = options.clock ?? defaultClock();
  const launch = options.launch ?? launchMcp103LocalEntry;
  let connection: Mcp103Connection | undefined;
  let transport: Mcp103TransportSnapshot = { state: "transport-unavailable" };
  let observedAt: string | null = null;
  let cleanupFailed = false;

  try {
    connection = await launch(entry, repositoryRoot);
    try {
      const names = mcp103ToolNamesFromList(await bounded(connection.listTools(), entry.timeoutMs));
      if (!names) {
        transport = { state: "list-unavailable" };
      } else {
        observedAt = asUtc(clock);
        let healthCheck: "success" | "failed" | "invalid" | "not-run" = "not-run";
        if (names.includes("health_check")) {
          try {
            healthCheck = mcp103HealthCheckOutcome(await bounded(connection.callHealthCheck(), entry.timeoutMs));
          } catch {
            healthCheck = "failed";
          }
        }
        transport = { state: "listed", transportNames: names, healthCheck };
      }
    } catch {
      transport = { state: "list-unavailable" };
    }
  } catch (error) {
    if (error instanceof Mcp103CleanupError) fail();
    transport = { state: "transport-unavailable" };
  } finally {
    if (connection) {
      try {
        await bounded(connection.close(), entry.timeoutMs);
      } catch {
        cleanupFailed = true;
      }
    }
  }

  if (cleanupFailed) fail();
  try {
    return {
      report: buildMcp103Report({
        provenance: options.provenance ?? "live",
        generatedAt: asUtc(clock),
        observedAt,
        freshnessDurationMs: MCP103_FRESHNESS_DURATION_MS,
        sourceRegistrations: readMcp103SourceRegistrations(repositoryRoot),
        transport,
      }),
      project: configuredMcp103Project(entry),
    };
  } catch {
    fail();
  }
}

function parseRunId(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== "--run-id" || !safeRunId(argv[1])) fail();
  return argv[1]!;
}

/** CLI boundary: fixed stderr only, no stdout, no config or transport diagnostics. */
export async function runMcp103Collector(
  argv: readonly string[] = process.argv.slice(2),
  options: Mcp103MainOptions = {},
): Promise<number> {
  try {
    const runId = parseRunId(argv);
    const repositoryRoot = resolveMcp103RepositoryRoot(options.repositoryRoot);
    const result = await collectMcp103Report({ ...options, repositoryRoot });
    writeMcp103Artifact(repositoryRoot, runId, result.report);
    return 0;
  } catch {
    (options.writeStderr ?? ((message: string) => process.stderr.write(message)))("MCP-103 collector failed\n");
    return 1;
  }
}

if (process.argv[1] && /(?:^|[\\/])mcp-103-collector\.(?:ts|js)$/.test(process.argv[1])) {
  runMcp103Collector().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.stderr.write("MCP-103 collector failed\n");
    process.exitCode = 1;
  });
}
