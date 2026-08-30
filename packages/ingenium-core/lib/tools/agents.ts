import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Agent } from "../schema.js";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { logger } from "../logger.js";
import { getConfigPath } from "./paths.js";

export const AGENT_CATEGORIES = ["primary", "execution", "research", "security", "chat"] as const;
export type AgentCategory = typeof AGENT_CATEGORIES[number];
export const LLM_BROKER_AGENT = "ingenium-llm-broker";
export const LLM_BROKER_DESCRIPTION = "Internal agent for Ingenium LLM broker — never invoke directly";
export const LLM_BROKER_CATEGORY = "execution";
export const LLM_BROKER_MODE = "subagent";
export const LLM_BROKER_PERMISSIONS = '{"*":"deny"}';
export const LLM_BROKER_METADATA = '{"hidden":true}';
export const LLM_BROKER_SKILLS = "[]";
export const LLM_BROKER_DEPLOYMENT_ROOT = "/usr/local/share/ingenium/opencode-managed";
export const LLM_BROKER_CONFIG_PATH = `${LLM_BROKER_DEPLOYMENT_ROOT}/opencode.json`;
export const LLM_BROKER_ENFORCER_PATH = `${LLM_BROKER_DEPLOYMENT_ROOT}/plugins/enforce-reserved-broker.mjs`;
const LLM_BROKER_CONFIG_SHA256 = "4dd82cf42295fd9dba7594f101702fb6d356db66d77adc98efc3d70dcc240d47";
const LLM_BROKER_ENFORCER_SHA256 = "aae2499e9c1fa92e236d7f406df29720d2160447665f8fe792d24251543b84e1";
export const LLM_BROKER_CONTENT = `This agent is reserved for system use. Do not invoke directly.

Its wildcard-deny permission boundary intentionally has no exceptions: it has no
file, shell, browser, MCP, task, skill, or other tool access. The API always
selects this profile for broker requests; request-level tool selections cannot
grant capabilities that this profile denies.
`;

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Public route guard for serialized agent permissions and metadata. */
export function isSerializedAgentObject(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return isJsonObject(JSON.parse(value));
  } catch {
    return false;
  }
}

/** The broker is a system profile whose permission and visibility state is not user-configurable. */
export function isReservedAgentName(value: unknown): value is typeof LLM_BROKER_AGENT {
  return value === LLM_BROKER_AGENT;
}

function parseSerializedAgentObject(value: string | null | undefined): JsonObject {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function serializeAgentObject(value: string | null | undefined): string {
  return JSON.stringify(parseSerializedAgentObject(value));
}

function hasOnlyExpectedEntries(value: unknown, expected: Record<string, unknown>): boolean {
  if (!isJsonObject(value)) return false;
  const keys = Object.keys(value);
  return keys.length === Object.keys(expected).length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(expected, key)
      && value[key] === expected[key]);
}

/** API guard: an explicit broker permission payload may only repeat its invariant. */
export function isCanonicalBrokerPermissions(value: unknown): boolean {
  if (!isSerializedAgentObject(value)) return false;
  return hasOnlyExpectedEntries(JSON.parse(value), { "*": "deny" });
}

/** API guard: an explicit broker metadata payload may only repeat its invariant. */
export function isCanonicalBrokerMetadata(value: unknown): boolean {
  if (!isSerializedAgentObject(value)) return false;
  return hasOnlyExpectedEntries(JSON.parse(value), { hidden: true });
}

function canonicalPermissionsForAgent(name: string, value: string | null | undefined): string {
  return isReservedAgentName(name) ? LLM_BROKER_PERMISSIONS : serializeAgentObject(value);
}

function canonicalMetadataForAgent(name: string, value: string | null | undefined): string {
  return isReservedAgentName(name) ? LLM_BROKER_METADATA : serializeAgentObject(value);
}

function defaultPermissionsForAgent(name: string, permissions: JsonObject): JsonObject {
  // The broker has no implicit capability. In particular, an omitted
  // `permission` block must never turn a wildcard-deny broker into an allow-all
  // profile when the definition is restored from storage.
  if (isReservedAgentName(name)) return { "*": "deny" };
  if (Object.keys(permissions).length > 0) return permissions;
  return { read: "allow", write: "allow", bash: "allow" };
}

function canonicalMetadataForDisk(name: string, metadata: JsonObject): JsonObject {
  return isReservedAgentName(name) ? { hidden: true } : metadata;
}

function yamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
}

