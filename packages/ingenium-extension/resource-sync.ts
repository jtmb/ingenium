/**
 * Resource Sync Engine — Unified bidirectional synchronisation of skills, agents,
 * plugins, commands, and config between the Ingenium API and the local filesystem.
 *
 * This supersedes skill-sync.ts and onboarding-sync.ts, which now delegate here.
 *
 * Project resolution (CRITICAL):
 *   1. process.env.INGENIUM_PROJECT (explicit override)
 *   2. Worktree basename (derived from plugin context)
 *   3. NEVER falls back to "global-default"
 *
 * Sync manifest: .opencode/.ingenium-sync-state.json
 */
import { closeSync, constants, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { resolve, basename, dirname, isAbsolute, parse as parsePath, sep, relative, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  classifyExtensionProjectFailure,
  ensureExtensionProject,
  resolveExtensionProject,
  type ExtensionProjectFailureKind,
} from "./project-resolver.js";
import { apiRequestHeaders } from "./api-auth.js";

const API_BASE =
  (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ??
  "http://localhost:4097/api/v1";

// PERF: Cache project resolution since env/worktree won't change mid-process.
// Multiple sync functions call resolveProject() independently during a single sync pass.
let _projectCache: string | null = null;
let _projectResolved = false;

/**
 * Resolve the project name exactly once per process.
 *
 * Priority:
 *   1. INGENIUM_PROJECT env var (explicit override — Docker containers use this)
 *   2. Worktree directory basename (external worktree sessions)
 *   3. Throw — NEVER default to "global-default"
 *
 * WARNING: Falling back to "global-default" would cause cross-project data pollution
 * when multiple worktrees share the same server. The explicit env var or worktree-name
 * resolution ensures project isolation.
 */
export function resolveProject(worktree: string): string {
  if (_projectResolved) return _projectCache!;
  _projectCache = resolveExtensionProject(worktree);
  _projectResolved = true;
  return _projectCache;
}

/** For testing — reset the cached project resolution. */
export function resetProjectCache(): void {
  _projectCache = null;
  _projectResolved = false;
}

/**
 * SHA-256 content hash for change detection.
 * Used as a content-addressable comparison key to determine whether a resource
 * has changed on disk vs API vs the last-known sync baseline.
 */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function hashFile(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    return hashContent(readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

// ── Repository-authoritative manifest v2 ────────────────────────────────────
// These scanners are intentionally independent from the legacy bidirectional
// resource scans below. Repository sync is a one-way, validated projection of
// the local worktree; it never scans commands or either project/global config.

const REPOSITORY_MAX_ITEMS = 512;
const REPOSITORY_MAX_FILE_BYTES = 512 * 1024;
const REPOSITORY_MAX_RESOURCE_BYTES = 256 * 1024;
const REPOSITORY_MAX_DOC_BYTES = 1_500 * 1024;
const REPOSITORY_MAX_RESOURCE_TOTAL_BYTES = 1_500 * 1024;
const REPOSITORY_PLUGIN_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);
const REPOSITORY_PLUGIN_ROOTS = [".opencode/plugins/", "packages/"] as const;

export class RepositorySyncScanError extends Error {
  constructor(message = "Repository resource scan rejected an unsafe path or content") {
    super(message);
    this.name = "RepositorySyncScanError";
  }
}

export interface RepositoryDocManifestEntry {
  path: string;
  sha256: string;
  content: string;
  fileType: "regular";
  isSymlink: false;
}

export interface RepositorySkillManifestEntry {
  identity: string;
  path: string;
  sha256: string;
  name: string;
  skillMd: string;
  body: string;
  description: string;
  category?: string;
  tags: string[];
  alwaysApply: boolean;
  metadata: Record<string, unknown>;
  fileTree: Record<string, string>;
}

export interface RepositoryAgentManifestEntry {
  identity: string;
  path: string;
  sha256: string;
  name: string;
  category: typeof AGENT_CATEGORIES[number];
  frontmatter: string;
  body: string;
  description: string;
  mode: string;
  permissions: Record<string, unknown>;
  metadata: Record<string, unknown>;
  skills: string[];
  mirrors: string[];
  enabled: boolean;
}

export interface RepositoryPluginManifestEntry {
  identity: string;
  path: string;
  sha256: string;
  name: string;
  source: string;
  fileType: "regular";
  isSymlink: false;
  enabled: boolean;
  order: number | null;
  options: Record<string, unknown>;
}

export interface RepositoryManifestV2 {
  version: 2;
  docs: RepositoryDocManifestEntry[];
  skills: RepositorySkillManifestEntry[];
  agents: RepositoryAgentManifestEntry[];
  plugins: RepositoryPluginManifestEntry[];
}

function normalizeRepositoryText(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function repositoryIsRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** Reject symlinked directory components, including `.opencode`, before path use. */
function assertNoSymlinkedAncestors(filePath: string, includeTarget = false): void {
  const absolutePath = resolve(filePath);
  const parsed = parsePath(absolutePath);
  const segments = relative(parsed.root, absolutePath).split(sep).filter(Boolean);
  const count = includeTarget ? segments.length : Math.max(segments.length - 1, 0);
  let current = parsed.root;

  for (let index = 0; index < count; index += 1) {
    current = resolve(current, segments[index]!);
    let currentStat;
    try {
      currentStat = lstatSync(current);
    } catch (error) {
      if (isMissingPathError(error)) return;
      throw new RepositorySyncScanError();
    }
    if (currentStat.isSymbolicLink() || !currentStat.isDirectory()) throw new RepositorySyncScanError();
  }
}

function repositoryWorktreeRoot(worktree: string): string {
  const root = resolve(worktree);
  try {
    assertNoSymlinkedAncestors(root, true);
    const rootStat = lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new RepositorySyncScanError();
    return realpathSync(root);
  } catch (error) {
    if (error instanceof RepositorySyncScanError) throw error;
    throw new RepositorySyncScanError();
  }
}

function assertRepositoryContainedPath(worktree: string, target: string): { root: string; absolutePath: string } {
  const root = repositoryWorktreeRoot(worktree);
  const absolutePath = resolve(target);
  const relativePath = relative(root, absolutePath);
  if (relativePath.startsWith("..") || relativePath === ".." || isAbsolute(relativePath)) throw new RepositorySyncScanError();
  return { root, absolutePath };
}

/**
 * Open a regular repository file by descriptor. O_NOFOLLOW protects the final
 * component while fstat verifies the opened inode rather than a pre-open path.
 */
function readRepositoryRegularText(worktree: string, filePath: string): string {
  const { absolutePath } = assertRepositoryContainedPath(worktree, filePath);
  let descriptor: number | undefined;
  try {
    assertNoSymlinkedAncestors(absolutePath);
    descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(descriptor).isFile()) throw new RepositorySyncScanError();
    return readFileSync(descriptor, "utf-8");
  } catch (error) {
    if (error instanceof RepositorySyncScanError) throw error;
    throw new RepositorySyncScanError();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function isSecretLikeRepositoryPath(value: string): boolean {
  return value.split("/").some((segment) => {
    const normalized = segment.toLowerCase();
    return normalized === ".env"
      || normalized.startsWith(".env.")
      || /(?:^|[._-])(?:secret|secrets|credential|credentials|token|tokens|password|passphrase|api[_-]?key|private[_-]?key|key|keys)(?:$|[._-])/.test(normalized);
  });
}

function isSecretLikePluginOptionKey(key: string): boolean {
  const compact = key.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  if (new Set([
    "secret", "secrets", "credential", "credentials", "token", "tokens",
    "password", "passwords", "passphrase", "passphrases", "key", "keys",
    "apikey", "apikeys", "privatekey", "privatekeys", "accesstoken",
    "refreshtoken", "authtoken", "clientsecret",
  ]).has(compact)) return true;
  return /(?:secret|credential|token|password|passphrase)$/.test(compact)
    || /(?:^|[_-])key$/i.test(key)
    || /Key$/.test(key);
}

function stripSecretLikePluginOptionKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecretLikePluginOptionKeys);
  if (!repositoryIsRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSecretLikePluginOptionKey(key))
      .map(([key, child]) => [key, stripSecretLikePluginOptionKeys(child)]),
  );
}

function isAllowedRepositoryPluginPath(filePath: string): boolean {
  return REPOSITORY_PLUGIN_ROOTS.some((root) => filePath.startsWith(root))
    && REPOSITORY_PLUGIN_EXTENSIONS.has(extname(filePath))
    && !isSecretLikeRepositoryPath(filePath);
}

/** Stable JSON shared with the API validator; object insertion order is never semantic. */
function stableRepositoryJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableRepositoryJson).join(",")}]`;
  if (repositoryIsRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableRepositoryJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function repositoryHash(value: unknown): string {
  return hashContent(stableRepositoryJson(value));
}

function repositoryRelativePath(worktree: string, target: string): string {
  const root = repositoryWorktreeRoot(worktree);
  const absolute = resolve(root, target);
  const value = relative(root, absolute).split(sep).join("/");
  if (!value || value.startsWith("../") || value === ".." || isAbsolute(value) || value.includes("\\") || value.includes("\u0000")) {
    throw new RepositorySyncScanError();
  }
  return value;
}

function assertContainedDirectory(worktree: string, directory: string): string | null {
  try {
    const { root, absolutePath } = assertRepositoryContainedPath(worktree, directory);
    // Validate parents before testing the target's existence. Otherwise a
    // dangling child below a symlinked `.opencode` directory looks merely absent.
    assertNoSymlinkedAncestors(absolutePath);
    let directoryStat;
    try {
      directoryStat = lstatSync(absolutePath);
    } catch (error) {
      if (isMissingPathError(error)) return null;
      throw error;
    }
    assertNoSymlinkedAncestors(absolutePath, true);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new RepositorySyncScanError();
    const canonical = realpathSync(absolutePath);
    if (!canonical.startsWith(root + sep) && canonical !== root) throw new RepositorySyncScanError();
    return canonical;
  } catch (error) {
    if (error instanceof RepositorySyncScanError) throw error;
    throw new RepositorySyncScanError();
  }
}

interface RepositoryDiskFile {
  path: string;
  absolutePath: string;
  content: string;
}

/** Walk only regular, contained files; a symlink anywhere invalidates the scan. */
function walkRepositoryFiles(
  worktree: string,
  directory: string,
  maxFileBytes: number,
  shouldIncludeRegularFile?: (filePath: string, mode: number) => boolean,
): RepositoryDiskFile[] {
  const base = assertContainedDirectory(worktree, directory);
  if (!base) return [];
  const files: RepositoryDiskFile[] = [];
  const walk = (current: string) => {
    let entries: string[];
    try { entries = readdirSync(current).sort((a, b) => a.localeCompare(b)); } catch { throw new RepositorySyncScanError(); }
    for (const name of entries) {
      const fullPath = resolve(current, name);
      let stat;
      try { stat = lstatSync(fullPath); } catch { throw new RepositorySyncScanError(); }
      if (stat.isSymbolicLink()) throw new RepositorySyncScanError();
      if (stat.isDirectory()) {
        const canonical = assertContainedDirectory(worktree, fullPath);
        if (!canonical || (!canonical.startsWith(base + sep) && canonical !== base)) throw new RepositorySyncScanError();
        walk(canonical);
        continue;
      }
      if (!stat.isFile()) throw new RepositorySyncScanError();
      if (shouldIncludeRegularFile && !shouldIncludeRegularFile(fullPath, stat.mode)) continue;
      if (files.length >= REPOSITORY_MAX_ITEMS) throw new RepositorySyncScanError();
      const relativePath = repositoryRelativePath(worktree, fullPath);
      const content = normalizeRepositoryText(readRepositoryRegularText(worktree, fullPath));
      if (Buffer.byteLength(content) > maxFileBytes) throw new RepositorySyncScanError();
      files.push({ path: relativePath, absolutePath: fullPath, content });
    }
  };
  walk(base);
  return files;
}

function parseRepositoryFrontmatter(content: string): { raw: string; body: string; fields: Record<string, string> } {
  const normalized = normalizeRepositoryText(content);
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n)?/);
  if (!match) throw new RepositorySyncScanError("Repository markdown requires frontmatter");
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
    if (/^\s/.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    let value = line.slice(colon + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    fields[key] = value;
  }
  return { raw: match[1]!, body: normalized.slice(match[0].length), fields };
}

function safeRepositoryName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 64
    && value !== "." && value !== ".." && !/[\\/\u0000-\u001f\u007f]/.test(value);
}

function repositoryBaseline(manifest: SyncManifest): NonNullable<SyncManifest["resources"]["repository"]> {
  manifest.resources.repository ??= { docs: {}, skills: {}, agents: {}, plugins: {} };
  return manifest.resources.repository;
}

function resourceIdentity(
  type: keyof NonNullable<SyncManifest["resources"]["repository"]>,
  sourcePath: string,
  fingerprint: string,
  baseline: RepositoryBaseline,
): string {
  const records = Object.values(baseline);
  const atPath = records.filter((record) => record.path === sourcePath);
  if (atPath.length === 1) return atPath[0]!.identity;
  const atFingerprint = records.filter((record) => record.fingerprint === fingerprint);
  if (atFingerprint.length === 1) return atFingerprint[0]!.identity;
  return `${type.slice(0, -1)}:${hashContent(sourcePath).slice(0, 24)}`;
}

function parseSkillMetadata(content: string | undefined): Record<string, unknown> {
  if (content === undefined) return {};
  try {
    const parsed: unknown = JSON.parse(content);
    if (!repositoryIsRecord(parsed)) throw new Error("not an object");
    return parsed;
  } catch {
    throw new RepositorySyncScanError("Invalid skill metadata");
  }
}

function scanRepositoryDocs(worktree: string): RepositoryDocManifestEntry[] {
  const docsDir = resolve(worktree, "docs");
  const entries = walkRepositoryFiles(worktree, docsDir, REPOSITORY_MAX_FILE_BYTES)
    .filter((file) => file.path.startsWith("docs/") && file.path.endsWith(".md"));
  let total = 0;
  return entries.map((file) => {
    total += Buffer.byteLength(file.content);
    if (total > REPOSITORY_MAX_DOC_BYTES) throw new RepositorySyncScanError();
    return { path: file.path, sha256: hashContent(file.content), content: file.content, fileType: "regular", isSymlink: false };
  });
}

function scanRepositorySkills(worktree: string, baseline: RepositoryBaseline): RepositorySkillManifestEntry[] {
  const skillsRoot = assertContainedDirectory(worktree, resolve(worktree, ".opencode", "skills"));
  if (!skillsRoot) return [];
  const entries: RepositorySkillManifestEntry[] = [];
  for (const name of readdirSync(skillsRoot).sort((a, b) => a.localeCompare(b))) {
    if (!safeRepositoryName(name)) throw new RepositorySyncScanError();
    const skillDir = resolve(skillsRoot, name);
    // `.opencode/skills` also owns support artifacts such as the consolidation
    // map and fallback learning logs. Only a real directory with a regular
    // SKILL.md entry point is a repository-managed skill resource.
    let skillDirectoryStat;
    try {
      skillDirectoryStat = lstatSync(skillDir);
    } catch {
      throw new RepositorySyncScanError();
    }
    if (skillDirectoryStat.isSymbolicLink() || !skillDirectoryStat.isDirectory()) continue;
    if (existsSync(resolve(skillDir, MIGRATED_TO_MARKER))) continue;
    const skillMdPath = resolve(skillDir, "SKILL.md");
    let skillMdStat;
    try {
      skillMdStat = lstatSync(skillMdPath);
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw new RepositorySyncScanError();
    }
    if (skillMdStat.isSymbolicLink() || !skillMdStat.isFile()) continue;
    const allFiles = walkRepositoryFiles(worktree, skillDir, REPOSITORY_MAX_RESOURCE_BYTES);
    const skillMd = allFiles.find((file) => file.absolutePath === skillMdPath);
    if (!skillMd) throw new RepositorySyncScanError();
    const metadataFile = allFiles.find((file) => file.path.endsWith(`/${name}/metadata.json`));
    const parsed = parseRepositoryFrontmatter(skillMd.content);
    if (parsed.fields.name !== name || !safeRepositoryName(parsed.fields.name)) throw new RepositorySyncScanError();
    const metadata = parseSkillMetadata(metadataFile?.content);
    const tags = Array.isArray(metadata.tags) && metadata.tags.every((tag) => typeof tag === "string") ? [...metadata.tags] as string[] : [];
    const alwaysApply = metadata.alwaysApply === true;
    const category = typeof metadata.category === "string" ? metadata.category : parsed.fields.category;
    const fileTree = Object.fromEntries(allFiles
      .filter((file) => file !== skillMd && file !== metadataFile)
      .map((file) => [relative(skillDir, file.absolutePath).split(sep).join("/"), file.content]));
    const semantic = { path: skillMd.path, name, skillMd: skillMd.content, body: parsed.body, description: parsed.fields.description ?? "", category, tags, alwaysApply, metadata, fileTree };
    // The semantic SHA below includes every auxiliary path. This separate
    // content fingerprint intentionally omits auxiliary paths so a uniquely
    // identifiable nested reference-file move retains its stable resource ID.
    const fingerprint = repositoryHash({ name, skillMd: skillMd.content, body: parsed.body, description: parsed.fields.description ?? "", category, tags, alwaysApply, metadata, fileContents: Object.values(fileTree).sort() });
    entries.push({ identity: resourceIdentity("skills", skillMd.path, fingerprint, baseline), sha256: repositoryHash(semantic), ...semantic });
  }
  return entries;
}

function parseAgentSkills(frontmatter: string): string[] {
  const lines = frontmatter.split("\n");
  const start = lines.findIndex((line) => /^skills:\s*$/.test(line));
  if (start < 0) return [];
  const skills: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!/^\s/.test(line)) break;
    const match = line.match(/^\s+-\s+(.+?)\s*$/);
    if (match) skills.push(match[1]!);
  }
  return skills;
}

interface AgentCandidate {
  path: string;
  name: string;
  category: typeof AGENT_CATEGORIES[number] | null;
  frontmatter: string;
  body: string;
  description: string;
  mode: string;
  permissions: Record<string, unknown>;
  metadata: Record<string, unknown>;
  skills: string[];
  enabled: boolean;
  fingerprint: string;
}

/** A managed profile is either categorized or a root-level compatibility mirror. */
function isRepositoryAgentProfileLocation(agentsRoot: string, file: RepositoryDiskFile): boolean {
  const segments = repositoryRelativePath(agentsRoot, file.absolutePath).split("/");
  return (segments.length === 1 && file.path.endsWith(".md"))
    || (segments.length === 2 && isAgentCategory(segments[0]) && file.path.endsWith(".md"));
}

/**
 * Diagnostics can live beside compatibility mirrors. Treat only complete,
 * self-identifying profiles as resources instead of rejecting unrelated notes.
 */
function parseRepositoryAgentCandidate(agentsRoot: string, file: RepositoryDiskFile): AgentCandidate | null {
  if (!isRepositoryAgentProfileLocation(agentsRoot, file)) return null;

  let parsed: ReturnType<typeof parseRepositoryFrontmatter>;
  try {
    parsed = parseRepositoryFrontmatter(file.content);
  } catch {
    return null;
  }

  const name = parsed.fields.name;
  const description = parsed.fields.description;
  const mode = parsed.fields.mode;
  if (!safeRepositoryName(name)
    || name !== basename(file.path, ".md")
    || !description?.trim()
    || !mode?.trim()
    || !/^permission:\s*$/m.test(parsed.raw)) {
    return null;
  }

  const relativePath = repositoryRelativePath(agentsRoot, file.absolutePath);
  const segments = relativePath.split("/");
  const category = segments.length === 2 ? segments[0]! as typeof AGENT_CATEGORIES[number] : null;
  const permissions = parseAgentPermissionFrontmatter(file.content);
  const metadata = parseAgentMetadata(parsed.fields);
  const skills = parseAgentSkills(parsed.raw);
  const semantic = {
    name,
    category: category ?? "execution",
    frontmatter: parsed.raw,
    body: parsed.body,
    description,
    mode,
    permissions,
    metadata,
    skills,
    enabled: true,
  };
  // A root compatibility mirror has no category directory. Category therefore
  // cannot participate in mirror equivalence, but remains semantic for the
  // canonical agent that is sent to the API.
  const { category: _mirrorCategory, ...mirrorSemantic } = semantic;
  return { path: file.path, ...semantic, fingerprint: repositoryHash(mirrorSemantic) };
}

function scanRepositoryAgents(worktree: string, baseline: RepositoryBaseline): RepositoryAgentManifestEntry[] {
  const agentsRoot = assertContainedDirectory(worktree, resolve(worktree, ".opencode", "agents"));
  if (!agentsRoot) return [];
  // Profiles are public OpenCode metadata, not secrets. A mode-restricted
  // regular file can be readable to a build user yet unreadable to the runtime
  // appuser, so ignore it rather than failing repository initialization. Core,
  // extension, and Docker startup writers normalize legitimate profiles to 0644.
  const candidates = walkRepositoryFiles(
    worktree,
    agentsRoot,
    REPOSITORY_MAX_RESOURCE_BYTES,
    (filePath, mode) => !filePath.endsWith(".md") || (mode & 0o777) === 0o644,
  )
    .filter((file) => file.path.endsWith(".md"));
  const byName = new Map<string, AgentCandidate[]>();
  for (const file of candidates) {
    const candidate = parseRepositoryAgentCandidate(agentsRoot, file);
    if (!candidate || isReservedBroker(candidate.name)) continue;
    const group = byName.get(candidate.name) ?? [];
    group.push(candidate);
    byName.set(candidate.name, group);
  }

  const entries: RepositoryAgentManifestEntry[] = [];
  for (const [name, group] of [...byName.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const categorized = group.filter((candidate) => candidate.category !== null);
    const canonical = [...categorized].sort((left, right) => left.path.localeCompare(right.path))[0] ?? group[0]!;
    if (!canonical.category) canonical.category = "execution";
    const mirrors = group.filter((candidate) => candidate !== canonical).map((candidate) => candidate.path).sort();
    // A duplicate is allowed only as a byte-semantic compatibility mirror.
    if (group.some((candidate) => candidate.fingerprint !== canonical.fingerprint)) throw new RepositorySyncScanError("Conflicting agent duplicates");
    const semantic = {
      path: canonical.path,
      name,
      category: canonical.category,
      frontmatter: canonical.frontmatter,
      body: canonical.body,
      description: canonical.description,
      mode: canonical.mode,
      permissions: canonical.permissions,
      metadata: canonical.metadata,
      skills: canonical.skills,
      mirrors,
      enabled: canonical.enabled,
    };
    const { path: _agentPath, category: _agentCategory, mirrors: _agentMirrors, ...agentFingerprint } = semantic;
    const fingerprint = repositoryHash(agentFingerprint);
    entries.push({ identity: resourceIdentity("agents", canonical.path, fingerprint, baseline), sha256: repositoryHash(semantic), ...semantic });
  }
  return entries;
}

interface PluginConfigEntry {
  path: string;
  enabled: boolean;
  order: number;
  options: Record<string, unknown>;
}

function parseConfiguredPlugins(worktree: string): PluginConfigEntry[] {
  const configPath = resolve(worktree, "opencode.json");
  try {
    lstatSync(configPath);
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw new RepositorySyncScanError("Invalid opencode.json");
  }
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readRepositoryRegularText(worktree, configPath).replace(/^\s*\/\/.*$/gm, "")) as Record<string, unknown>;
  } catch { throw new RepositorySyncScanError("Invalid opencode.json"); }
  if (config.plugin === undefined) return [];
  if (!Array.isArray(config.plugin)) throw new RepositorySyncScanError("Invalid plugin array");
  return config.plugin.map((entry, order) => {
    const configuredPath = typeof entry === "string"
      ? entry
      : repositoryIsRecord(entry) && typeof entry.path === "string"
        ? entry.path
        : undefined;
    if (!configuredPath) throw new RepositorySyncScanError("Invalid plugin entry");
    const normalizedPath = repositoryRelativePath(worktree, configuredPath);
    if (!isAllowedRepositoryPluginPath(normalizedPath)) throw new RepositorySyncScanError("Plugin source is outside the allowed roots");
    if (typeof entry === "string") return { path: normalizedPath, enabled: true, order, options: {} };
    if (!repositoryIsRecord(entry) || typeof entry.path !== "string") throw new RepositorySyncScanError("Invalid plugin entry");
    const rawOptions = repositoryIsRecord(entry.options) ? entry.options : Object.fromEntries(Object.entries(entry).filter(([key]) => !["path", "enabled", "options", "name"].includes(key)));
    const options = stripSecretLikePluginOptionKeys(rawOptions);
    return { path: normalizedPath, enabled: entry.enabled !== false, order, options: options as Record<string, unknown> };
  });
}

function scanRepositoryPlugins(worktree: string, baseline: RepositoryBaseline): RepositoryPluginManifestEntry[] {
  const configured = parseConfiguredPlugins(worktree);
  const candidates = new Map<string, PluginConfigEntry>();
  for (const entry of configured) {
    candidates.set(entry.path, entry);
  }
  const pluginsRoot = resolve(worktree, ".opencode", "plugins");
  for (const local of walkRepositoryFiles(worktree, pluginsRoot, REPOSITORY_MAX_RESOURCE_BYTES)) {
    if (!isAllowedRepositoryPluginPath(local.path)) continue;
    candidates.set(local.path, candidates.get(local.path) ?? { path: local.path, enabled: false, order: -1, options: {} });
  }
  const usedNames = new Set<string>();
  const entries: RepositoryPluginManifestEntry[] = [];
  for (const candidate of [...candidates.values()].sort((left, right) => left.path.localeCompare(right.path))) {
    if (!isAllowedRepositoryPluginPath(candidate.path)) throw new RepositorySyncScanError("Plugin source is outside the allowed roots");
    const fullPath = resolve(worktree, candidate.path);
    let source: string;
    try {
      source = normalizeRepositoryText(readRepositoryRegularText(worktree, fullPath));
    } catch {
      throw new RepositorySyncScanError("Plugin source is missing or unsafe");
    }
    if (Buffer.byteLength(source) > REPOSITORY_MAX_RESOURCE_BYTES) throw new RepositorySyncScanError();
    let name = basename(candidate.path, extname(candidate.path));
    if (!safeRepositoryName(name)) throw new RepositorySyncScanError();
    if (usedNames.has(name)) name = `${name}-${hashContent(candidate.path).slice(0, 8)}`;
    usedNames.add(name);
    const order = candidate.order >= 0 ? candidate.order : null;
    const semantic = { path: candidate.path, name, source, fileType: "regular" as const, isSymlink: false as const, enabled: candidate.enabled, order, options: candidate.options };
    const fingerprint = repositoryHash({ name, source, fileType: "regular", isSymlink: false, enabled: candidate.enabled, order, options: candidate.options });
    entries.push({ identity: resourceIdentity("plugins", candidate.path, fingerprint, baseline), sha256: repositoryHash(semantic), ...semantic });
  }
  return entries;
}

/** Build the complete, local repository projection without network or disk writes. */
export function buildRepositoryManifestV2(worktree: string, manifest?: SyncManifest): RepositoryManifestV2 {
  const current = manifest ?? emptyManifest(resolveExtensionProject(worktree));
  const repository = repositoryBaseline(current);
  return {
    version: 2,
    docs: scanRepositoryDocs(worktree),
    skills: scanRepositorySkills(worktree, repository.skills),
    agents: scanRepositoryAgents(worktree, repository.agents),
    plugins: scanRepositoryPlugins(worktree, repository.plugins),
  };
}

/** Maps resource name to its SHA-256 hash for change detection. */
export interface ResourceHashes {
  [name: string]: string; // name → sha256
}

/**
 * Sync state manifest stored at .opencode/.ingenium-sync-state.json.
 *
 * The baseline hashes enable three-way comparison (API vs disk vs manifest)
 * for conflict detection. When the project changes (e.g., switching worktrees),
 * the manifest is replaced entirely.
 */
export interface SyncManifest {
  version: 1 | 2;
  project: string;
  /** Immutable API project ID. A changed ID means the API database was recreated. */
  projectId?: string;
  lastFullSync: string;
  resources: {
    skills: ResourceHashes;
    agents: ResourceHashes;
    plugins: ResourceHashes;
    commands: ResourceHashes;
    config: { hash?: string };
    /** V2 repository-authoritative baseline. Commands and global config are excluded. */
    repository?: {
      docs: RepositoryBaseline;
      skills: RepositoryBaseline;
      agents: RepositoryBaseline;
      plugins: RepositoryBaseline;
    };
  };
}

export interface RepositoryBaselineRecord {
  identity: string;
  path: string;
  hash: string;
  /** Content-only fingerprint lets a unique nested move retain its identity. */
  fingerprint: string;
}

export type RepositoryBaseline = Record<string, RepositoryBaselineRecord>;

function emptyManifest(project: string): SyncManifest {
  return {
    version: 2,
    project,
    lastFullSync: new Date().toISOString(),
    resources: {
      skills: {},
      agents: {},
      plugins: {},
      commands: {},
      config: {},
      repository: { docs: {}, skills: {}, agents: {}, plugins: {} },
    },
  };
}

/** Return a canonical, non-symlinked `.opencode` directory for manifest I/O. */
function verifiedManifestDirectory(worktree: string, create: boolean): string | null {
  const root = repositoryWorktreeRoot(worktree);
  const directory = resolve(root, ".opencode");
  try {
    let directoryStat;
    try {
      directoryStat = lstatSync(directory);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      if (!create) return null;
      assertNoSymlinkedAncestors(directory);
      mkdirSync(directory);
      directoryStat = lstatSync(directory);
    }
    assertNoSymlinkedAncestors(directory, true);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new RepositorySyncScanError();
    const canonical = realpathSync(directory);
    if (!canonical.startsWith(root + sep)) throw new RepositorySyncScanError();
    return canonical;
  } catch (error) {
    if (error instanceof RepositorySyncScanError) throw error;
    throw new RepositorySyncScanError();
  }
}

export function loadManifest(worktree: string, project: string): SyncManifest {
  try {
    const directory = verifiedManifestDirectory(worktree, false);
    if (!directory) return emptyManifest(project);
    const manifestPath = resolve(directory, ".ingenium-sync-state.json");
    try {
      lstatSync(manifestPath);
    } catch (error) {
      if (isMissingPathError(error)) return emptyManifest(project);
      throw error;
    }
    const raw = readRepositoryRegularText(worktree, manifestPath);
    const parsed = JSON.parse(raw);
    // Validate structure
    if ((parsed.version !== 1 && parsed.version !== 2) || !parsed.resources) return emptyManifest(project);
    // If project changed, start fresh
    if (parsed.project !== project) return emptyManifest(project);
    const manifest = parsed as SyncManifest;
    manifest.version = 2;
    manifest.resources.repository ??= { docs: {}, skills: {}, agents: {}, plugins: {} };
    return manifest;
  } catch {
    return emptyManifest(project);
  }
}

export function saveManifest(worktree: string, manifest: SyncManifest): void {
  const directory = verifiedManifestDirectory(worktree, true);
  if (!directory) throw new RepositorySyncScanError();
  const manifestPath = resolve(directory, ".ingenium-sync-state.json");
  try {
    const existing = lstatSync(manifestPath);
    if (existing.isSymbolicLink() || !existing.isFile()) throw new RepositorySyncScanError();
  } catch (error) {
    if (!isMissingPathError(error)) {
      if (error instanceof RepositorySyncScanError) throw error;
      throw new RepositorySyncScanError();
    }
  }

  const temporaryPath = resolve(directory, `.ingenium-sync-state.${process.pid}.${randomUUID()}.tmp`);
  const content = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf-8");
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    if (!fstatSync(descriptor).isFile()) throw new RepositorySyncScanError();
    for (let offset = 0; offset < content.length;) {
      offset += writeSync(descriptor, content, offset, content.length - offset);
    }
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;

    // Re-validate immediately before rename so the atomic replacement remains
    // bound to the same verified directory.
    if (verifiedManifestDirectory(worktree, false) !== directory) throw new RepositorySyncScanError();
    renameSync(temporaryPath, manifestPath);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      if (verifiedManifestDirectory(worktree, false) === directory) unlinkSync(temporaryPath);
    } catch { /* preserve an untrusted path rather than following it during cleanup */ }
    if (error instanceof RepositorySyncScanError) throw error;
    throw new RepositorySyncScanError();
  }
}

/**
 * Generic HTTP GET helper for the Ingenium API.
 * Returns null on any failure (non-2xx, network error, parse error) for resilient sync.
 * The caller's catch block handles the null; individual sync failures must not cascade.
 */
async function apiGet<T>(worktree: string, path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: apiRequestHeaders(worktree) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function encodeProject(project: string): string {
  return `project=${encodeURIComponent(project)}`;
}

/** Tracks sync outcomes for a single resource type: what was written, pushed, removed, or conflicted. */
export interface SyncResult {
  synced: number;   // items written to disk
  pushed: number;   // items pushed to API
  removed: number;  // items removed from disk (API deleted)
  conflicts: number;
  skipped: number;
  errors: number;
}

/** Aggregate sync result. Legacy command/config fields remain empty for compatibility. */
export interface FullSyncResult {
  docs?: SyncResult;
  skills: SyncResult;
  agents: SyncResult;
  plugins: SyncResult;
  commands: SyncResult;
  config: SyncResult;
}

function emptyResult(): SyncResult {
  return { synced: 0, pushed: 0, removed: 0, conflicts: 0, skipped: 0, errors: 0 };
}

/**
 * MIGRATED-TO marker filename. Presence of this file in a skill directory indicates
 * the skill has been consolidated into a canonical skill via the taxonomy migration.
 * Resource sync skips directories containing this marker to prevent resurrection
 * of absorbed legacy skills.
 */
const MIGRATED_TO_MARKER = "MIGRATED-TO.md";

/** Scan disk for skill directories and return name→content-hash map. */
function scanDiskSkills(worktree: string): Map<string, string> {
  const map = new Map<string, string>();
  const skillsDir = resolve(worktree, ".opencode", "skills");

  // Reject symlinked skills root
  if (existsSync(skillsDir)) {
    try {
      if (lstatSync(skillsDir).isSymbolicLink()) return map;
      const rootCanon = realpathSync(skillsDir);
      const parentCanon = realpathSync(resolve(worktree, ".opencode"));
      if (!rootCanon.startsWith(parentCanon + sep) && rootCanon !== parentCanon) return map;
    } catch { return map; }
  }

  if (!existsSync(skillsDir)) return map;
  try {
    for (const entry of readdirSync(skillsDir)) {
      // Skip unsafe names and directory symlinks
      if (!isSafeName(entry)) continue;
      const dir = resolve(skillsDir, entry);
      try {
        if (lstatSync(dir).isSymbolicLink()) continue;
      } catch { continue; }
      if (!statSync(dir).isDirectory()) continue;

      // 🔴 Phase 3 defense: Skip directories containing a MIGRATED-TO.md marker.
      // These are legacy skills that have been absorbed into a canonical skill.
      // Their source content lives in the canonical skill's references/sources/ dir.
      // Discovering them via SKILL.md would resurrect absorbed skills and break
      // the taxonomy consolidation accounting.
      if (existsSync(resolve(dir, MIGRATED_TO_MARKER))) continue;

      const mdPath = resolve(dir, "SKILL.md");
      if (!existsSync(mdPath)) continue;
      const rawContent = readFileSync(mdPath, "utf-8");
      // Hash only the body (without YAML frontmatter) to match API representation
      const { body } = parseYamlFrontmatter(rawContent);
      map.set(entry, hashContent(body));
    }
  } catch {
    // non-fatal
  }
  return map;
}

/** Map reserved names to their resolved canonical paths for normalization defense. */
const RESERVED_PATHS = new Set(["SKILL.md", "metadata.json"]);

/**
 * Minimal safe-skill-name check that matches the core isSafeSkillName contract
 * without importing ingenium-core (DB-isolation boundary).
 */
function isSafeName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  if (name.length === 0 || name.length > 64) return false;
  if (name === "." || name === "..") return false;
  if (name.includes("/") || name.includes("\\")) return false;
  if (name.includes("\x00")) return false;
  return true;
}

const AGENT_CATEGORIES = ["primary", "execution", "research", "security", "chat"] as const;
const LLM_BROKER_AGENT = "ingenium-llm-broker";
const LLM_BROKER_DESCRIPTION = "Internal agent for Ingenium LLM broker — never invoke directly";
const LLM_BROKER_CATEGORY = "execution";
const LLM_BROKER_MODE = "subagent";
const LLM_BROKER_PERMISSIONS = '{"*":"deny"}';
const LLM_BROKER_METADATA = '{"hidden":true}';
const LLM_BROKER_SKILLS = "[]";
const LLM_BROKER_CONTENT = `This agent is reserved for system use. Do not invoke directly.

Its wildcard-deny permission boundary intentionally has no exceptions: it has no
file, shell, browser, MCP, task, skill, or other tool access. The API always
selects this profile for broker requests; request-level tool selections cannot
grant capabilities that this profile denies.
`;

interface AgentSyncRecord {
  name: string;
  content: string;
  description?: string;
  category?: string;
  mode?: string;
  model?: string | null;
  reasoning_effort?: string | null;
  permissions?: string;
  metadata?: string;
  skills?: string;
  /** API rows preserve SQLite's raw 0/1 representation in some deployments. */
  enabled?: boolean | 0 | 1;
}

function isReservedBroker(name: string): boolean {
  return name === LLM_BROKER_AGENT;
}

/**
 * The extension has no database access, so it carries the same fixed template
 * that migration 058 and the core bootstrap enforce. A broker API row is never
 * a source of content: it is accepted only when every material field matches.
 */
function isCanonicalBrokerRecord(agent: AgentSyncRecord): boolean {
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
    && (agent.enabled === true || agent.enabled === 1);
}

function isSafeAgentName(name: unknown): name is string {
  return typeof name === "string"
    && name.length > 0
    && name.length <= 64
    && name.trim() === name
    && name !== "."
    && name !== ".."
    && !/[\\/\u0000-\u001f\u007f]/.test(name);
}

function isAgentCategory(category: unknown): category is typeof AGENT_CATEGORIES[number] {
  return typeof category === "string" && (AGENT_CATEGORIES as readonly string[]).includes(category);
}

/** Return a canonical agents root only when it is contained by the worktree. */
function safeAgentsRoot(worktree: string, create = false): string | null {
  try {
    const worktreeCanon = realpathSync(worktree);
    const openCodeDir = resolve(worktree, ".opencode");
    if (existsSync(openCodeDir)) {
      if (lstatSync(openCodeDir).isSymbolicLink()) return null;
    } else if (create) {
      mkdirSync(openCodeDir, { recursive: true });
    } else {
      return null;
    }
    const openCodeCanon = realpathSync(openCodeDir);
    if (!openCodeCanon.startsWith(worktreeCanon + sep)) return null;

    const agentsDir = resolve(openCodeCanon, "agents");
    if (existsSync(agentsDir)) {
      if (lstatSync(agentsDir).isSymbolicLink()) return null;
    } else if (create) {
      mkdirSync(agentsDir, { recursive: true });
    } else {
      return null;
    }
    const agentsCanon = realpathSync(agentsDir);
    return agentsCanon.startsWith(openCodeCanon + sep) ? agentsCanon : null;
  } catch {
    return null;
  }
}

function safeAgentFilePath(worktree: string, name: string, category: string, create = false): string | null {
  if (!isSafeAgentName(name) || !isAgentCategory(category)) return null;
  const agentsRoot = safeAgentsRoot(worktree, create);
  if (!agentsRoot) return null;
  const categoryDir = resolve(agentsRoot, category);
  try {
    if (existsSync(categoryDir)) {
      if (lstatSync(categoryDir).isSymbolicLink()) return null;
    } else if (create) {
      mkdirSync(categoryDir, { recursive: true });
    } else {
      return null;
    }
    const categoryCanon = realpathSync(categoryDir);
    if (!categoryCanon.startsWith(agentsRoot + sep)) return null;
    const filePath = resolve(categoryCanon, `${name}.md`);
    if (!filePath.startsWith(categoryCanon + sep)) return null;
    return filePath;
  } catch {
    return null;
  }
}

/** Write a public agent profile without following a final-path symlink. */
function writePublicAgentProfile(filePath: string, content: string): boolean {
  let descriptor: number | undefined;
  try {
    try {
      const existing = lstatSync(filePath);
      if (existing.isSymbolicLink() || !existing.isFile()) return false;
    } catch (error) {
      if (!isMissingPathError(error)) return false;
    }
    descriptor = openSync(
      filePath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
      0o644,
    );
    if (!fstatSync(descriptor).isFile()) return false;
    writeFileSync(descriptor, content, "utf-8");
    // Existing files retain their mode on write and new files are subject to
    // umask, so explicitly keep non-secret profiles readable by OpenCode.
    fchmodSync(descriptor, 0o644);
    return true;
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function findAgentCategory(worktree: string, name: string): string | null {
  if (!isSafeAgentName(name)) return null;
  for (const category of AGENT_CATEGORIES) {
    const filePath = safeAgentFilePath(worktree, name, category);
    if (!filePath) continue;
    try {
      if (existsSync(filePath) && !lstatSync(filePath).isSymbolicLink()) return category;
    } catch { /* try the next category */ }
  }
  return null;
}

/**
 * Security: Validate a relative file_tree path against a canonical base directory.
 *
 * Rejects:
 *   - Absolute paths (e.g. "/etc/passwd")
 *   - Path traversal (e.g. "../../../evil.txt")
 *   - Empty/`.` paths that resolve to the base directory itself
 *   - Existing directory targets (file_tree entries must be files)
 *   - Reserved canonical filenames (comparing resolved target against resolved
 *     SKILL.md / metadata.json — catches `./SKILL.md`, `refs/../metadata.json`, etc.)
 *   - Dangling symlink ancestors (lstat, not existsSync)
 *   - Existing file symlinks / symlinked existing ancestors (realpath containment)
 *
 * Base directory must be canonical (caller should realpathSync it).
 * Returns the resolved safe absolute path, or null if unsafe.
 */
function safeRelativePath(baseDir: string, relativePath: string): string | null {
  // 1. Reject absolute paths
  if (isAbsolute(relativePath)) return null;

  // 2. Reject empty/`.` paths that resolve to the base directory itself
  if (relativePath === "" || relativePath === ".") return null;

  // 3. Resolve and containment check
  const resolved = resolve(baseDir, relativePath);
  if (!resolved.startsWith(baseDir + sep) && resolved !== baseDir) return null;

  // 4. Reserved-file defense: compare resolved target against canonical reserved paths
  for (const name of RESERVED_PATHS) {
    if (resolved === resolve(baseDir, name)) return null;
  }

  // 5. Reject existing directory targets (file_tree entries must be files)
  try {
    if (existsSync(resolved) && lstatSync(resolved).isDirectory()) return null;
  } catch { /* lstat may fail */ }

  // 6. Walk upward to nearest existing ancestor. Use lstat (not existsSync) to
  //    detect dangling symlinks in the ancestor chain.
  try {
    let walk = resolved;
    for (;;) {
      try {
        if (lstatSync(walk).isSymbolicLink()) return null;
      } catch {
        // lstat threw — path component does not exist. Walk up.
        const parent = dirname(walk);
        if (parent === walk) break;
        walk = parent;
        continue;
      }

      if (existsSync(walk)) {
        const canon = realpathSync(walk);
        if (!canon.startsWith(baseDir + sep) && canon !== baseDir) return null;
        break;
      }
      const parent = dirname(walk);
      if (parent === walk) break;
      walk = parent;
    }
  } catch {
    return null;
  }

  return resolved;
}

/** Write a skill from API data to disk. Returns true if actual write occurred, false if blocked. */
function writeSkillToDisk(worktree: string, skill: { name: string; description: string; content: string; tags?: string; always_apply?: number; file_tree?: string; category?: string }): boolean {
  if (!isSafeName(skill.name)) return false;

  // D1 extra: refuse if the skills root itself is a symlink escape
  const skillsRoot = resolve(worktree, ".opencode", "skills");
  try {
    if (existsSync(skillsRoot)) {
      if (lstatSync(skillsRoot).isSymbolicLink()) return false;
      const rootCanon = realpathSync(skillsRoot);
      const parentCanon = realpathSync(resolve(worktree, ".opencode"));
      if (!rootCanon.startsWith(parentCanon + sep) && rootCanon !== parentCanon) return false;
    }
  } catch { /* allow — root may not exist yet, mkdir creates it */ }

  const dir = resolve(worktree, ".opencode", "skills", skill.name);

  // D1: Refuse top-level skill-dir symlink or canonical escape
  try {
    if (existsSync(dir)) {
      if (lstatSync(dir).isSymbolicLink()) return false;
      const canon = realpathSync(dir);
      const canonBase = realpathSync(resolve(worktree, ".opencode", "skills"));
      if (!canon.startsWith(canonBase + sep) && canon !== canonBase) return false;
    }
  } catch { /* noop — will be created at resolved path */ }

  // 🔴 Phase 3 defense: Refuse to write SKILL.md into a directory that has been
  // marked as migrated. This prevents API→disk resurrection: if a legacy skill
  // DB row is accidentally un-archived, the resource sync will NOT recreate
  // SKILL.md in a directory that still carries the MIGRATED-TO.md marker.
  if (existsSync(dir) && existsSync(resolve(dir, MIGRATED_TO_MARKER))) return false;

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // Canonicalize base directory for symlink defense
  let baseDir = dir;
  try { baseDir = realpathSync(dir); } catch { /* dir just created, fall back to resolved */ }

  // SKILL.md with YAML frontmatter
  const frontmatter = `---\nname: ${skill.name}\ndescription: "${(skill.description || "").replace(/"/g, '\\"')}"\n---\n`;
  writeFileSync(resolve(dir, "SKILL.md"), frontmatter + "\n" + (skill.content || ""));

  // metadata.json — include category when present, exclude undefined fields
  const metaObj: Record<string, unknown> = {};
  const tags = skill.tags ? skill.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
  if (tags.length > 0) metaObj.tags = tags;
  metaObj.alwaysApply = (skill.always_apply || 0) === 1;
  if (skill.category) metaObj.category = skill.category;
  writeFileSync(resolve(dir, "metadata.json"), JSON.stringify(metaObj, null, 2));

  // file_tree entries — use safeRelativePath for containment + symlink defense
  if (skill.file_tree) {
    try {
      const tree = JSON.parse(skill.file_tree) as Record<string, string>;
      for (const [relPath, content] of Object.entries(tree)) {
        if (typeof content !== "string") continue; // skip non-string values
        const filePath = safeRelativePath(baseDir, relPath);
        if (!filePath) continue; // skip unsafe entries
        const parent = dirname(filePath);
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
        writeFileSync(filePath, content, "utf-8");
      }
    } catch {
      /* skip broken file_tree */
    }
  }

  return true;
}