function yamlScalar(value: unknown): string {
  if (typeof value === "string" && /^[A-Za-z0-9._:/-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function appendYamlObject(lines: string[], value: JsonObject, indent: number): void {
  const prefix = " ".repeat(indent);
  for (const [key, child] of Object.entries(value)) {
    if (isJsonObject(child)) {
      lines.push(`${prefix}${yamlKey(key)}:`);
      appendYamlObject(lines, child, indent + 2);
    } else {
      lines.push(`${prefix}${yamlKey(key)}: ${yamlScalar(child)}`);
    }
  }
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      return typeof parsed === "string" ? parsed : trimmed;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function parseYamlMappingKey(value: string): string | null {
  const match = value.match(/^(?:"((?:[^"\\]|\\.)*)"|([^:]+)):\s*(.*)$/);
  if (!match) return null;
  return match[1] === undefined ? match[2]!.trim() : unquoteYamlScalar(`"${match[1]}"`);
}

/**
 * Parse the `permission` frontmatter mapping without hard-coding capability
 * names. OpenCode supports wildcard keys, and reducing this to read/write/bash
 * would silently weaken a broker's `"*": deny` policy.
 */
function parsePermissionFrontmatter(frontmatter: string): JsonObject {
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => /^permission:\s*$/.test(line));
  if (start === -1) return {};

  const permissions: JsonObject = {};
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent < 2) break;
    if (indent !== 2) continue;

    const key = parseYamlMappingKey(line.slice(2));
    if (key === null) continue;
    const rawValue = line.slice(2).replace(/^(?:"(?:[^"\\]|\\.)*"|[^:]+):\s*/, "");
    if (rawValue) {
      permissions[key] = unquoteYamlScalar(rawValue);
      continue;
    }

    const nested: JsonObject = {};
    for (index += 1; index < lines.length; index += 1) {
      const nestedLine = lines[index]!;
      if (!nestedLine.trim() || nestedLine.trimStart().startsWith("#")) continue;
      const nestedIndent = nestedLine.match(/^\s*/)?.[0].length ?? 0;
      if (nestedIndent <= 2) {
        index -= 1;
        break;
      }
      if (nestedIndent !== 4) continue;
      const nestedKey = parseYamlMappingKey(nestedLine.slice(4));
      if (nestedKey === null) continue;
      const nestedRaw = nestedLine.slice(4).replace(/^(?:"(?:[^"\\]|\\.)*"|[^:]+):\s*/, "");
      nested[nestedKey] = unquoteYamlScalar(nestedRaw);
    }
    permissions[key] = nested;
  }
  return permissions;
}

function parseAgentMetadata(frontmatter: string): JsonObject {
  const hidden = frontmatter.match(/^hidden:\s*(true|false)\s*$/mi)?.[1];
  return hidden === "true" ? { hidden: true } : hidden === "false" ? { hidden: false } : {};
}

function reservedBrokerFileContent(): string {
  const escapedDescription = LLM_BROKER_DESCRIPTION.replace(/"/g, '\\"');
  return [
    "---",
    `name: ${LLM_BROKER_AGENT}`,
    `description: "${escapedDescription}"`,
    `mode: ${LLM_BROKER_MODE}`,
    "hidden: true",
    "permission:",
    '  "*": deny',
    "---",
    "",
    LLM_BROKER_CONTENT,
  ].join("\n");
}

function protectedOpenCodeArtifactError(artifact: string, message: string, cause?: unknown): Error {
  const code = typeof cause === "object" && cause !== null && "code" in cause
    ? ` (${String(cause.code)})`
    : "";
  return new Error(`${artifact} ${message}${code}`, { cause });
}

interface BrokerProfileChain {
  descriptors: number[];
  stats: ReturnType<typeof fstatSync>[];
}

interface ProtectedArtifactLocation {
  root: string;
  components: string[];
}

function closeBrokerProfileChain(chain: BrokerProfileChain | undefined): void {
  if (!chain) return;
  for (const descriptor of chain.descriptors.reverse()) closeSync(descriptor);
}

function descriptorIsWritable(descriptor: number): boolean {
  try {
    accessSync(`/proc/self/fd/${descriptor}`, constants.W_OK);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EACCES") return false;
    throw error;
  }
}

function deploymentRoot(): string {
  return process.env.VITEST
    ? resolve(getAgentsDir(), "..", "..")
    : LLM_BROKER_DEPLOYMENT_ROOT;
}

function brokerProfileLocation(): ProtectedArtifactLocation {
  return process.env.VITEST
    ? {
        root: deploymentRoot(),
        components: [".opencode", "agents", LLM_BROKER_CATEGORY, `${LLM_BROKER_AGENT}.md`],
      }
    : {
        root: deploymentRoot(),
        components: ["agents", `${LLM_BROKER_AGENT}.md`],
      };
}

function protectedArtifactLocation(file: "config" | "enforcer"): ProtectedArtifactLocation {
  if (process.env.VITEST) {
    return {
      root: deploymentRoot(),
      components: file === "config"
        ? [".opencode", "protected", "opencode.json"]
        : [".opencode", "protected", "plugins", "enforce-reserved-broker.mjs"],
    };
  }
  return {
    root: deploymentRoot(),
    components: file === "config"
      ? ["opencode.json"]
      : ["plugins", "enforce-reserved-broker.mjs"],
  };
}

function openProtectedArtifactChain(location: ProtectedArtifactLocation, artifact: string): BrokerProfileChain {
  if (process.platform !== "linux" || typeof process.getuid !== "function"
    || typeof constants.O_DIRECTORY !== "number" || typeof constants.O_NOFOLLOW !== "number") {
    throw protectedOpenCodeArtifactError(artifact, "validation requires Linux descriptor safety");
  }
  const descriptors: number[] = [];
  const stats: ReturnType<typeof fstatSync>[] = [];
  try {
    let descriptor = openSync(location.root, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    descriptors.push(descriptor);
    let stat = fstatSync(descriptor);
    if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o555 || descriptorIsWritable(descriptor)) {
      throw protectedOpenCodeArtifactError(artifact, "trust root must be deployment-owned mode 0555");
    }
    const trustedOwner = { uid: stat.uid, gid: stat.gid };
    if (trustedOwner.uid === process.getuid!()) {
      throw protectedOpenCodeArtifactError(artifact, "trust root is owned by the runtime");
    }
    stats.push(stat);

    for (const [index, component] of location.components.entries()) {
      const isProfile = index === location.components.length - 1;
      descriptor = openSync(
        `/proc/self/fd/${descriptor}/${component}`,
        constants.O_RDONLY | constants.O_NOFOLLOW | (isProfile ? 0 : constants.O_DIRECTORY),
      );
      descriptors.push(descriptor);
      stat = fstatSync(descriptor);
      if (stat.uid !== trustedOwner.uid || stat.gid !== trustedOwner.gid) {
        throw protectedOpenCodeArtifactError(artifact, "owner does not match the trusted deployment chain");
      }
      if (isProfile) {
        if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o444 || descriptorIsWritable(descriptor)) {
          throw protectedOpenCodeArtifactError(artifact, "must be an exclusive read-only deployment file");
        }
      } else if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o555 || descriptorIsWritable(descriptor)) {
        throw protectedOpenCodeArtifactError(artifact, "parent chain must be deployment-owned mode 0555");
      }
      stats.push(stat);
    }
    return { descriptors, stats };
  } catch (error) {
    closeBrokerProfileChain({ descriptors, stats });
    if (error instanceof Error && error.message.startsWith(artifact)) throw error;
    throw protectedOpenCodeArtifactError(artifact, "could not be opened safely", error);
  }
}

function validateProtectedArtifact(
  location: ProtectedArtifactLocation,
  artifact: string,
  isCanonical: (content: string) => boolean,
): void {
  let first: BrokerProfileChain | undefined;
  let second: BrokerProfileChain | undefined;
  try {
    first = openProtectedArtifactChain(location, artifact);
    const profileDescriptor = first.descriptors[first.descriptors.length - 1]!;
    const before = fstatSync(profileDescriptor);
    const content = readFileSync(profileDescriptor, "utf-8");
    const after = fstatSync(profileDescriptor);
    if (!isCanonical(content)
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs) {
      throw protectedOpenCodeArtifactError(artifact, "content or descriptor identity is not canonical");
    }
    second = openProtectedArtifactChain(location, artifact);
    if (first.stats.some((stat, index) => {
      const current = second!.stats[index]!;
      return stat.dev !== current.dev || stat.ino !== current.ino;
    })) {
      throw protectedOpenCodeArtifactError(artifact, "path identity changed during validation");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(artifact)) throw error;
    throw protectedOpenCodeArtifactError(artifact, "could not be read safely", error);
  } finally {
    closeBrokerProfileChain(second);
    closeBrokerProfileChain(first);
  }
}

export function validateReservedBrokerDeployment(): void {
  validateProtectedArtifact(
    brokerProfileLocation(),
    "Reserved LLM broker profile",
    (content) => content === reservedBrokerFileContent(),
  );
}

export function validateProtectedOpenCodeDeployment(): void {
  validateReservedBrokerDeployment();
  validateProtectedArtifact(
    protectedArtifactLocation("config"),
    "Protected OpenCode config",
    (content) => createHash("sha256").update(content).digest("hex") === LLM_BROKER_CONFIG_SHA256,
  );
  validateProtectedArtifact(
    protectedArtifactLocation("enforcer"),
    "Protected OpenCode broker enforcer",
    (content) => createHash("sha256").update(content).digest("hex") === LLM_BROKER_ENFORCER_SHA256,
  );
}

/** Exact broker row shape permitted by migration 058's connection-independent trigger set. */
export function isCanonicalBrokerAgent(agent: Agent): boolean {
  return agent.name === LLM_BROKER_AGENT
    && agent.description === LLM_BROKER_DESCRIPTION
    && agent.category === LLM_BROKER_CATEGORY
    && agent.mode === LLM_BROKER_MODE
    && agent.model == null
    && agent.reasoning_effort == null
    && agent.permissions === LLM_BROKER_PERMISSIONS
    && agent.metadata === LLM_BROKER_METADATA
    && agent.skills === LLM_BROKER_SKILLS
    && agent.content === LLM_BROKER_CONTENT
    && Boolean(agent.enabled);
}

export function isSafeAgentName(name: unknown): name is string {
  return typeof name === "string"
    && name.length > 0
    && name.length <= 64
    && name.trim() === name
    && name !== "."
    && name !== ".."
    && !/[\\/\u0000-\u001f\u007f]/.test(name);
}

export function isAgentCategory(category: unknown): category is AgentCategory {
  return typeof category === "string" && (AGENT_CATEGORIES as readonly string[]).includes(category);
}

function assertSafeAgentName(name: unknown): asserts name is string {
  if (!isSafeAgentName(name)) throw new Error("Invalid agent name");
}

function assertAgentCategory(category: unknown): asserts category is AgentCategory {
  if (!isAgentCategory(category)) throw new Error("Invalid agent category");
}

function getAgentsDir(): string {
  return resolve(process.env.INGENIUM_CORE_DB_PATH ?? "./data", "..", "..", ".opencode", "agents");
}

function lstatIfPresent(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

/** Resolve a category only through real directories beneath the repository root. */
function safeAgentCategoryDirectory(category: AgentCategory, create = false): string | undefined {
  const agentsDir = resolve(getAgentsDir());
  const opencodeDir = resolve(agentsDir, "..");
  const projectRoot = resolve(opencodeDir, "..");
  const categoryDir = resolve(agentsDir, category);
  if (!categoryDir.startsWith(agentsDir + sep)) return undefined;

  for (const directory of [projectRoot, opencodeDir, agentsDir, categoryDir]) {
    let stat = lstatIfPresent(directory);
    if (!stat) {
      if (!create || directory === projectRoot) return undefined;
      mkdirSync(directory, { mode: 0o755 });
      stat = lstatIfPresent(directory);
    }
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) return undefined;
  }
  return categoryDir;
}

/** Return a regular, contained profile path without following a symlink. */
function safeAgentFilePath(category: AgentCategory, name: string, create = false): string | undefined {
  const categoryDir = safeAgentCategoryDirectory(category, create);
  if (!categoryDir) return undefined;
  const filePath = resolve(categoryDir, `${name}.md`);
  if (!filePath.startsWith(categoryDir + sep)) return undefined;
  const stat = lstatIfPresent(filePath);
  if (stat && (stat.isSymbolicLink() || !stat.isFile())) return undefined;
  return filePath;
}