/** Recursively remove a skill directory from disk. */
function removeSkillFromDisk(worktree: string, name: string): void {
  if (!isSafeName(name)) return;
  // Reject if the skills root itself is a symlink
  try {
    const skillsRoot = resolve(worktree, ".opencode", "skills");
    if (existsSync(skillsRoot) && lstatSync(skillsRoot).isSymbolicLink()) return;
  } catch { /* lstat may fail */ }
  const dir = resolve(worktree, ".opencode", "skills", name);
  if (!existsSync(dir)) return;
  try {
    // Reject symlink at root — never follow symlinks during removal
    try {
      if (lstatSync(dir).isSymbolicLink()) { unlinkSync(dir); return; }
    } catch { /* lstat may fail */ }
    rmRecursive(dir);
  } catch {
    /* non-fatal */
  }
}

/**
 * Recursive directory removal — never recurses through symlinks.
 * Symlinks are unlinked (the link itself), their targets are never touched.
 * Uses lstat to distinguish symlinks from real directories.
 */
function rmRecursive(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    try {
      if (lstatSync(full).isSymbolicLink()) {
        unlinkSync(full);
      } else if (statSync(full).isDirectory()) {
        rmRecursive(full);
      } else {
        unlinkSync(full);
      }
    } catch {
      /* non-fatal */
    }
  }
  rmdirSync(dir);
}