/** Write a public profile with an exact readable mode and no symlink following. */
function writePublicAgentProfile(filePath: string, content: string): void {
  let descriptor: number | undefined;
  try {
    const existing = lstatIfPresent(filePath);
    if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
      throw new Error("Unsafe agent profile path");
    }
    descriptor = openSync(
      filePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o644,
    );
    if (!fstatSync(descriptor).isFile()) throw new Error("Unsafe agent profile path");
    writeFileSync(descriptor, content, "utf-8");
    // Existing files retain their mode and a restrictive umask affects new files.
    fchmodSync(descriptor, 0o644);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

type OpenCodeAgentConfig = Record<string, { model?: string; disable?: boolean }>;

function parseConfig(content: string): Record<string, unknown> {
  return JSON.parse(content.replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
}

function readProjectConfig(projectId: string): Record<string, unknown> {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const stored = (db.prepare("SELECT content FROM configs WHERE project_id = ? AND type = 'project'").get(projectId) as { content?: string } | undefined)?.content;
  if (stored) {
    try { return parseConfig(stored); } catch { /* use disk fallback */ }
  }
  try {
    const path = getConfigPath(projectId);
    return existsSync(path) ? parseConfig(readFileSync(path, "utf-8")) : {};
  } catch {
    return {};
  }
}

function configuredAgentModel(projectId: string, name: string): string | null {
  const entry = readProjectConfig(projectId).agent as OpenCodeAgentConfig | undefined;
  return typeof entry?.[name]?.model === "string" ? entry[name].model : null;
}

function updateAgentRuntimeConfig(
  projectId: string,
  name: string,
  options: { model?: string | null; disabled?: boolean; remove?: boolean },
): void {
  // Resolve the DB/disk fallback before taking the write lock. `readProjectConfig`
  // can read opencode.json when the database copy is missing or malformed, and
  // filesystem work while SQLite retries a transaction can hold the WAL lock for
  // an unbounded amount of time.
  const fallbackConfig = readProjectConfig(projectId);
  const content = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const stored = (db.prepare("SELECT * FROM configs WHERE project_id = ? AND type = 'project'").get(projectId) as { id: string; content: string } | undefined);
    let config: Record<string, unknown>;
    try {
      config = stored ? parseConfig(stored.content) : fallbackConfig;
    } catch {
      config = fallbackConfig;
    }
    const agents = (config.agent && typeof config.agent === "object" && !Array.isArray(config.agent))
      ? config.agent as OpenCodeAgentConfig
      : {};
    const entry = { ...(agents[name] ?? {}) };

    if (options.remove) {
      delete agents[name];
    } else {
      if (options.model !== undefined) {
        if (options.model) entry.model = options.model;
        else delete entry.model;
      }
      if (options.disabled !== undefined) {
        if (options.disabled) entry.disable = true;
        else delete entry.disable;
      }
      if (Object.keys(entry).length > 0) agents[name] = entry;
      else delete agents[name];
    }

    if (Object.keys(agents).length > 0) config.agent = agents;
    else delete config.agent;
    const serialized = JSON.stringify(config, null, 2);
    const now = new Date().toISOString();
    if (stored) {
      db.prepare("UPDATE configs SET content = ?, updated_at = ? WHERE id = ?").run(serialized, now, stored.id);
    } else {
      db.prepare("INSERT INTO configs (id, project_id, type, content, created_at, updated_at) VALUES (?, ?, 'project', ?, ?, ?)")
        .run(`config_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, projectId, serialized, now, now);
    }
    return serialized;
  });
  try {
    const path = getConfigPath(projectId);
    if (!existsSync(resolve(path, ".."))) mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf-8");
  } catch (error) {
    logger.warn("agents", "Failed to write agent runtime config to disk", { error: error instanceof Error ? error.message : String(error) });
  }
}

interface ReservedBrokerConfigReconciliation {
  content: string;
  storedId?: string;
}

function writeConfigAtomically(path: string, content: string): void {
  const parentPath = resolve(path, "..");
  let parentDescriptor: number | undefined;
  let temporaryDescriptor: number | undefined;
  let temporaryName = "";
  try {
    parentDescriptor = openSync(parentPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const targetName = basename(path);
    const existing = lstatIfPresent(path);
    if (existing && (existing.isSymbolicLink() || !existing.isFile() || existing.nlink !== 1)) {
      throw new Error("unsafe config target");
    }
    const mode = existing ? existing.mode & 0o777 : 0o644;
    temporaryName = `.${targetName}.${randomUUID()}.tmp`;
    temporaryDescriptor = openSync(
      `/proc/self/fd/${parentDescriptor}/${temporaryName}`,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      mode,
    );
    writeFileSync(temporaryDescriptor, content, "utf-8");
    fchmodSync(temporaryDescriptor, mode);
    fsyncSync(temporaryDescriptor);
    const temporaryStat = fstatSync(temporaryDescriptor);
    if (!temporaryStat.isFile() || temporaryStat.nlink !== 1
      || readFileSync(`/proc/self/fd/${parentDescriptor}/${temporaryName}`, "utf-8") !== content) {
      throw new Error("config verification failed");
    }
    closeSync(temporaryDescriptor);
    temporaryDescriptor = undefined;
    renameSync(
      `/proc/self/fd/${parentDescriptor}/${temporaryName}`,
      `/proc/self/fd/${parentDescriptor}/${targetName}`,
    );
    temporaryName = "";
    try { fsyncSync(parentDescriptor); } catch { /* rename is already the atomic commit point */ }
  } catch (error) {
    if (temporaryDescriptor !== undefined) closeSync(temporaryDescriptor);
    if (parentDescriptor !== undefined && temporaryName) {
      try { unlinkSync(`/proc/self/fd/${parentDescriptor}/${temporaryName}`); } catch { /* preserve failure */ }
    }
    const code = typeof error === "object" && error !== null && "code" in error
      ? ` (${String(error.code)})`
      : "";
    throw new Error(`Reserved LLM broker runtime config reconciliation failed${code}`, { cause: error });
  } finally {
    if (parentDescriptor !== undefined) {
      try { closeSync(parentDescriptor); } catch { /* no failure remains after the atomic commit point */ }
    }
  }
}

function prepareReservedBrokerRuntimeConfig(projectId: string): ReservedBrokerConfigReconciliation | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const stored = db.prepare("SELECT id, content FROM configs WHERE project_id = ? AND type = 'project'")
    .get(projectId) as { id: string; content: string } | undefined;
  let storedConfig: Record<string, unknown> | undefined;
  try {
    storedConfig = stored ? parseConfig(stored.content) : undefined;
  } catch (error) {
    throw new Error("Reserved LLM broker runtime config metadata is malformed", { cause: error });
  }

  const path = getConfigPath(projectId);
  const diskStat = lstatIfPresent(path);
  if (diskStat && (diskStat.isSymbolicLink() || !diskStat.isFile() || diskStat.nlink !== 1)) {
    throw new Error("Reserved LLM broker runtime config path is unsafe");
  }
  let diskConfig: Record<string, unknown> | undefined;
  if (diskStat) {
    try {
      diskConfig = parseConfig(readFileSync(path, "utf-8"));
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? ` (${String(error.code)})`
        : "";
      throw new Error(`Reserved LLM broker runtime config could not be read${code}`, { cause: error });
    }
  }

  const storedAgents = storedConfig?.agent;
  const diskAgents = diskConfig?.agent;
  const storedHasOverride = isJsonObject(storedAgents)
    && Object.prototype.hasOwnProperty.call(storedAgents, LLM_BROKER_AGENT);
  const diskHasOverride = isJsonObject(diskAgents)
    && Object.prototype.hasOwnProperty.call(diskAgents, LLM_BROKER_AGENT);
  if (!storedHasOverride && !diskHasOverride) return undefined;

  const config = structuredClone(storedConfig ?? diskConfig ?? {});
  if (isJsonObject(config.agent)) {
    delete config.agent[LLM_BROKER_AGENT];
    if (Object.keys(config.agent).length === 0) delete config.agent;
  }
  const content = JSON.stringify(config, null, 2);
  writeConfigAtomically(path, content);
  return { content, storedId: stored?.id };
}

/**
 * Write an agent definition to `.opencode/agents/<category>/<name>.md` as a YAML-frontmatter markdown file.
 *
 * If the file already exists, it does an in-place field update (replacing only name, description,
 * mode in the YAML frontmatter) — this preserves any handwritten fields (like
 * permissions, skills, or custom YAML keys) that OpenCode's agent system uses.
 *
 * If the file doesn't exist, it creates a full frontmatter block from the DB record, including
 * permissions (read/write/bash/task/mcp/skill), skills list, and content body.
 */
function writeAgentToDisk(agent: Agent): void {
  assertSafeAgentName(agent.name);
  assertAgentCategory(agent.category);
  if (!agent.enabled) return;
  if (isReservedAgentName(agent.name)) {
    throw new Error("Reserved LLM broker profile is deployment-owned");
  }
  const filePath = safeAgentFilePath(agent.category, agent.name, true);
  if (!filePath) throw new Error("Unsafe agent profile path");
  const escapedDesc = agent.description.replace(/"/g, '\\"');

  if (existsSync(filePath)) {
    const existingContent = readFileSync(filePath, "utf-8");
    const fmMatch = existingContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (fmMatch) {
      const frontmatter = fmMatch[1]!;

        let updated = frontmatter.replace(/^name:\s*.+$/m, `name: ${agent.name}`);
       // Models are runtime configuration only. Remove stale active model lines while
       // retaining comments that document historical model choices.
       updated = updated.replace(/^model:\s*.*(?:\r?\n|$)/gm, "");

      if (frontmatter.match(/^description:\s*".*"$/m)) {
        updated = updated.replace(/^description:\s*".*"$/m, `description: "${escapedDesc}"`);
      } else if (frontmatter.match(/^description:\s*.+$/m)) {
        updated = updated.replace(/^description:\s*.+$/m, `description: "${escapedDesc}"`);
      }

       if (updated.match(/^mode:\s*.+$/m)) {
         updated = updated.replace(/^mode:\s*.+$/m, `mode: ${agent.mode}`);
       } else {
         updated += `\nmode: ${agent.mode}`;
       }

       const metadata = canonicalMetadataForDisk(
         agent.name,
         parseSerializedAgentObject(agent.metadata),
       );
       if (metadata.hidden === true) {
         if (updated.match(/^hidden:\s*.+$/m)) {
           updated = updated.replace(/^hidden:\s*.+$/m, "hidden: true");
         } else {
           updated += "\nhidden: true";
         }
       } else {
         updated = updated.replace(/^hidden:\s*.+(?:\r?\n|$)/gm, "");
       }

      writePublicAgentProfile(filePath, `---\n${updated}\n---\n\n${agent.content}`);
      return;
    }
  }

  // File doesn't exist — create full frontmatter from scratch
   const permissions = defaultPermissionsForAgent(
      agent.name,
      parseSerializedAgentObject(agent.permissions),
   );
   const metadata = canonicalMetadataForDisk(
     agent.name,
     parseSerializedAgentObject(agent.metadata),
   );
   const skills = (() => { try { return JSON.parse(agent.skills); } catch { return []; } })();

  const frontmatter = [
    "---",
    `name: ${agent.name}`,
   `description: "${escapedDesc}"`,
   `mode: ${agent.mode}`,
  ];
  if (agent.reasoning_effort) frontmatter.push(`reasoning_effort: "${agent.reasoning_effort}"`);
  if (metadata.hidden === true) frontmatter.push("hidden: true");
  if (Object.keys(permissions).length > 0) {
    frontmatter.push("permission:");
    appendYamlObject(frontmatter, permissions, 2);
  }
  frontmatter.push(`skills:`);
  for (const s of skills) frontmatter.push(`  - ${s}`);
  frontmatter.push("---");
  frontmatter.push("");
  frontmatter.push(agent.content);

  writePublicAgentProfile(filePath, frontmatter.join("\n"));
}

/**
 * Remove an agent's .md file from disk. Silently ignores if the file doesn't exist.
 * Used by disable/delete/update (on category change) operations.
 */
function removeAgentFromDisk(agent: Agent): void {
  assertSafeAgentName(agent.name);
  assertAgentCategory(agent.category);
  const categoryDir = safeAgentCategoryDirectory(agent.category);
  if (!categoryDir) return;
  const filePath = resolve(categoryDir, `${agent.name}.md`);
  if (!filePath.startsWith(categoryDir + sep)) return;
  try {
    const stat = lstatIfPresent(filePath);
    if (stat?.isFile() || stat?.isSymbolicLink()) unlinkSync(filePath);
  } catch {}
}

/**
 * The broker definition is never imported from disk. Migration 058 validates
 * the persisted record as the exact canonical template; disk sync validates
 * the deployment-owned profile without changing either source of truth.
 */
function validateReservedBrokerState(agent: Agent): Agent | undefined {
  if (!isCanonicalBrokerAgent(agent)) {
    logger.error("agents", "Reserved broker row failed canonical template validation", { id: agent.id });
    return undefined;
  }
  validateReservedBrokerDeployment();
  return agent;
}

/**
 * List agents for a project, optionally filtered by category.
 * Results are ordered by category then name (or just name if category is specified).
 */
export function listAgents(projectId: string, category?: string): Agent[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  if (category) {
    if (!isAgentCategory(category)) return [];
    return db.prepare("SELECT * FROM agents WHERE project_id = ? AND category = ? ORDER BY name")
      .all(projectId, category) as Agent[];
  }
  return db.prepare("SELECT * FROM agents WHERE project_id = ? ORDER BY category, name")
    .all(projectId) as Agent[];
}

/** Get a single agent by project and name. Returns undefined if not found. */
export function getAgent(projectId: string, name: string): Agent | undefined {
  if (!isSafeAgentName(name)) return undefined;
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
    .get(projectId, name) as Agent | undefined;
}

/**
 * Create a new agent for a project.
 * Persists to DB and writes the agent `.md` file to `.opencode/agents/<category>/`.
 *
 * Defaults: category="execution", mode="subagent", model=null (no model override).
 */
export function createAgent(
  projectId: string,
  name: string,
  content: string,
  description?: string,
  category?: string,
  mode?: string,
  model?: string,
  enabled = true,
  permissions?: string,
  metadata?: string,
): Agent {
  assertSafeAgentName(name);
  if (isReservedAgentName(name)) {
    throw new Error("Reserved LLM broker can only be created by the internal bootstrap");
  }
  const safeCategory = category ?? "execution";
  assertAgentCategory(safeCategory);
  const agent = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const id = randomUUID();
    db.prepare(
      `INSERT INTO agents (id, project_id, name, description, category, mode, model, permissions, metadata, content, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      projectId,
      name,
      description ?? "",
      safeCategory,
      mode ?? "subagent",
      model ?? null,
       canonicalPermissionsForAgent(name, permissions),
       canonicalMetadataForAgent(name, metadata),
       content,
       enabled ? 1 : 0,
      now,
      now,
    );

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Agent;
    return agent;
  });
  // Filesystem effects must happen after the database transaction commits.
  if (agent.enabled) writeAgentToDisk(agent);
  updateAgentRuntimeConfig(projectId, name, { model: model ?? null, disabled: !agent.enabled });
  checkpointAfterWrite();
  return agent;
}

/**
 * Provision the system-owned LLM broker with the sole template accepted by
 * migration 058. This is intentionally separate from createAgent(): public
 * API, MCP, and resource-sync callers must never be able to author the broker.
 */
export function bootstrapReservedBroker(projectId: string): Agent {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const persisted = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
    .get(projectId, LLM_BROKER_AGENT) as Agent | undefined;
  if (persisted && !isCanonicalBrokerAgent(persisted)) {
    throw new Error("Reserved LLM broker failed canonical template validation");
  }
  if (!persisted && !db.prepare("SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL").get(projectId)) {
    throw new Error("Cannot bootstrap reserved LLM broker for a missing or archived project");
  }

  validateReservedBrokerDeployment();
  const configReconciliation = prepareReservedBrokerRuntimeConfig(projectId);

  const result = execTransaction(() => {
    const transactionDb = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = transactionDb.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, LLM_BROKER_AGENT) as Agent | undefined;
    if (existing) {
      if (!isCanonicalBrokerAgent(existing)) {
        throw new Error("Reserved LLM broker failed canonical template validation");
      }
      if (configReconciliation) {
        const now = new Date().toISOString();
        if (configReconciliation.storedId) {
          transactionDb.prepare("UPDATE configs SET content = ?, updated_at = ? WHERE id = ?")
            .run(configReconciliation.content, now, configReconciliation.storedId);
        } else {
          transactionDb.prepare("INSERT INTO configs (id, project_id, type, content, created_at, updated_at) VALUES (?, ?, 'project', ?, ?, ?)")
            .run(`config_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, projectId, configReconciliation.content, now, now);
        }
      }
      return { broker: existing, changed: Boolean(configReconciliation) };
    }

    const project = transactionDb.prepare("SELECT 1 FROM projects WHERE id = ? AND archived_at IS NULL")
      .get(projectId);
    if (!project) throw new Error("Cannot bootstrap reserved LLM broker for a missing or archived project");

    const now = new Date().toISOString();
    const id = randomUUID();
    transactionDb.prepare(
      `INSERT INTO agents (id, project_id, name, description, category, mode, model, reasoning_effort, permissions, metadata, skills, content, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 1, ?, ?)`,
    ).run(
      id,
      projectId,
      LLM_BROKER_AGENT,
      LLM_BROKER_DESCRIPTION,
      LLM_BROKER_CATEGORY,
      LLM_BROKER_MODE,
      LLM_BROKER_PERMISSIONS,
      LLM_BROKER_METADATA,
      LLM_BROKER_SKILLS,
      LLM_BROKER_CONTENT,
      now,
      now,
    );
    if (configReconciliation) {
      if (configReconciliation.storedId) {
        transactionDb.prepare("UPDATE configs SET content = ?, updated_at = ? WHERE id = ?")
          .run(configReconciliation.content, now, configReconciliation.storedId);
      } else {
        transactionDb.prepare("INSERT INTO configs (id, project_id, type, content, created_at, updated_at) VALUES (?, ?, 'project', ?, ?, ?)")
          .run(`config_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, projectId, configReconciliation.content, now, now);
      }
    }
    return { broker: transactionDb.prepare("SELECT * FROM agents WHERE id = ?").get(id) as Agent, changed: true };
  });
  if (result.changed) checkpointAfterWrite();
  return result.broker;
}

/**
 * Update an existing agent's metadata and/or content.
 * Handles category changes by removing the old `.md` file and writing to the new category directory.
 *
 * NOTE: null model explicitly removes the model override; undefined preserves the existing value.
 */
export function updateAgent(
  projectId: string,
  name: string,
  updates: {
    description?: string;
    category?: string;
    mode?: string;
    model?: string | null;
    content?: string;
    permissions?: string;
    metadata?: string;
  },
): Agent | undefined {
  if (!isSafeAgentName(name)) return undefined;
  // The broker profile is system-owned. Its persisted body, identity, and
  // runtime state are immutable once established; only startup reconciliation
  // may repair the fixed enabled/permission/visibility fields.
  if (isReservedAgentName(name)) return undefined;
  if (updates.category !== undefined && !isAgentCategory(updates.category)) return undefined;
  const updated = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const existing = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Agent | undefined;
    if (!existing) return undefined;

    const now = new Date().toISOString();
    const newDesc = updates.description ?? existing.description;
    const newCat = updates.category ?? existing.category;
    const newMode = updates.mode ?? existing.mode;
    const newModel = updates.model !== undefined ? updates.model : existing.model;
    const newContent = updates.content ?? existing.content;
    const newPermissions = canonicalPermissionsForAgent(
      name,
      updates.permissions !== undefined ? updates.permissions : existing.permissions,
    );
    const newMetadata = canonicalMetadataForAgent(
      name,
      updates.metadata !== undefined ? updates.metadata : existing.metadata,
    );

    db.prepare(
      `UPDATE agents SET description = ?, category = ?, mode = ?, model = ?, permissions = ?, metadata = ?, content = ?, updated_at = ? WHERE id = ?`
    ).run(newDesc, newCat, newMode, newModel, newPermissions, newMetadata, newContent, now, existing.id);

    const agent = db.prepare("SELECT * FROM agents WHERE id = ?").get(existing.id) as Agent;
    return { agent, previous: existing };
  });
  if (updated) {
    if (updated.agent.category !== updated.previous.category) {
      removeAgentFromDisk(updated.previous);
    }
    writeAgentToDisk(updated.agent);
  }
  if (updated && updates.model !== undefined) {
    updateAgentRuntimeConfig(projectId, name, { model: updates.model || null });
  }
  checkpointAfterWrite();
  return updated?.agent;
}

/** Delete an agent: removes from DB and deletes the `.md` file from disk. Returns false if not found. */
export function deleteAgent(projectId: string, name: string): boolean {
  if (!isSafeAgentName(name)) return false;
  if (isReservedAgentName(name)) return false;
  const deletedAgent = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const agent = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Agent | undefined;
    if (!agent) return false;
    db.prepare("DELETE FROM agents WHERE id = ?").run(agent.id);
    return agent;
  });
  if (deletedAgent) {
    removeAgentFromDisk(deletedAgent);
    updateAgentRuntimeConfig(projectId, name, { remove: true });
  }
  checkpointAfterWrite();
  return Boolean(deletedAgent);
}

/** Enable an agent and write its `.md` file to disk. */
export function enableAgent(projectId: string, name: string): Agent | undefined {
  if (!isSafeAgentName(name)) return undefined;
  // The broker has no external lifecycle transition; only bootstrap provisions it.
  if (isReservedAgentName(name)) return undefined;
  const agent = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    db.prepare("UPDATE agents SET enabled = 1, updated_at = ? WHERE project_id = ? AND name = ?")
      .run(now, projectId, name);
    const agent = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Agent | undefined;
    return agent;
  });
  if (agent) {
    writeAgentToDisk(agent);
    updateAgentRuntimeConfig(projectId, name, { model: agent.model ?? undefined, disabled: false });
  }
  checkpointAfterWrite();
  return agent;
}