function scanDiskAgents(worktree: string): Map<string, string> {
  const map = new Map<string, string>();
  const agentsDir = safeAgentsRoot(worktree);
  if (!agentsDir) return map;
  try {
    for (const category of readdirSync(agentsDir)) {
      if (!isAgentCategory(category)) continue;
      const catDir = resolve(agentsDir, category);
      if (lstatSync(catDir).isSymbolicLink() || !statSync(catDir).isDirectory()) continue;
      const categoryCanon = realpathSync(catDir);
      if (!categoryCanon.startsWith(agentsDir + sep)) continue;
      for (const file of readdirSync(catDir)) {
        if (!file.endsWith(".md")) continue;
        const name = file.slice(0, -3);
        if (!isSafeAgentName(name)) continue;
        const filePath = safeAgentFilePath(worktree, name, category);
        if (!filePath || !existsSync(filePath) || lstatSync(filePath).isSymbolicLink()) continue;
        const rawContent = readFileSync(filePath, "utf-8");
        // Include security-relevant frontmatter in the baseline. Hashing only the
        // body would hide a wildcard-deny or hidden-state edit from sync.
        const { body, frontmatter } = parseYamlFrontmatter(rawContent);
        map.set(name, hashAgentDefinition(
          body,
          JSON.stringify(parseAgentPermissionFrontmatter(rawContent)),
          JSON.stringify(parseAgentMetadata(frontmatter)),
        ));
      }
    }
  } catch {
    /* non-fatal */
  }
  return map;
}

export function writeAgentToDisk(
  worktree: string,
  agent: {
    name: string;
    content: string;
    description?: string;
    category?: string;
    mode?: string;
    model?: string | null;
    permissions?: string;
    metadata?: string;
  },
): boolean {
  if (!isSafeAgentName(agent.name)) return false;
  const category = isReservedBroker(agent.name) ? LLM_BROKER_CATEGORY : agent.category || "execution";
  if (!isAgentCategory(category)) return false;
  const filePath = safeAgentFilePath(worktree, agent.name, category, true);
  if (!filePath) return false;
  try {
    if (existsSync(filePath) && lstatSync(filePath).isSymbolicLink()) return false;
  } catch { return false; }

  const parts: string[] = [];
  parts.push(`name: ${agent.name}`);
  const description = isReservedBroker(agent.name) ? LLM_BROKER_DESCRIPTION : agent.description;
  const mode = isReservedBroker(agent.name) ? LLM_BROKER_MODE : agent.mode;
  if (description) parts.push(`description: "${description.replace(/"/g, '\\"')}"`);
  if (mode) parts.push(`mode: ${mode}`);
  const metadata = isReservedBroker(agent.name)
    ? { hidden: true }
    : parseSerializedAgentObject(agent.metadata);
  if (metadata.hidden === true) parts.push("hidden: true");
  const permissions = isReservedBroker(agent.name)
    ? { "*": "deny" }
    : parseSerializedAgentObject(agent.permissions);
  if (Object.keys(permissions).length > 0) {
    parts.push("permission:");
    appendAgentYamlObject(parts, permissions, 2);
  }
  const frontmatter = `---\n${parts.join("\n")}\n---\n`;

  const content = isReservedBroker(agent.name) ? LLM_BROKER_CONTENT : agent.content || "";
  return writePublicAgentProfile(filePath, frontmatter + "\n" + content);
}

function configuredAgentModel(worktree: string, name: string): string | undefined {
  const configPath = resolve(worktree, "opencode.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const raw = readFileSync(configPath, "utf-8").replace(/^\s*\/\/.*$/gm, "");
    const config = JSON.parse(raw) as { agent?: Record<string, { model?: unknown }> };
    const model = config.agent?.[name]?.model;
    return typeof model === "string" ? model : undefined;
  } catch {
    return undefined;
  }
}

function removeAgentFromDisk(worktree: string, name: string, category?: string): boolean {
  const filePath = safeAgentFilePath(worktree, name, category || "execution");
  if (!filePath) return false;
  if (existsSync(filePath)) {
    try { unlinkSync(filePath); return true; } catch { /* non-fatal */ }
  }
  return false;
}

function removeAgentFromAllCategories(worktree: string, name: string): boolean {
  let removed = false;
  for (const category of AGENT_CATEGORIES) {
    removed = removeAgentFromDisk(worktree, name, category) || removed;
  }
  return removed;
}

function scanDiskPlugins(worktree: string): Map<string, string> {
  const map = new Map<string, string>();
  const pluginsDir = resolve(worktree, ".opencode", "plugins");
  if (!existsSync(pluginsDir)) return map;
  try {
    for (const file of readdirSync(pluginsDir)) {
      if (!file.endsWith(".ts")) continue;
      const name = file.slice(0, -3);
      const hash = hashFile(resolve(pluginsDir, file));
      if (hash) map.set(name, hash);
    }
  } catch {
    /* non-fatal */
  }
  return map;
}