/** Disable an agent and remove its `.md` file from disk. */
export function disableAgent(projectId: string, name: string): Agent | undefined {
  if (!isSafeAgentName(name)) return undefined;
  // The reserved broker may not enter the ordinary disable lifecycle.
  if (isReservedAgentName(name)) return undefined;
  const agent = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    db.prepare("UPDATE agents SET enabled = 0, updated_at = ? WHERE project_id = ? AND name = ?")
      .run(now, projectId, name);
    const agent = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
      .get(projectId, name) as Agent | undefined;
    return agent;
  });
  if (agent) {
    removeAgentFromDisk(agent);
    updateAgentRuntimeConfig(projectId, name, { model: agent.model, disabled: true });
  }
  checkpointAfterWrite();
  return agent;
}

/**
 * Sync an agent from its `.md` file on disk into the DB.
 * Used by the bidirectional agent sync engine to reconcile disk → DB changes.
 *
 * If the agent exists in DB, its category from the DB is used to locate the file.
 * If not, all four category directories (primary, execution, research, security) are searched.
 *
 * Parses the full YAML frontmatter structure including:
 * - Basic fields: name, description, mode, reasoning_effort
 * - Permission blocks: read/write/bash, plus nested task/mcp/skill permissions
 * - Skills list
 */
export function syncAgentFromDisk(projectId: string, name: string): Agent | undefined {
  if (!isSafeAgentName(name)) return undefined;
  const categories = AGENT_CATEGORIES;
  let filePath = "";
  let category = "";

  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const dbAgent = db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
    .get(projectId, name) as Agent | undefined;

  // Disk frontmatter is untrusted for the system broker. Validate the
  // deployment-owned profile before returning metadata, and never import or
  // repair an orphan profile through resource sync.
  if (isReservedAgentName(name)) {
    if (dbAgent) return validateReservedBrokerState(dbAgent);
    validateReservedBrokerDeployment();
    return undefined;
  }

  if (dbAgent && !dbAgent.enabled) {
    return dbAgent;
  }

  if (dbAgent) {
    if (!isAgentCategory(dbAgent.category)) return undefined;
    filePath = safeAgentFilePath(dbAgent.category, name) ?? "";
    category = dbAgent.category;
  } else {
    for (const cat of categories) {
      const candidate = safeAgentFilePath(cat, name);
      if (candidate && lstatIfPresent(candidate)?.isFile()) {
        filePath = candidate;
        category = cat;
        break;
      }
    }
  }

  if (!filePath || !existsSync(filePath)) {
    logger.warn("agents", "Agent file not found on disk", { name });
    return undefined;
  }

  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    logger.warn("agents", "Agent profile is not readable from disk", { name });
    return undefined;
  }
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!fmMatch) {
    logger.warn("agents", "Agent file has no frontmatter", { name });
    return undefined;
  }

  const frontmatter = fmMatch[1]!;
  const body = fmMatch[2]!.trim();

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatter.match(/^description:\s*"(.+)"$/m);
  const modeMatch = frontmatter.match(/^mode:\s*(.+)$/m);
  const reasoningMatch = frontmatter.match(/^reasoning_effort:\s*"(.+)"$/m);
  const skillMatches = [...frontmatter.matchAll(/^\s+-\s(.+)$/gm)].map(m => m[1]!);

   const agentName = nameMatch?.[1] ?? name;
   if (!isSafeAgentName(agentName) || agentName !== name || !isAgentCategory(category)) return undefined;
  const description = descMatch?.[1] ?? "";
  const mode = modeMatch?.[1] ?? "subagent";
   // Markdown model lines are deliberately ignored. Config is authoritative;
   // absent a configured model, retain existing API metadata for compatibility.
   const model = configuredAgentModel(projectId, name) ?? dbAgent?.model ?? null;
  const reasoningEffort = reasoningMatch?.[1] ?? null;

   const permissions = canonicalPermissionsForAgent(
     agentName,
     JSON.stringify(defaultPermissionsForAgent(agentName, parsePermissionFrontmatter(frontmatter))),
   );
   const metadata = canonicalMetadataForAgent(
     agentName,
     JSON.stringify(parseAgentMetadata(frontmatter)),
   );

   const agent = execTransaction(() => {
    const now = new Date().toISOString();
    if (dbAgent) {
      db.prepare(
         `UPDATE agents SET name = ?, description = ?, category = ?, mode = ?, model = ?, reasoning_effort = ?, permissions = ?, metadata = ?, skills = ?, content = ?, updated_at = ? WHERE id = ?`
       ).run(agentName, description, category, mode, model, reasoningEffort, permissions, metadata, JSON.stringify(skillMatches), body, now, dbAgent.id);
    } else {
      const id = randomUUID();
      db.prepare(
         `INSERT OR IGNORE INTO agents (id, project_id, name, description, category, mode, model, reasoning_effort, permissions, metadata, skills, content, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
       ).run(id, projectId, agentName, description, category, mode, model, reasoningEffort, permissions, metadata, JSON.stringify(skillMatches), body, now, now);
    }
     return db.prepare("SELECT * FROM agents WHERE project_id = ? AND name = ?")
       .get(projectId, agentName) as Agent | undefined;
   });
    if (agent && !dbAgent) updateAgentRuntimeConfig(projectId, name, { model: agent.model ?? undefined, disabled: true });
     checkpointAfterWrite();
   return agent;
}