function writePluginToDisk(worktree: string, plugin: { name: string; file_path: string; source_content?: string }): void {
  if (!plugin.source_content) return;
  const filePath = resolve(worktree, plugin.file_path || `.opencode/plugins/${plugin.name}.ts`);
  const parent = dirname(filePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(filePath, plugin.source_content, "utf-8");
}

function removePluginFromDisk(worktree: string, filePath: string): void {
  const fullPath = resolve(worktree, filePath);
  if (existsSync(fullPath)) {
    try { unlinkSync(fullPath); } catch { /* non-fatal */ }
  }
}

function scanDiskCommands(worktree: string): Map<string, string> {
  const map = new Map<string, string>();
  const commandsDir = resolve(worktree, ".opencode", "commands");
  if (!existsSync(commandsDir)) return map;
  try {
    for (const file of readdirSync(commandsDir)) {
      if (!file.endsWith(".md")) continue;
      const name = file.slice(0, -3);
      const hash = hashFile(resolve(commandsDir, file));
      if (hash) map.set(name, hash);
    }
  } catch {
    /* non-fatal */
  }
  return map;
}

function writeCommandToDisk(worktree: string, cmd: { name: string; file_path: string; content?: string }): void {
  const filePath = resolve(worktree, cmd.file_path || `.opencode/commands/${cmd.name}.md`);
  const parent = dirname(filePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(filePath, (cmd.content || ""), "utf-8");
}

function removeCommandFromDisk(worktree: string, filePath: string): void {
  const fullPath = resolve(worktree, filePath);
  if (existsSync(fullPath)) {
    try { unlinkSync(fullPath); } catch { /* non-fatal */ }
  }
}

function scanDiskConfig(worktree: string): string | null {
  const configPath = resolve(worktree, "opencode.json");
  return hashFile(configPath);
}

function writeConfigToDisk(worktree: string, content: string): void {
  const configPath = resolve(worktree, "opencode.json");
  const parent = dirname(configPath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(configPath, content, "utf-8");
}

/**
 * Merge API plugin definitions into the local opencode.json plugin[] array.
 * Returns the updated config string and whether the array changed.
 */
function mergePluginsIntoConfig(
  worktree: string,
  apiPlugins: Array<{ name: string; file_path: string; enabled?: boolean }>,
): { config: string | null; changed: boolean } {
  const configPath = resolve(worktree, "opencode.json");
  if (!existsSync(configPath)) return { config: null, changed: false };

  try {
    const raw = readFileSync(configPath, "utf-8");
    // HACK: Strip JSONC comments before parsing — opencode.json is technically JSONC.
    // This only handles full-line comments, not trailing inline comments.
    const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
    const config = JSON.parse(stripped);
    const existing: string[] = Array.isArray(config.plugin) ? config.plugin : [];

    // Build set of enabled API plugin file paths
    const apiPaths = new Set(apiPlugins.filter((p) => p.enabled !== false).map((p) => p.file_path));

    // Preserve user plugins plus the three bootstrap plugins that make project
    // provisioning and sync possible. Those bootstrap entries must survive an
    // API database reset even though the recreated project has no plugin rows yet.
    const isIngenium = (p: string) => p.includes("ingenium-extension");
    const isBootstrapPlugin = (p: string) => /(?:^|\/)(?:auto-observer|observer|resource-sync)(?:\.ts|\.js)?$/.test(p);
    const userPlugins = existing.filter((p) => !isIngenium(p) || isBootstrapPlugin(p));

    // Build new plugin array: user plugins + API-managed plugins
    const newPlugins = [...new Set([...userPlugins, ...Array.from(apiPaths)])];
    const changed = JSON.stringify(newPlugins.sort()) !== JSON.stringify(existing.sort());

    if (changed) {
      // Reconstruct the JSON preserving comment style
      config.plugin = newPlugins;
      return { config: JSON.stringify(config, null, 2), changed };
    }
    return { config: null, changed: false };
  } catch {
    return { config: null, changed: false };
  }
}

/**
 * Recursively collect regular text files under a directory into a flat path→content map.
 * Excludes SKILL.md, metadata.json, and all symlinks.
 * For symlink defense: canonicalize baseDir and verify realpath of each file.
 */
function collectAuxiliaryFiles(baseDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (currentDir: string, prefix: string) => {
    let entries;
    try { entries = readdirSync(currentDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const relPath = prefix + entry.name;
      if (relPath === "SKILL.md" || relPath === "metadata.json") continue;
      const fullPath = resolve(currentDir, entry.name);
      if (entry.isDirectory()) {
        try {
          const canon = realpathSync(fullPath);
          if (!canon.startsWith(baseDir + sep) && canon !== baseDir) continue;
        } catch { continue; }
        walk(fullPath, prefix + entry.name + "/");
      } else if (entry.isFile()) {
        // Skip symlinks
        try {
          if (lstatSync(fullPath).isSymbolicLink()) continue;
          const canon = realpathSync(fullPath);
          if (!canon.startsWith(baseDir + sep) && canon !== baseDir) continue;
        } catch { continue; }
        try { files[relPath] = readFileSync(fullPath, "utf-8"); } catch { /* skip unreadable */ }
      }
    }
  };
  walk(baseDir, "");
  return files;
}

/** Push a skill from disk to API (disk → API direction, used by onboarding and conflict resolution). */
async function pushSkillToApi(worktree: string, project: string, name: string, lockToken?: string): Promise<boolean> {
  // D3: Independent name and root symlink guards
  if (!isSafeName(name)) return false;

  // Reject if the skills root itself is a symlink escape
  const skillsRoot = resolve(worktree, ".opencode", "skills");
  try {
    if (existsSync(skillsRoot)) {
      if (lstatSync(skillsRoot).isSymbolicLink()) return false;
      const rootCanon = realpathSync(skillsRoot);
      const parentCanon = realpathSync(resolve(worktree, ".opencode"));
      if (!rootCanon.startsWith(parentCanon + sep) && rootCanon !== parentCanon) return false;
    }
  } catch { /* noop — root may not exist */ }

  const dir = resolve(worktree, ".opencode", "skills", name);
  try {
    if (existsSync(dir)) {
      if (lstatSync(dir).isSymbolicLink()) return false;
      const canonDir = realpathSync(dir);
      const canonBase = realpathSync(resolve(worktree, ".opencode", "skills"));
      if (!canonDir.startsWith(canonBase + sep) && canonDir !== canonBase) return false;
    }
  } catch { /* allow if dir doesn't exist */ }

  // 🔴 Phase 3 defense: Reject push from directories marked as migrated.
  // Legacy skills absorbed into canonical skills carry a MIGRATED-TO.md marker.
  // Pushing them back to the API would resurrect absorbed rows and break
  // the taxonomy consolidation accounting.
  if (existsSync(resolve(dir, MIGRATED_TO_MARKER))) return false;

  const skillMdPath = resolve(dir, "SKILL.md");
  if (!existsSync(skillMdPath)) return false;

  try {
    const rawContent = readFileSync(skillMdPath, "utf-8");
    const { body, frontmatter } = parseYamlFrontmatter(rawContent);
    const skillName = frontmatter.name || name;
    // Reject unsafe frontmatter names
    if (!skillName || typeof skillName !== "string" || skillName.includes("/") || skillName.includes("\\") ||
        skillName.includes("\x00") || skillName === "." || skillName === ".." || skillName.length > 64) {
      return false;
    }
    const description = frontmatter.description || "";

    let tags = "";
    let alwaysApply = 0;
    let category = frontmatter.category || ""; // preserve category from frontmatter
    const metaPath = resolve(dir, "metadata.json");
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        tags = Array.isArray(meta.tags) ? meta.tags.join(", ") : (meta.tags || "");
        alwaysApply = meta.alwaysApply ? 1 : 0;
        // metadata.json.category takes precedence over frontmatter
        if (meta.category) category = meta.category;
      } catch { /* ignore bad metadata */ }
    }

    // Collect auxiliary files (non-SKILL.md, non-metadata.json, non-symlink)
    let baseDir = dir;
    try { baseDir = realpathSync(dir); } catch { /* fall back to resolved */ }
    const auxFiles = collectAuxiliaryFiles(baseDir);
    const filesJson = Object.keys(auxFiles).length > 0 ? JSON.stringify(auxFiles) : undefined;

    const bodyPayload: Record<string, unknown> = {
      name: skillName, description, content: body, tags, always_apply: alwaysApply,
    };
    if (category) bodyPayload.category = category;
    if (filesJson) bodyPayload.files = filesJson;

    const res = await fetch(`${API_BASE}/skills?${encodeProject(project)}`, {
      method: "POST",
      headers: apiHeaders(worktree, lockToken),
      body: JSON.stringify(bodyPayload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pushAgentToApi(worktree: string, project: string, name: string, category: string): Promise<boolean> {
  // The reserved broker is provisioned only by the core bootstrap. No disk
  // content, including an exact-looking template, may cross this boundary.
  if (isReservedBroker(name)) return false;
  const filePath = safeAgentFilePath(worktree, name, category);
  if (!filePath || !existsSync(filePath)) return false;
  try {
    if (lstatSync(filePath).isSymbolicLink()) return false;
    const rawContent = readFileSync(filePath, "utf-8");
    const { body, frontmatter } = parseYamlFrontmatter(rawContent);
    const description = frontmatter.description || "";
    const mode = frontmatter.mode || "subagent";
    // Runtime config is the only model source. Legacy markdown model metadata
    // must not be pushed back into the API or reintroduced on a later sync.
    const model = configuredAgentModel(worktree, name) || "";
    const permissions = isReservedBroker(name)
      ? LLM_BROKER_PERMISSIONS
      : JSON.stringify(parseAgentPermissionFrontmatter(rawContent));
    const metadata = isReservedBroker(name)
      ? LLM_BROKER_METADATA
      : JSON.stringify(parseAgentMetadata(frontmatter));
    if (isReservedBroker(name)) {
      // A local file is untrusted input. Rewrite it before the API import so a
      // root-level allow cannot briefly evaluate a stale permissive profile.
      writeAgentToDisk(worktree, {
        name,
        content: body,
        description,
        category,
        mode,
        permissions,
        metadata,
      });
    }
    const res = await fetch(`${API_BASE}/agents?${encodeProject(project)}`, {
      method: "POST",
      headers: apiHeaders(worktree),
      // Disk-only agents are imported disabled. An API deletion therefore cannot
      // be silently undone by a stale local markdown file on a later initial sync.
      body: JSON.stringify({
        name,
        content: body,
        description,
        category,
        mode,
        model,
        // Preserve frontmatter state for ordinary agents. The reserved broker
        // uses its canonical values above regardless of disk input.
        permissions,
        metadata,
        enabled: false,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Capture the normalized disk definition after a successful initial import. */
function readAgentSnapshot(worktree: string, name: string, category: string): AgentSyncRecord | null {
  const filePath = safeAgentFilePath(worktree, name, category);
  if (!filePath || !existsSync(filePath)) return null;
  try {
    if (lstatSync(filePath).isSymbolicLink()) return null;
    const rawContent = readFileSync(filePath, "utf-8");
    const { body, frontmatter } = parseYamlFrontmatter(rawContent);
    return {
      name,
      content: body,
      description: frontmatter.description || "",
      category,
      mode: frontmatter.mode || "subagent",
      model: configuredAgentModel(worktree, name),
      permissions: isReservedBroker(name)
        ? LLM_BROKER_PERMISSIONS
        : JSON.stringify(parseAgentPermissionFrontmatter(rawContent)),
      metadata: isReservedBroker(name)
        ? LLM_BROKER_METADATA
        : JSON.stringify(parseAgentMetadata(frontmatter)),
    };
  } catch {
    return null;
  }
}

function canonicalAgentRecord(agent: AgentSyncRecord): AgentSyncRecord {
  if (!isReservedBroker(agent.name)) return agent;
  return {
    name: LLM_BROKER_AGENT,
    content: LLM_BROKER_CONTENT,
    description: LLM_BROKER_DESCRIPTION,
    category: LLM_BROKER_CATEGORY,
    mode: LLM_BROKER_MODE,
    model: null,
    reasoning_effort: null,
    permissions: LLM_BROKER_PERMISSIONS,
    metadata: LLM_BROKER_METADATA,
    skills: LLM_BROKER_SKILLS,
    enabled: true,
  };
}

function agentRecordHash(agent: AgentSyncRecord): string {
  const canonical = canonicalAgentRecord(agent);
  return hashAgentDefinition(
    canonical.content || "",
    canonical.permissions || "{}",
    canonical.metadata || "{}",
  );
}

async function pushPluginToApi(worktree: string, project: string, name: string, filePathRel: string): Promise<boolean> {
  const fullPath = resolve(worktree, filePathRel);
  if (!existsSync(fullPath)) return false;
  try {
    const sourceContent = readFileSync(fullPath, "utf-8");
    const res = await fetch(`${API_BASE}/plugins?${encodeProject(project)}`, {
      method: "POST",
      headers: apiHeaders(worktree),
      body: JSON.stringify({ name, file_path: filePathRel, source_content: sourceContent }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pushCommandToApi(worktree: string, project: string, name: string, filePathRel: string): Promise<boolean> {
  const fullPath = resolve(worktree, filePathRel);
  if (!existsSync(fullPath)) return false;
  try {
    const content = readFileSync(fullPath, "utf-8");
    const res = await fetch(`${API_BASE}/commands?${encodeProject(project)}`, {
      method: "POST",
      headers: apiHeaders(worktree),
      body: JSON.stringify({ name, file_path: filePathRel, content }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pushConfigToApi(worktree: string, project: string): Promise<boolean> {
  const configPath = resolve(worktree, "opencode.json");
  if (!existsSync(configPath)) return false;
  try {
    const content = readFileSync(configPath, "utf-8");
    const res = await fetch(`${API_BASE}/config?${encodeProject(project)}&type=project`, {
      method: "PUT",
      headers: apiHeaders(worktree),
      body: JSON.stringify({ content }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Minimal YAML frontmatter parser.
 *
 * Extracts name=value lines between `---` markers. Only supports simple key: value pairs
 * (no nested objects, lists, or multiline values). The body is the remaining content
 * with leading whitespace stripped for consistent hashing.
 *
 * NOTE: This is intentionally minimal — no YAML library dependency. OpenCode agent/skill
 * frontmatter only uses simple key: value fields.
 */
function parseYamlFrontmatter(content: string): { body: string; frontmatter: Record<string, string> } {
  // Support both CRLF and LF line endings in the delimiter and body
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?/);
  if (!match) return { body: content, frontmatter: {} };
  const fm: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const eqIdx = line.indexOf(":");
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }
  // Strip leading whitespace/newline from body for consistent hashing
  let body = content.slice(match[0].length);
  while (body.startsWith("\n") || body.startsWith("\r")) {
    body = body.slice(1);
  }
  return { body, frontmatter: fm };
}

type AgentJsonObject = Record<string, unknown>;

function isAgentJsonObject(value: unknown): value is AgentJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSerializedAgentObject(value: string | undefined): AgentJsonObject {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isAgentJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function agentYamlKey(key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(key) ? key : JSON.stringify(key);
}

function agentYamlScalar(value: unknown): string {
  if (typeof value === "string" && /^[A-Za-z0-9._:/-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function appendAgentYamlObject(lines: string[], value: AgentJsonObject, indent: number): void {
  const prefix = " ".repeat(indent);
  for (const [key, child] of Object.entries(value)) {
    if (isAgentJsonObject(child)) {
      lines.push(`${prefix}${agentYamlKey(key)}:`);
      appendAgentYamlObject(lines, child, indent + 2);
    } else {
      lines.push(`${prefix}${agentYamlKey(key)}: ${agentYamlScalar(child)}`);
    }
  }
}

function unquoteAgentYamlScalar(value: string): string {
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

function parseAgentYamlKeyAndValue(value: string): { key: string; value: string } | null {
  const match = value.match(/^(?:"((?:[^"\\]|\\.)*)"|([^:]+)):\s*(.*)$/);
  if (!match) return null;
  const key = match[1] === undefined ? match[2]!.trim() : unquoteAgentYamlScalar(`"${match[1]}"`);
  return { key, value: match[3] ?? "" };
}

function parseAgentPermissionFrontmatter(content: string): AgentJsonObject {
  const block = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!block) return {};
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((line) => /^permission:\s*$/.test(line));
  if (start === -1) return {};

  const permissions: AgentJsonObject = {};
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent < 2) break;
    if (indent !== 2) continue;
    const entry = parseAgentYamlKeyAndValue(line.slice(2));
    if (!entry) continue;
    if (entry.value) {
      permissions[entry.key] = unquoteAgentYamlScalar(entry.value);
      continue;
    }

    const nested: AgentJsonObject = {};
    for (index += 1; index < lines.length; index += 1) {
      const nestedLine = lines[index]!;
      if (!nestedLine.trim() || nestedLine.trimStart().startsWith("#")) continue;
      const nestedIndent = nestedLine.match(/^\s*/)?.[0].length ?? 0;
      if (nestedIndent <= 2) {
        index -= 1;
        break;
      }
      if (nestedIndent !== 4) continue;
      const nestedEntry = parseAgentYamlKeyAndValue(nestedLine.slice(4));
      if (nestedEntry) nested[nestedEntry.key] = unquoteAgentYamlScalar(nestedEntry.value);
    }
    permissions[entry.key] = nested;
  }
  return permissions;
}

function parseAgentMetadata(frontmatter: Record<string, string>): AgentJsonObject {
  return frontmatter.hidden === "true" ? { hidden: true }
    : frontmatter.hidden === "false" ? { hidden: false }
      : {};
}

function hashAgentDefinition(content: string, permissions: string, metadata: string): string {
  return hashContent(JSON.stringify({ content, permissions, metadata }));
}

/**
 * Apply the unified conflict-resolution policy for a single resource.
 *
 * Rules (in order):
 * - API-only (in DB, not on disk) → WRITE to disk, add to manifest
 * - Disk-only (on disk, never in manifest) → PRESERVE, push to API
 * - Disk-only (on disk, in manifest) → API deleted it → REMOVE from disk
 * - API changed, disk matches baseline → PULL API→disk
 * - Disk changed, API matches baseline → PUSH disk→API
 * - Both changed → LOG CONFLICT, preserve both
 * - No changes → skip
 */
async function resolveResource(
  _name: string,
  apiHash: string | undefined,
  diskHash: string | undefined,
  baselineHash: string | undefined,
  opts: {
    writeToDisk: () => boolean;
    removeFromDisk: () => void;
    pushToApi: () => Promise<boolean>;
    changedLabel: string;
  },
  result: SyncResult,
): Promise<void> {
  // API-only: exists in API, not on disk
  if (apiHash !== undefined && diskHash === undefined) {
    const wrote = opts.writeToDisk();
    if (wrote) result.synced++;
    return;
  }

  // Disk-only: exists on disk, not in API
  if (apiHash === undefined && diskHash !== undefined) {
    if (baselineHash !== undefined) {
      // Was in manifest → API deleted → remove from disk
      opts.removeFromDisk();
      result.removed++;
    } else {
      // Never in manifest → user-added locally → push to API
      // (actual push happens in the onboarding phase)
    }
    return;
  }

  // Both exist — compare against baseline
  if (apiHash !== undefined && diskHash !== undefined) {
    const apiChanged = apiHash !== baselineHash;
    const diskChanged = diskHash !== baselineHash;

    if (apiChanged && !diskChanged) {
      // API changed, disk is at baseline → PULL API→disk
      const wrote = opts.writeToDisk();
      if (wrote) result.synced++;
    } else if (diskChanged && !apiChanged) {
      // Disk changed, API is at baseline → PUSH disk→API
      const ok = await opts.pushToApi();
      if (ok) result.pushed++;
      else result.errors++;
    } else if (apiChanged && diskChanged) {
      // Both changed → CONFLICT
      result.conflicts++;
      result.skipped++;
    }
    // else: no changes → skip (counted as skipped)
    return;
  }
}

/** Controls sync behaviour: initial/onboarding sync pushes all disk items to API first. */
interface SyncOptions {
  /** If true, this is the initial/onboarding sync — push disk items to API. */
  isInitialSync: boolean;
}

/**
 * Acquire a maintenance lock on the skills resource via the API.
 * Returns the ownerToken if acquired, or null if the lock is held by another owner.
 * Throws on transport/API errors so the caller can distinguish 423 from failure.
 */
async function acquireSkillLock(worktree: string, project: string, ttlMs: number = 30_000): Promise<string | null> {
  const res = await fetch(`${API_BASE}/skills/locks/acquire?${encodeProject(project)}`, {
    method: "POST",
    headers: apiHeaders(worktree),
    body: JSON.stringify({ ttlMs }),
  });
  if (!res.ok) {
    if (res.status === 423) return null; // Intentional skip — lock held by another owner
    throw new Error(`Lock acquire failed: HTTP ${res.status}`);
  }
  const body = await res.json() as { data: { ownerToken: string } };
  return body?.data?.ownerToken ?? null;
}

/**
 * Release a previously acquired skill lock via the API.
 * Returns true if the lock was successfully released.
 * Logs release failure but does not throw — release is best-effort in finally.
 */
async function releaseSkillLock(worktree: string, project: string, ownerToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/skills/locks/release?${encodeProject(project)}`, {
      method: "POST",
      headers: apiHeaders(worktree),
      body: JSON.stringify({ ownerToken }),
    });
    const ok = res.ok;
    if (!ok) {
      logSync("skills", project, `WARNING — lock release failed: HTTP ${res.status}`);
    }
    return ok;
  } catch {
    logSync("skills", project, "WARNING — lock release request failed");
    return false;
  }
}

/** Internal logging helper — logs to stderr when no OpenCode client is available. */
function logSync(category: string, project: string, message: string): void {
  const ts = new Date().toISOString();
  process.stderr.write(`[resource-sync] ${ts} [${category}] project=${project} ${message}\n`);
}

/** API base URL for skill mutation calls that carry a lock token. */
function apiHeaders(worktree: string, lockToken?: string): Headers {
  const headers = apiRequestHeaders(worktree, { "Content-Type": "application/json" });
  if (lockToken) headers.set("x-ingenium-lock-token", lockToken);
  return headers;
}

/**
 * Sync skills between API and disk using three-way comparison (API vs disk vs manifest baseline).
 * On initial sync, pushes all disk-only skills to the API first, then reconciles both sides.
 *
 * Before the skill-mutation reconciliation phase, a maintenance lock is acquired on the
 * skills resource. If the lock is unavailable, skill sync is skipped entirely and the
 * manifest is NOT modified — other resources continue normally.
 */
export async function syncSkills(worktree: string, project: string, manifest: SyncManifest, opts: SyncOptions): Promise<SyncResult> {
  const result = emptyResult();

  // Phase 0: Acquire a skills lock for the mutation phase.
  let lockToken: string | null;
  try {
    lockToken = await acquireSkillLock(worktree, project, 30_000);
  } catch {
    // Transport/API error — treat as error, preserve manifest
    logSync("skills", project, "ERROR — lock acquire request failed; manifest preserved");
    result.errors = 1;
    return result;
  }

  if (!lockToken) {
    // HTTP 423 — intentional skip, lock held by another owner
    logSync("skills", project, "SKIPPED — skills resource locked by another owner; manifest preserved");
    result.skipped = 1;
    return result;
  }

  try {
    const diskMap = scanDiskSkills(worktree);

    // Fetch API skills
    const listRes = await apiGet<{ data: Array<{ name: string; description: string; content: string; tags?: string; always_apply?: number; file_tree?: string; enabled?: boolean; category?: string }> }>(worktree, `/skills?${encodeProject(project)}`);
    if (!listRes || !Array.isArray(listRes.data)) return result;

    const apiMap = new Map<string, { hash: string; data: (typeof listRes.data)[number] }>();
    for (const skill of listRes.data) {
      // Skip API rows with unsafe names (cannot write to disk)
      if (!isSafeName(skill.name)) {
        result.errors++;
        logSync("skills", project, `ERROR — API skill row has unsafe name, skipping: "${skill.name}"`);
        continue;
      }
      const h = hashContent(skill.content || "");
      apiMap.set(skill.name, { hash: h, data: skill });
    }

    // For initial sync: push all disk→API first
    if (opts.isInitialSync) {
      for (const [name] of diskMap) {
        if (!apiMap.has(name)) {
          const diskHash = diskMap.get(name);
          const ok = await pushSkillToApi(worktree, project, name, lockToken);
          if (ok) {
            result.pushed++;
            // Set manifest baseline to disk hash — API and disk are now in sync
            if (diskHash) manifest.resources.skills[name] = diskHash;
            // Refresh API map so resolveResource sees both sides at same hash.
            // Use diskHash directly (body-only hash from scanDiskSkills) to ensure
            // API and disk hashes match exactly.
            apiMap.set(name, {
              hash: diskHash ?? "",
              data: {
                name,
                description: "",
                content: "",
              },
            });
          } else {
            result.errors++;
            // Failed push: leave manifest baseline unchanged — unresolved state
          }
        }
      }
    }

    // Process each item in union of API + disk
    const allNames = new Set([...apiMap.keys(), ...diskMap.keys()]);
    for (const name of allNames) {
      const apiEntry = apiMap.get(name);
      const apiHash = apiEntry?.hash;
      const diskHash = diskMap.get(name);
      const baselineHash = manifest.resources.skills[name];

      // Track counters before resolve to detect what happened
      const syncedBefore = result.synced;
      const pushedBefore = result.pushed;
      const removedBefore = result.removed;
      const errorsBefore = result.errors;
      const conflictsBefore = result.conflicts;

      await resolveResource(
        name,
        apiHash,
        diskHash,
        baselineHash,
        {
          writeToDisk: () => {
            if (apiEntry) return writeSkillToDisk(worktree, apiEntry.data);
            return false;
          },
          removeFromDisk: () => removeSkillFromDisk(worktree, name),
          pushToApi: async () => pushSkillToApi(worktree, project, name, lockToken),
          changedLabel: "skills",
        },
        result,
      );

      // Update manifest baseline based on what actually happened.
      // Each item's baseline advances independently — siblings are unaffected.
      const synced = result.synced > syncedBefore;
      const pushed = result.pushed > pushedBefore;
      const removed = result.removed > removedBefore;
      const errored = result.errors > errorsBefore;
      const conflicted = result.conflicts > conflictsBefore;

      if (synced && apiEntry) {
        // API→disk pull or API-only write: set baseline to API hash
        manifest.resources.skills[name] = apiEntry.hash;
      } else if (pushed && diskHash !== undefined) {
        // Disk→API push succeeded: baseline is now the disk hash (API = disk)
        manifest.resources.skills[name] = diskHash;
      } else if (removed) {
        // Confirmed deletion from API: remove baseline
        delete manifest.resources.skills[name];
      } else if (errored || conflicted) {
        // Failed push or unresolved conflict: preserve existing baseline unchanged.
        // Do NOT advance to apiEntry.hash or delete — the item's state is unresolved.
      } else if (apiEntry) {
        // No change detected (both match baseline): ensure baseline is set
        manifest.resources.skills[name] = apiEntry.hash;
      }
      // else: disk-only not in manifest, no API entry, no action → baseline unchanged
    }

    // Prune stale manifest entries: names that exist in the manifest but
    // neither on disk nor in the API (e.g., legacy skills consolidated away
    // during taxonomy migration). Without this, the manifest grows stale
    // indefinitely — entries for absorbed skills are never cleaned up.
    for (const name of Object.keys(manifest.resources.skills)) {
      if (!allNames.has(name)) {
        delete manifest.resources.skills[name];
      }
    }
  } finally {
    // Always release the lock — whether success or failure.
    await releaseSkillLock(worktree, project, lockToken);
  }

  return result;
}

/**
 * Sync agents between API and disk using three-way comparison.
 * On initial sync, discovers each agent's category from disk directories, pushes to API.
 */
export async function syncAgents(worktree: string, project: string, manifest: SyncManifest, opts: SyncOptions): Promise<SyncResult> {
  const result = emptyResult();
  const diskMap = scanDiskAgents(worktree);

  const listRes = await apiGet<{ data: AgentSyncRecord[] }>(worktree, `/agents?${encodeProject(project)}`);
  if (!listRes || !Array.isArray(listRes.data)) return result;

  const apiMap = new Map<string, { hash: string; data: AgentSyncRecord }>();
  for (const agent of listRes.data) {
    if (!isSafeAgentName(agent.name) || !isAgentCategory(agent.category || "execution")) {
      result.errors++;
      continue;
    }
    // Disabled API records are authoritative tombstones for disk sync. Never
    // rewrite them and remove any stale local markdown before it can be pushed.
    if (agent.enabled === false || agent.enabled === 0) {
      const quarantined = diskMap.has(agent.name) && removeAgentFromAllCategories(worktree, agent.name);
      if (quarantined) result.removed++;
      if (isReservedBroker(agent.name) && (diskMap.has(agent.name) || quarantined)) {
        result.skipped++;
        logSync("agents", project, "SKIPPED — no enabled trusted API broker; quarantined disk-only broker profiles");
      }
      diskMap.delete(agent.name);
      delete manifest.resources.agents[agent.name];
      continue;
    }
    if (isReservedBroker(agent.name) && !isCanonicalBrokerRecord(agent)) {
      // Treat a malformed API row exactly like untrusted disk state. Do not
      // rewrite it from its own fields and do not preserve a local copy.
      const quarantined = diskMap.has(agent.name) && removeAgentFromAllCategories(worktree, agent.name);
      if (quarantined) result.removed++;
      result.errors++;
      result.skipped++;
      diskMap.delete(agent.name);
      delete manifest.resources.agents[agent.name];
      logSync("agents", project, "ERROR — rejected non-canonical API broker profile");
      continue;
    }
    const trustedAgent = canonicalAgentRecord(agent);
    apiMap.set(agent.name, { hash: agentRecordHash(trustedAgent), data: trustedAgent });
  }

  if (opts.isInitialSync) {
    for (const [name] of diskMap) {
      if (apiMap.has(name)) continue;
      // The broker is API-owned. A disk copy is never a trusted source and
      // must not cross the API boundary during initial import.
      if (isReservedBroker(name)) continue;
      const category = findAgentCategory(worktree, name);
      if (!category) { result.errors++; continue; }
      if (!await pushAgentToApi(worktree, project, name, category)) {
        result.errors++;
        continue;
      }

      // A successful initial POST is the common ancestor for this pass. Record
      // the post-write disk state in both maps so it cannot immediately become
      // a false three-way conflict.
      const snapshot = readAgentSnapshot(worktree, name, category);
      const postPushHash = scanDiskAgents(worktree).get(name);
      if (!snapshot || !postPushHash) {
        result.errors++;
        continue;
      }
      apiMap.set(name, { hash: postPushHash, data: canonicalAgentRecord(snapshot) });
      diskMap.set(name, postPushHash);
      manifest.resources.agents[name] = postPushHash;
      result.pushed++;
    }
  }

  // The broker is never eligible for generic conflict preservation. A complete
  // template check above established that the API record is canonical; remove
  // every disk copy before writing the sole local canonical file.
  const brokerEntry = apiMap.get(LLM_BROKER_AGENT);
  if (brokerEntry) {
    const diskHashBeforeRepair = diskMap.get(LLM_BROKER_AGENT);
    const trustedBroker = canonicalAgentRecord(brokerEntry.data);
    removeAgentFromAllCategories(worktree, LLM_BROKER_AGENT);
    if (writeAgentToDisk(worktree, trustedBroker)) {
      const canonicalHash = agentRecordHash(trustedBroker);
      apiMap.set(LLM_BROKER_AGENT, { hash: canonicalHash, data: trustedBroker });
      diskMap.set(LLM_BROKER_AGENT, canonicalHash);
      manifest.resources.agents[LLM_BROKER_AGENT] = canonicalHash;
      if (diskHashBeforeRepair !== canonicalHash) result.synced++;
    } else {
      result.errors++;
    }
  } else {
    // With no enabled API broker row, local broker definitions have no trusted
    // source of truth. Quarantine every category copy, prune the baseline, and
    // report the skipped import rather than silently recreating a broker row.
    const quarantined = removeAgentFromAllCategories(worktree, LLM_BROKER_AGENT);
    if (diskMap.has(LLM_BROKER_AGENT) || quarantined) {
      result.skipped++;
      if (quarantined) result.removed++;
      logSync("agents", project, "SKIPPED — no enabled trusted API broker; quarantined disk-only broker profiles");
    }
    diskMap.delete(LLM_BROKER_AGENT);
    delete manifest.resources.agents[LLM_BROKER_AGENT];
  }

  const allNames = new Set([...apiMap.keys(), ...diskMap.keys()]);
  for (const name of allNames) {
    if (isReservedBroker(name)) continue;
    const apiEntry = apiMap.get(name);
    const apiHash = apiEntry?.hash;
    const diskHash = diskMap.get(name);
    const baselineHash = manifest.resources.agents[name];
    const syncedBefore = result.synced;
    const pushedBefore = result.pushed;
    const removedBefore = result.removed;
    const errorsBefore = result.errors;
    const conflictsBefore = result.conflicts;

    await resolveResource(
      name,
      apiHash,
      diskHash,
      baselineHash,
      {
        writeToDisk: () => apiEntry ? writeAgentToDisk(worktree, apiEntry.data) : false,
        removeFromDisk: () => { removeAgentFromAllCategories(worktree, name); },
        pushToApi: async () => {
          const category = findAgentCategory(worktree, name);
          return category ? pushAgentToApi(worktree, project, name, category) : false;
        },
        changedLabel: "agents",
      },
      result,
    );

    const synced = result.synced > syncedBefore;
    const pushed = result.pushed > pushedBefore;
    const removed = result.removed > removedBefore;
    const errored = result.errors > errorsBefore;
    const conflicted = result.conflicts > conflictsBefore;
    if (synced && apiEntry) {
      manifest.resources.agents[name] = apiEntry.hash;
    } else if (pushed && diskHash !== undefined) {
      manifest.resources.agents[name] = diskHash;
    } else if (removed) {
      delete manifest.resources.agents[name];
    } else if (errored || conflicted) {
      // Preserve unresolved baselines until a later successful sync.
    } else if (apiEntry) {
      manifest.resources.agents[name] = apiEntry.hash;
    }
  }

  for (const name of Object.keys(manifest.resources.agents)) {
    if (!allNames.has(name)) delete manifest.resources.agents[name];
  }

  return result;
}

/**
 * Sync plugins between API and disk using three-way comparison.
 * On initial sync, pushes disk-only plugins to API.
 * After reconciliation, merges API plugin definitions into opencode.json plugin[]
 * so the OpenCode runtime picks up changes (requires restart).
 */
export async function syncPlugins(worktree: string, project: string, manifest: SyncManifest, opts: SyncOptions): Promise<SyncResult> {
  const result = emptyResult();
  const diskMap = scanDiskPlugins(worktree);

  const listRes = await apiGet<{ data: Array<{ name: string; file_path: string; source_content?: string; enabled?: boolean }> }>(worktree, `/plugins?${encodeProject(project)}`);
  if (!listRes || !Array.isArray(listRes.data)) return result;

  const apiMap = new Map<string, { hash: string; data: (typeof listRes.data)[number] }>();
  for (const plugin of listRes.data) {
    const h = hashContent(plugin.source_content || "");
    apiMap.set(plugin.name, { hash: h, data: plugin });
  }

  if (opts.isInitialSync) {
    for (const [name, diskHash] of diskMap) {
      if (!apiMap.has(name)) {
        const filePath = `.opencode/plugins/${name}.ts`;
        const ok = await pushPluginToApi(worktree, project, name, filePath);
        if (ok && diskHash) {
          // The initial POST is authoritative for this pass. Populate both the
          // transient API map and baseline so it cannot be misclassified as a
          // conflict before the next list request.
          apiMap.set(name, { hash: diskHash, data: { name, file_path: filePath } });
          manifest.resources.plugins[name] = diskHash;
          result.pushed++;
        } else result.errors++;
      }
    }
  }

  const allNames = new Set([...apiMap.keys(), ...diskMap.keys()]);
  for (const name of allNames) {
    const apiEntry = apiMap.get(name);
    const apiHash = apiEntry?.hash;
    const diskHash = diskMap.get(name);
    const baselineHash = manifest.resources.plugins[name];

    const syncedBefore = result.synced;
    const pushedBefore = result.pushed;
    const removedBefore = result.removed;
    const errorsBefore = result.errors;
    const conflictsBefore = result.conflicts;

    await resolveResource(
      name,
      apiHash,
      diskHash,
      baselineHash,
      {
        writeToDisk: () => {
          if (apiEntry) { writePluginToDisk(worktree, apiEntry.data); return true; }
          return false;
        },
        removeFromDisk: () => removePluginFromDisk(worktree, `.opencode/plugins/${name}.ts`),
        pushToApi: async () => pushPluginToApi(worktree, project, name, `.opencode/plugins/${name}.ts`),
        changedLabel: "plugins",
      },
      result,
    );

    const synced = result.synced > syncedBefore;
    const pushed = result.pushed > pushedBefore;
    const removed = result.removed > removedBefore;
    const errored = result.errors > errorsBefore;
    const conflicted = result.conflicts > conflictsBefore;
    if (synced && apiEntry) {
      manifest.resources.plugins[name] = apiEntry.hash;
    } else if (pushed && diskHash !== undefined) {
      manifest.resources.plugins[name] = diskHash;
    } else if (removed) {
      delete manifest.resources.plugins[name];
    } else if (errored || conflicted) {
      // Preserve an unresolved item's prior baseline.
    } else if (apiEntry) {
      manifest.resources.plugins[name] = apiEntry.hash;
    }
  }

  // Prune stale manifest entries: names that exist in the manifest but
  // neither on disk nor in the API.
  for (const name of Object.keys(manifest.resources.plugins)) {
    if (!allNames.has(name)) {
      delete manifest.resources.plugins[name];
    }
  }

  // Plugin merge into opencode.json
  const merge = mergePluginsIntoConfig(worktree, listRes.data);
  if (merge.changed && merge.config) {
    writeConfigToDisk(worktree, merge.config);
    result.synced++; // count as a sync action for restart notification
  }

  return result;
}

/**
 * Sync commands between API and disk using three-way comparison.
 * On initial sync, pushes disk-only commands to API first.
 */
export async function syncCommands(worktree: string, project: string, manifest: SyncManifest, opts: SyncOptions): Promise<SyncResult> {
  const result = emptyResult();
  const diskMap = scanDiskCommands(worktree);

  const listRes = await apiGet<{ data: Array<{ name: string; file_path: string; content?: string }> }>(worktree, `/commands?${encodeProject(project)}`);
  if (!listRes || !Array.isArray(listRes.data)) return result;

  const apiMap = new Map<string, { hash: string; data: (typeof listRes.data)[number] }>();
  for (const cmd of listRes.data) {
    const h = hashContent(cmd.content || "");
    apiMap.set(cmd.name, { hash: h, data: cmd });
  }

  if (opts.isInitialSync) {
    for (const [name, diskHash] of diskMap) {
      if (!apiMap.has(name)) {
        const filePath = `.opencode/commands/${name}.md`;
        const ok = await pushCommandToApi(worktree, project, name, filePath);
        if (ok && diskHash) {
          apiMap.set(name, { hash: diskHash, data: { name, file_path: filePath } });
          manifest.resources.commands[name] = diskHash;
          result.pushed++;
        } else result.errors++;
      }
    }
  }

  const allNames = new Set([...apiMap.keys(), ...diskMap.keys()]);
  for (const name of allNames) {
    const apiEntry = apiMap.get(name);
    const apiHash = apiEntry?.hash;
    const diskHash = diskMap.get(name);
    const baselineHash = manifest.resources.commands[name];

    const syncedBefore = result.synced;
    const pushedBefore = result.pushed;
    const removedBefore = result.removed;
    const errorsBefore = result.errors;
    const conflictsBefore = result.conflicts;

    await resolveResource(
      name,
      apiHash,
      diskHash,
      baselineHash,
      {
        writeToDisk: () => {
          if (apiEntry) { writeCommandToDisk(worktree, apiEntry.data); return true; }
          return false;
        },
        removeFromDisk: () => removeCommandFromDisk(worktree, `.opencode/commands/${name}.md`),
        pushToApi: async () => pushCommandToApi(worktree, project, name, `.opencode/commands/${name}.md`),
        changedLabel: "commands",
      },
      result,
    );

    const synced = result.synced > syncedBefore;
    const pushed = result.pushed > pushedBefore;
    const removed = result.removed > removedBefore;
    const errored = result.errors > errorsBefore;
    const conflicted = result.conflicts > conflictsBefore;
    if (synced && apiEntry) {
      manifest.resources.commands[name] = apiEntry.hash;
    } else if (pushed && diskHash !== undefined) {
      manifest.resources.commands[name] = diskHash;
    } else if (removed) {
      delete manifest.resources.commands[name];
    } else if (errored || conflicted) {
      // Preserve an unresolved item's prior baseline.
    } else if (apiEntry) {
      manifest.resources.commands[name] = apiEntry.hash;
    }
  }

  // Prune stale manifest entries: names that exist in the manifest but
  // neither on disk nor in the API.
  for (const name of Object.keys(manifest.resources.commands)) {
    if (!allNames.has(name)) {
      delete manifest.resources.commands[name];
    }
  }

  return result;
}

/**
 * Sync project config (opencode.json) between API and disk using three-way comparison.
 * Config is never removed from disk — removeFromDisk is a no-op.
 * On initial sync, pushes disk config to API if API has none.
 */
export async function syncConfig(worktree: string, project: string, manifest: SyncManifest, opts: SyncOptions): Promise<SyncResult> {
  const result = emptyResult();
  const diskHash = scanDiskConfig(worktree);

  const configRes = await apiGet<{ data: { content: string } | null }>(worktree, `/config?${encodeProject(project)}&type=project`);
  const apiContent = configRes?.data?.content || null;
  let apiHash = apiContent ? hashContent(apiContent) : undefined;
  let baselineHash = manifest.resources.config.hash;

  if (opts.isInitialSync) {
    if (diskHash && !apiContent) {
      const ok = await pushConfigToApi(worktree, project);
      if (ok) {
        // Avoid treating a successful first push as an API/disk conflict before
        // the following full sync can fetch the persisted config again.
        apiHash = diskHash;
        manifest.resources.config.hash = diskHash;
        baselineHash = diskHash;
        result.pushed++;
      } else result.errors++;
    }
  }

  const syncedBefore = result.synced;
  const pushedBefore = result.pushed;
  const errorsBefore = result.errors;
  const conflictsBefore = result.conflicts;

  await resolveResource(
    "config",
    apiHash,
    diskHash ?? undefined,
    baselineHash,
    {
      writeToDisk: () => {
        if (apiContent) { writeConfigToDisk(worktree, apiContent); return true; }
        return false;
      },
      removeFromDisk: () => { /* never remove config */ },
      pushToApi: async () => pushConfigToApi(worktree, project),
      changedLabel: "config",
    },
    result,
  );

  const synced = result.synced > syncedBefore;
  const pushed = result.pushed > pushedBefore;
  const errored = result.errors > errorsBefore;
  const conflicted = result.conflicts > conflictsBefore;
  if (synced && apiHash) {
    manifest.resources.config.hash = apiHash;
  } else if (pushed && diskHash) {
    manifest.resources.config.hash = diskHash;
  } else if (errored || conflicted) {
    // Keep the last resolved baseline until a later sync succeeds.
  } else if (apiHash) {
    manifest.resources.config.hash = apiHash;
  } else {
    delete manifest.resources.config.hash;
  }

  return result;
}

export type RepositorySyncScope = "all" | "docs";

export interface RepositorySyncResult {
  project: string;
  dryRun: boolean;
  scope: RepositorySyncScope;
  docs: SyncResult;
  skills: SyncResult;
  agents: SyncResult;
  plugins: SyncResult;
  /** An apply that changes plugin registration is intentionally restart-gated. */
  restartRequired: boolean;
}

function resultFromRepositorySummary(summary: Record<string, number> | undefined): SyncResult {
  return {
    synced: (summary?.updated ?? 0) + (summary?.renamed ?? 0),
    pushed: summary?.created ?? 0,
    removed: (summary?.archived ?? 0) + (summary?.removed ?? 0),
    conflicts: 0,
    skipped: summary?.unchanged ?? 0,
    errors: 0,
  };
}

function baselineFromEntries<T extends { identity: string; path: string; sha256: string }>(
  entries: T[],
  fingerprint: (entry: T) => string,
): RepositoryBaseline {
  return Object.fromEntries(entries.map((entry) => [entry.identity, {
    identity: entry.identity,
    path: entry.path,
    hash: entry.sha256,
    fingerprint: fingerprint(entry),
  }]));
}

function docsBaseline(entries: RepositoryDocManifestEntry[], previous: RepositoryBaseline): RepositoryBaseline {
  const records = Object.values(previous);
  return Object.fromEntries(entries.map((entry) => {
    const atPath = records.filter((record) => record.path === entry.path);
    const atHash = records.filter((record) => record.hash === entry.sha256);
    const identity = atPath.length === 1 ? atPath[0]!.identity
      : atHash.length === 1 ? atHash[0]!.identity
        : `doc:${hashContent(entry.path).slice(0, 24)}`;
    return [identity, { identity, path: entry.path, hash: entry.sha256, fingerprint: hashContent(entry.content) }];
  }));
}

function skillFingerprint(entry: RepositorySkillManifestEntry): string {
  const { identity: _identity, path: _path, sha256: _hash, fileTree, ...semantic } = entry;
  return repositoryHash({ ...semantic, fileContents: Object.values(fileTree).sort() });
}

function agentFingerprint(entry: RepositoryAgentManifestEntry): string {
  const { identity: _identity, path: _path, sha256: _hash, category: _category, mirrors: _mirrors, ...semantic } = entry;
  return repositoryHash(semantic);
}

function pluginFingerprint(entry: RepositoryPluginManifestEntry): string {
  const { identity: _identity, path: _path, sha256: _hash, ...semantic } = entry;
  return repositoryHash(semantic);
}

/**
 * Deterministic repository initialization/sync. `dryRun` resolves the project
 * identity but never provisions a project, writes a manifest, or mutates local
 * files. `apply` provisions the validated project then submits repository-owned
 * resources only; commands and all config are intentionally excluded.
 */
export async function repositorySync(
  worktree: string,
  options: { dryRun?: boolean; scope?: RepositorySyncScope; project?: string } = {},
): Promise<RepositorySyncResult> {
  const dryRun = options.dryRun === true;
  const scope = options.scope ?? "all";
  const project = dryRun
    ? resolveExtensionProject(worktree, options.project)
    : await ensureExtensionProject(worktree, API_BASE, options.project);
  _projectCache = project;
  _projectResolved = true;
  const manifest = loadManifest(worktree, project);
  const projection = buildRepositoryManifestV2(worktree, manifest);
  const docsResult = emptyResult();
  const skillsResult = emptyResult();
  const agentsResult = emptyResult();
  const pluginsResult = emptyResult();
  let docsConfirmed = false;
  let resourcesConfirmed = false;

  try {
    const response = await fetch(`${API_BASE}/docs/repository/sync?${encodeProject(project)}`, {
      method: "POST",
      headers: apiHeaders(worktree),
      body: JSON.stringify({ manifest: { files: projection.docs }, dryRun }),
    });
    if (!response.ok) {
      docsResult.errors = 1;
      return { project, dryRun, scope, docs: docsResult, skills: skillsResult, agents: agentsResult, plugins: pluginsResult, restartRequired: false };
    }
    const payload = await response.json() as { data?: { summary?: Record<string, number> } };
    Object.assign(docsResult, resultFromRepositorySummary(payload.data?.summary));
    docsConfirmed = true;
  } catch {
    docsResult.errors = 1;
    return { project, dryRun, scope, docs: docsResult, skills: skillsResult, agents: agentsResult, plugins: pluginsResult, restartRequired: false };
  }

  if (scope === "all") {
    try {
      const response = await fetch(`${API_BASE}/repository/resources/sync?${encodeProject(project)}`, {
        method: "POST",
        headers: apiHeaders(worktree),
        body: JSON.stringify({
          manifest: { version: 2, skills: projection.skills, agents: projection.agents, plugins: projection.plugins },
          dryRun,
        }),
      });
      if (!response.ok) {
        skillsResult.errors = 1;
        agentsResult.errors = 1;
        pluginsResult.errors = 1;
      } else {
        const payload = await response.json() as { data?: { summary?: Record<string, Record<string, number>> } };
        Object.assign(skillsResult, resultFromRepositorySummary(payload.data?.summary?.skill));
        Object.assign(agentsResult, resultFromRepositorySummary(payload.data?.summary?.agent));
        Object.assign(pluginsResult, resultFromRepositorySummary(payload.data?.summary?.plugin));
        resourcesConfirmed = true;
      }
    } catch {
      skillsResult.errors = 1;
      agentsResult.errors = 1;
      pluginsResult.errors = 1;
    }
  }

  // The baseline advances only after the owning API endpoint confirmed the
  // apply. A partial failure can safely retain the confirmed docs baseline while
  // keeping skills/agents/plugins eligible for a subsequent reconciliation.
  if (!dryRun) {
    const repository = repositoryBaseline(manifest);
    if (docsConfirmed) {
      repository.docs = docsBaseline(projection.docs, repository.docs);
    }
    if (resourcesConfirmed) {
      repository.skills = baselineFromEntries(projection.skills, skillFingerprint);
      repository.agents = baselineFromEntries(projection.agents, agentFingerprint);
      repository.plugins = baselineFromEntries(projection.plugins, pluginFingerprint);
    }
    if (docsConfirmed || resourcesConfirmed) {
      manifest.lastFullSync = new Date().toISOString();
      saveManifest(worktree, manifest);
    }
  }

  return {
    project,
    dryRun,
    scope,
    docs: docsResult,
    skills: skillsResult,
    agents: agentsResult,
    plugins: pluginsResult,
    restartRequired: !dryRun && resourcesConfirmed && (pluginsResult.pushed + pluginsResult.synced + pluginsResult.removed > 0),
  };
}

/**
 * Session hooks use the same repository-authoritative implementation as
 * `/init-project`. Legacy commands/config synchronization is deliberately not
 * invoked from this path.
 */
export async function fullSync(worktree: string): Promise<FullSyncResult & { restartRequired: boolean }> {
  const result = await repositorySync(worktree);
  return {
    docs: result.docs,
    skills: result.skills,
    agents: result.agents,
    plugins: result.plugins,
    commands: emptyResult(),
    config: emptyResult(),
    restartRequired: result.restartRequired,
  };
}

// 60s throttle to avoid hammering the API on rapid session.idle bursts.
// The API's scheduled maintenance cycle provides a safety net for anything missed.
let lastIncrementalSync = 0;
let incrementalSyncInFlight = false;
const INCREMENTAL_THROTTLE_MS = 60000;

/** Test support: reset the process-wide idle throttle and in-flight guard. */
export function resetIncrementalSyncThrottle(): void {
  lastIncrementalSync = 0;
  incrementalSyncInFlight = false;
}

function hasSyncErrors(result: FullSyncResult): boolean {
  return [result.docs, result.skills, result.agents, result.plugins, result.commands, result.config]
    .some((resource) => resource !== undefined && resource.errors > 0);
}

/**
 * Incremental sync — triggered on session.idle.
 * Only syncs items with content hash mismatches, throttled to max 1 per 60s.
 */
export async function incrementalSync(worktree: string): Promise<FullSyncResult & { restartRequired: boolean } | null> {
  const now = Date.now();
  if (incrementalSyncInFlight || now - lastIncrementalSync < INCREMENTAL_THROTTLE_MS) return null;
  incrementalSyncInFlight = true;
  try {
    const result = await fullSync(worktree);
    // A failed reconciliation is intentionally eligible for the next idle
    // event. Advancing the throttle here used to turn a startup race into a
    // guaranteed one-minute recovery delay.
    if (!hasSyncErrors(result)) lastIncrementalSync = Date.now();
    return result;
  } finally {
    incrementalSyncInFlight = false;
  }
}

/** Build a human-readable summary of a sync result for dashboard logging. */
function resultSummary(label: string, r: SyncResult): string {
  const parts: string[] = [];
  if (r.synced > 0) parts.push(`synced ${r.synced}`);
  if (r.pushed > 0) parts.push(`pushed ${r.pushed}`);
  if (r.removed > 0) parts.push(`removed ${r.removed}`);
  if (r.conflicts > 0) parts.push(`${r.conflicts} conflicts`);
  if (r.skipped > 0) parts.push(`skipped ${r.skipped}`);
  if (r.errors > 0) parts.push(`${r.errors} errors`);
  return parts.length > 0 ? `${label}: ${parts.join(", ")}` : `${label}: no changes`;
}

/**
 * ResourceSyncPlugin — unified sync plugin.
 *
 * Hooks:
 *   session.created → Full comparison of all resources
 *   session.idle    → Incremental sync (throttled 1/60s)
 */
export const ResourceSyncPlugin = async (ctx: { worktree: string; client: any }) => {
  const worktree = ctx.worktree;
  let startupProvisioningFailure: ExtensionProjectFailureKind | null = null;

  const reportStartupDiagnostic = (event: "extension_project_init_failed" | "extension_project_init_recovered", reason?: ExtensionProjectFailureKind) => {
    // These fields are intentionally an allowlist. Do not add caught-error
    // messages: request errors can include a bearer, URL, or response body.
    process.stderr.write(`${JSON.stringify(reason ? { event, reason } : { event })}\n`);
  };

  const recoverStartupProvisioning = async (): Promise<boolean> => {
    if (!startupProvisioningFailure) return true;
    try {
      await ensureExtensionProject(worktree, API_BASE);
      startupProvisioningFailure = null;
      reportStartupDiagnostic("extension_project_init_recovered");
      return true;
    } catch {
      // The initial failure was already reported with a safe classification.
      // Do not emit repeated or lower-level errors on every lifecycle event.
      return false;
    }
  };

  // Provision at plugin load so a database/API restart cannot leave this
  // worktree missing until a later session lifecycle event happens to fire.
  try {
    await ensureExtensionProject(worktree, API_BASE);
  } catch (error) {
    startupProvisioningFailure = classifyExtensionProjectFailure(error);
    reportStartupDiagnostic("extension_project_init_failed", startupProvisioningFailure);
  }

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "session.created") {
        try {
          if (!(await recoverStartupProvisioning())) return;
          const result = await fullSync(worktree);
          const lines: string[] = [
            resultSummary("docs", result.docs ?? emptyResult()),
            resultSummary("skills", result.skills),
            resultSummary("agents", result.agents),
            resultSummary("plugins", result.plugins),
          ];
          if (result.restartRequired) {
            lines.push("⚡ OpenCode restart required (plugin/config changes)");
          }
          await ctx.client.app.log({
            body: {
              service: "resource-sync",
              level: "info",
              message: lines.join(" | "),
            },
          });
        } catch {
          // Non-fatal — sync failures should not break session startup
        }
      }

      if (event.type === "session.idle") {
        try {
          if (!(await recoverStartupProvisioning())) return;
          const result = await incrementalSync(worktree);
          if (result) {
            const lines: string[] = [
              resultSummary("docs", result.docs ?? emptyResult()),
              resultSummary("skills", result.skills),
              resultSummary("agents", result.agents),
              resultSummary("plugins", result.plugins),
            ];
            if (lines.some((l) => !l.endsWith("no changes"))) {
              if (result.restartRequired) {
                lines.push("⚡ OpenCode restart required (plugin/config changes)");
              }
              await ctx.client.app.log({
                body: {
                  service: "resource-sync",
                  level: "info",
                  message: lines.join(" | "),
                },
              });
            }
          }
        } catch {
          /* non-fatal */
        }
      }
    },
  };
};

/**
 * Exported for skill-sync.ts delegation.
 * Performs a skills-only sync on session.created.
 */
export async function skillsOnlySync(worktree: string): Promise<{ synced: number; skipped: number }> {
  const project = await ensureExtensionProject(worktree, API_BASE);
  const manifest = loadManifest(worktree, project);
  const isInitialSync = Object.keys(manifest.resources.skills).length === 0;

  const result = await syncSkills(worktree, project, manifest, { isInitialSync });
  manifest.lastFullSync = new Date().toISOString();
  saveManifest(worktree, manifest);

  return { synced: result.synced, skipped: result.skipped + result.conflicts };
}

/**
 * Exported for onboarding-sync.ts delegation.
 * Pushes all disk resources to the API (disk→API only).
 */
export async function pushDiskToApi(worktree: string): Promise<{
  plugins: { created: number; skipped: number; errors: number };
  configs: { created: number; skipped: number; errors: number };
  commands: { created: number; skipped: number; errors: number };
  agents: { created: number; skipped: number; errors: number };
  skills: { created: number; skipped: number; errors: number };
  servers: { created: number; skipped: number; errors: number };
}> {
  const result = await repositorySync(worktree);
  return {
    plugins: { created: result.plugins.pushed, skipped: result.plugins.skipped, errors: result.plugins.errors },
    configs: { created: 0, skipped: 0, errors: 0 },
    commands: { created: 0, skipped: 0, errors: 0 },
    agents: { created: result.agents.pushed, skipped: result.agents.skipped, errors: result.agents.errors },
    skills: { created: result.skills.pushed, skipped: result.skills.skipped, errors: result.skills.errors },
    servers: { created: 0, skipped: 0, errors: 0 },
  };
}
