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
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, lstatSync, unlinkSync, rmdirSync, realpathSync } from "node:fs";
import { resolve, basename, dirname, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";

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

  const envProject = process.env.INGENIUM_PROJECT?.trim();
  if (envProject && envProject.length > 0) {
    _projectCache = envProject;
    _projectResolved = true;
    return _projectCache;
  }

  const worktreeName = basename(worktree);
  if (worktreeName && worktreeName.length > 0 && worktreeName !== "." && worktreeName !== "/") {
    _projectCache = worktreeName;
    _projectResolved = true;
    return _projectCache;
  }

  throw new Error(
    "resource-sync: Could not resolve project name. Set INGENIUM_PROJECT env var or ensure worktree has a meaningful directory name."
  );
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
  version: 1;
  project: string;
  lastFullSync: string;
  resources: {
    skills: ResourceHashes;
    agents: ResourceHashes;
    plugins: ResourceHashes;
    commands: ResourceHashes;
    config: { hash?: string };
  };
}

function emptyManifest(project: string): SyncManifest {
  return {
    version: 1,
    project,
    lastFullSync: new Date().toISOString(),
    resources: {
      skills: {},
      agents: {},
      plugins: {},
      commands: {},
      config: {},
    },
  };
}

export function loadManifest(worktree: string, project: string): SyncManifest {
  const manifestPath = resolve(worktree, ".opencode", ".ingenium-sync-state.json");
  try {
    if (!existsSync(manifestPath)) return emptyManifest(project);
    const raw = readFileSync(manifestPath, "utf-8");
    const parsed = JSON.parse(raw);
    // Validate structure
    if (parsed.version !== 1 || !parsed.resources) return emptyManifest(project);
    // If project changed, start fresh
    if (parsed.project !== project) return emptyManifest(project);
    return parsed as SyncManifest;
  } catch {
    return emptyManifest(project);
  }
}

export function saveManifest(worktree: string, manifest: SyncManifest): void {
  const dir = resolve(worktree, ".opencode");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const manifestPath = resolve(dir, ".ingenium-sync-state.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
}

/**
 * Generic HTTP GET helper for the Ingenium API.
 * Returns null on any failure (non-2xx, network error, parse error) for resilient sync.
 * The caller's catch block handles the null; individual sync failures must not cascade.
 */
async function apiGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`);
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

/** Aggregate sync result across all five resource types. */
export interface FullSyncResult {
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
  const agentsDir = resolve(worktree, ".opencode", "agents");
  if (!existsSync(agentsDir)) return map;
  try {
    for (const category of readdirSync(agentsDir)) {
      const catDir = resolve(agentsDir, category);
      if (!statSync(catDir).isDirectory()) continue;
      for (const file of readdirSync(catDir)) {
        if (!file.endsWith(".md")) continue;
        const name = file.slice(0, -3);
        const filePath = resolve(catDir, file);
        if (!existsSync(filePath)) continue;
        const rawContent = readFileSync(filePath, "utf-8");
        // Hash only the body (without YAML frontmatter) to match API representation
        const { body } = parseYamlFrontmatter(rawContent);
        map.set(name, hashContent(body));
      }
    }
  } catch {
    /* non-fatal */
  }
  return map;
}

function writeAgentToDisk(
  worktree: string,
  agent: { name: string; content: string; description?: string; category?: string; mode?: string; model?: string; permissions?: string },
): void {
  const category = agent.category || "execution";
  const dir = resolve(worktree, ".opencode", "agents", category);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const parts: string[] = [];
  parts.push(`name: ${agent.name}`);
  if (agent.description) parts.push(`description: "${agent.description.replace(/"/g, '\\"')}"`);
  if (agent.mode) parts.push(`mode: ${agent.mode}`);
  if (agent.model) parts.push(`model: ${agent.model}`);
  if (agent.permissions) parts.push(`permissions: ${agent.permissions}`);
  const frontmatter = `---\n${parts.join("\n")}\n---\n`;

  writeFileSync(resolve(dir, `${agent.name}.md`), frontmatter + "\n" + (agent.content || ""));
}

function removeAgentFromDisk(worktree: string, name: string, category?: string): void {
  const catDir = resolve(worktree, ".opencode", "agents", category || "execution");
  const filePath = resolve(catDir, `${name}.md`);
  if (existsSync(filePath)) {
    try { unlinkSync(filePath); } catch { /* non-fatal */ }
  }
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

    // Identify non-ingenium plugins (those NOT from the extension package).
    // We preserve user-added plugins to avoid overwriting custom tooling.
    const isIngenium = (p: string) => p.includes("ingenium-extension");
    const userPlugins = existing.filter((p) => !isIngenium(p));

    // Build new plugin array: user plugins + API-managed plugins
    const newPlugins = [...userPlugins, ...Array.from(apiPaths)];
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
      headers: apiHeaders(lockToken),
      body: JSON.stringify(bodyPayload),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pushAgentToApi(worktree: string, project: string, name: string, category: string): Promise<boolean> {
  const filePath = resolve(worktree, ".opencode", "agents", category, `${name}.md`);
  if (!existsSync(filePath)) return false;
  try {
    const rawContent = readFileSync(filePath, "utf-8");
    const { body, frontmatter } = parseYamlFrontmatter(rawContent);
    const description = frontmatter.description || "";
    const mode = frontmatter.mode || "subagent";
    const model = frontmatter.model || "";
    const res = await fetch(`${API_BASE}/agents?${encodeProject(project)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, content: body, description, category, mode, model }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function pushPluginToApi(worktree: string, project: string, name: string, filePathRel: string): Promise<boolean> {
  const fullPath = resolve(worktree, filePathRel);
  if (!existsSync(fullPath)) return false;
  try {
    const sourceContent = readFileSync(fullPath, "utf-8");
    const res = await fetch(`${API_BASE}/plugins?${encodeProject(project)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
      headers: { "Content-Type": "application/json" },
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
async function acquireSkillLock(project: string, ttlMs: number = 30_000): Promise<string | null> {
  const res = await fetch(`${API_BASE}/skills/locks/acquire?${encodeProject(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
async function releaseSkillLock(project: string, ownerToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/skills/locks/release?${encodeProject(project)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ownerToken }),
    });
    const ok = res.ok;
    if (!ok) {
      logSync("skills", project, `WARNING — lock release failed: HTTP ${res.status}`);
    }
    return ok;
  } catch (err: any) {
    logSync("skills", project, `WARNING — lock release failed: ${err.message}`);
    return false;
  }
}

/** Internal logging helper — logs to stderr when no OpenCode client is available. */
function logSync(category: string, project: string, message: string): void {
  const ts = new Date().toISOString();
  process.stderr.write(`[resource-sync] ${ts} [${category}] project=${project} ${message}\n`);
}

/** API base URL for skill mutation calls that carry a lock token. */
function apiHeaders(lockToken?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (lockToken) headers["x-ingenium-lock-token"] = lockToken;
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
    lockToken = await acquireSkillLock(project, 30_000);
  } catch (err: any) {
    // Transport/API error — treat as error, preserve manifest
    logSync("skills", project, `ERROR — lock acquire failed (transport/API): ${err.message}; manifest preserved`);
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
    const listRes = await apiGet<{ data: Array<{ name: string; description: string; content: string; tags?: string; always_apply?: number; file_tree?: string; enabled?: boolean; category?: string }> }>(`/skills?${encodeProject(project)}`);
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
    await releaseSkillLock(project, lockToken);
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

  const listRes = await apiGet<{ data: Array<{ name: string; content: string; description?: string; category?: string; mode?: string; model?: string; permissions?: string; enabled?: boolean }> }>(`/agents?${encodeProject(project)}`);
  if (!listRes || !Array.isArray(listRes.data)) return result;

  const apiMap = new Map<string, { hash: string; data: (typeof listRes.data)[number] }>();
  for (const agent of listRes.data) {
    const h = hashContent(agent.content || "");
    apiMap.set(agent.name, { hash: h, data: agent });
  }

  if (opts.isInitialSync) {
    for (const [name] of diskMap) {
      if (!apiMap.has(name)) {
        // Find the category from disk
        let cat = "execution";
        const agentsDir = resolve(worktree, ".opencode", "agents");
        if (existsSync(agentsDir)) {
          for (const category of readdirSync(agentsDir)) {
            if (existsSync(resolve(agentsDir, category, `${name}.md`))) {
              cat = category;
              break;
            }
          }
        }
        const ok = await pushAgentToApi(worktree, project, name, cat);
        if (ok) result.pushed++;
        else result.errors++;
      }
    }
  }

  const allNames = new Set([...apiMap.keys(), ...diskMap.keys()]);
  for (const name of allNames) {
    const apiEntry = apiMap.get(name);
    const apiHash = apiEntry?.hash;
    const diskHash = diskMap.get(name);
    const baselineHash = manifest.resources.agents[name];

    await resolveResource(
      name,
      apiHash,
      diskHash,
      baselineHash,
      {
        writeToDisk: () => {
          if (apiEntry) { writeAgentToDisk(worktree, apiEntry.data); return true; }
          return false;
        },
        removeFromDisk: () => removeAgentFromDisk(worktree, name),
        pushToApi: async () => {
          let cat = "execution";
          const agentsDir = resolve(worktree, ".opencode", "agents");
          if (existsSync(agentsDir)) {
            for (const category of readdirSync(agentsDir)) {
              if (existsSync(resolve(agentsDir, category, `${name}.md`))) {
                cat = category;
                break;
              }
            }
          }
          return pushAgentToApi(worktree, project, name, cat);
        },
        changedLabel: "agents",
      },
      result,
    );

    if (apiEntry) {
      manifest.resources.agents[name] = apiEntry.hash;
    } else {
      delete manifest.resources.agents[name];
    }
  }

  // Prune stale manifest entries: names that exist in the manifest but
  // neither on disk nor in the API.
  for (const name of Object.keys(manifest.resources.agents)) {
    if (!allNames.has(name)) {
      delete manifest.resources.agents[name];
    }
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

  const listRes = await apiGet<{ data: Array<{ name: string; file_path: string; source_content?: string; enabled?: boolean }> }>(`/plugins?${encodeProject(project)}`);
  if (!listRes || !Array.isArray(listRes.data)) return result;

  const apiMap = new Map<string, { hash: string; data: (typeof listRes.data)[number] }>();
  for (const plugin of listRes.data) {
    const h = hashContent(plugin.source_content || "");
    apiMap.set(plugin.name, { hash: h, data: plugin });
  }

  if (opts.isInitialSync) {
    for (const [name] of diskMap) {
      if (!apiMap.has(name)) {
        const filePath = `.opencode/plugins/${name}.ts`;
        const ok = await pushPluginToApi(worktree, project, name, filePath);
        if (ok) result.pushed++;
        else result.errors++;
      }
    }
  }

  const allNames = new Set([...apiMap.keys(), ...diskMap.keys()]);
  for (const name of allNames) {
    const apiEntry = apiMap.get(name);
    const apiHash = apiEntry?.hash;
    const diskHash = diskMap.get(name);
    const baselineHash = manifest.resources.plugins[name];

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

    if (apiEntry) {
      manifest.resources.plugins[name] = apiEntry.hash;
    } else {
      delete manifest.resources.plugins[name];
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

  const listRes = await apiGet<{ data: Array<{ name: string; file_path: string; content?: string }> }>(`/commands?${encodeProject(project)}`);
  if (!listRes || !Array.isArray(listRes.data)) return result;

  const apiMap = new Map<string, { hash: string; data: (typeof listRes.data)[number] }>();
  for (const cmd of listRes.data) {
    const h = hashContent(cmd.content || "");
    apiMap.set(cmd.name, { hash: h, data: cmd });
  }

  if (opts.isInitialSync) {
    for (const [name] of diskMap) {
      if (!apiMap.has(name)) {
        const filePath = `.opencode/commands/${name}.md`;
        const ok = await pushCommandToApi(worktree, project, name, filePath);
        if (ok) result.pushed++;
        else result.errors++;
      }
    }
  }

  const allNames = new Set([...apiMap.keys(), ...diskMap.keys()]);
  for (const name of allNames) {
    const apiEntry = apiMap.get(name);
    const apiHash = apiEntry?.hash;
    const diskHash = diskMap.get(name);
    const baselineHash = manifest.resources.commands[name];

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

    if (apiEntry) {
      manifest.resources.commands[name] = apiEntry.hash;
    } else {
      delete manifest.resources.commands[name];
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

  const configRes = await apiGet<{ data: { content: string } | null }>(`/config?${encodeProject(project)}&type=project`);
  const apiContent = configRes?.data?.content || null;
  const apiHash = apiContent ? hashContent(apiContent) : undefined;
  const baselineHash = manifest.resources.config.hash;

  if (opts.isInitialSync) {
    if (diskHash && !apiContent) {
      const ok = await pushConfigToApi(worktree, project);
      if (ok) result.pushed++;
      else result.errors++;
    }
  }

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

  if (apiHash) {
    manifest.resources.config.hash = apiHash;
  } else {
    delete manifest.resources.config.hash;
  }

  return result;
}

/**
 * Full sync — triggered on session.created.
 * Performs all resource syncs and writes the manifest.
 *
 * restartRequired is true when plugins or config changed — only those two
 * resource types affect the OpenCode runtime and require a restart.
 */
export async function fullSync(worktree: string): Promise<FullSyncResult & { restartRequired: boolean }> {
  const project = resolveProject(worktree);
  const manifest = loadManifest(worktree, project);
  const isInitialSync = Object.keys(manifest.resources.skills).length === 0 &&
    Object.keys(manifest.resources.agents).length === 0 &&
    Object.keys(manifest.resources.plugins).length === 0 &&
    Object.keys(manifest.resources.commands).length === 0 &&
    !manifest.resources.config.hash;

  const opts: SyncOptions = { isInitialSync };

  const [skillsResult, agentsResult, pluginsResult, commandsResult, configResult] = await Promise.all([
    syncSkills(worktree, project, manifest, opts),
    syncAgents(worktree, project, manifest, opts),
    syncPlugins(worktree, project, manifest, opts),
    syncCommands(worktree, project, manifest, opts),
    syncConfig(worktree, project, manifest, opts),
  ]);

  manifest.lastFullSync = new Date().toISOString();
  saveManifest(worktree, manifest);

  const full: FullSyncResult = {
    skills: skillsResult,
    agents: agentsResult,
    plugins: pluginsResult,
    commands: commandsResult,
    config: configResult,
  };

  const restartRequired = pluginsResult.synced > 0 || pluginsResult.removed > 0 || configResult.synced > 0;

  return { ...full, restartRequired };
}

// 60s throttle to avoid hammering the API on rapid session.idle bursts.
// The API's scheduled maintenance cycle provides a safety net for anything missed.
let lastIncrementalSync = 0;
const INCREMENTAL_THROTTLE_MS = 60000;

/**
 * Incremental sync — triggered on session.idle.
 * Only syncs items with content hash mismatches, throttled to max 1 per 60s.
 */
export async function incrementalSync(worktree: string): Promise<FullSyncResult & { restartRequired: boolean } | null> {
  const now = Date.now();
  if (now - lastIncrementalSync < INCREMENTAL_THROTTLE_MS) return null;
  lastIncrementalSync = now;
  return fullSync(worktree);
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

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "session.created") {
        try {
          const result = await fullSync(worktree);
          const lines: string[] = [
            resultSummary("skills", result.skills),
            resultSummary("agents", result.agents),
            resultSummary("plugins", result.plugins),
            resultSummary("commands", result.commands),
            resultSummary("config", result.config),
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
          const result = await incrementalSync(worktree);
          if (result) {
            const lines: string[] = [
              resultSummary("skills", result.skills),
              resultSummary("agents", result.agents),
              resultSummary("plugins", result.plugins),
              resultSummary("commands", result.commands),
              resultSummary("config", result.config),
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
  const project = resolveProject(worktree);
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
  const project = resolveProject(worktree);
  const manifest = loadManifest(worktree, project);

  const results = await Promise.all([
    syncPlugins(worktree, project, manifest, { isInitialSync: true }),
    (async () => {
      const r = emptyResult();
      const diskHash = scanDiskConfig(worktree);
      if (diskHash) {
        const configRes = await apiGet<{ data: { content: string } | null }>(`/config?${encodeProject(project)}&type=project`);
        if (!configRes?.data) {
          const ok = await pushConfigToApi(worktree, project);
          if (ok) r.pushed++;
          else r.errors++;
        }
      }
      return r;
    })(),
    syncCommands(worktree, project, manifest, { isInitialSync: true }),
    syncAgents(worktree, project, manifest, { isInitialSync: true }),
    syncSkills(worktree, project, manifest, { isInitialSync: true }),
    // Servers — delegate to the existing onboarding approach
    (async () => {
      // The server sync is complex (reads opencode.json mcp block). We leave this
      // to the onboarding wrapper. Return empty result here.
      return emptyResult();
    })(),
  ]);

  manifest.lastFullSync = new Date().toISOString();
  saveManifest(worktree, manifest);

  return {
    plugins: { created: results[0].pushed, skipped: results[0].skipped, errors: results[0].errors },
    configs: { created: results[1].pushed, skipped: results[1].skipped, errors: results[1].errors },
    commands: { created: results[2].pushed, skipped: results[2].skipped, errors: results[2].errors },
    agents: { created: results[3].pushed, skipped: results[3].skipped, errors: results[3].errors },
    skills: { created: results[4].pushed, skipped: results[4].skipped, errors: results[4].errors },
    servers: { created: 0, skipped: 0, errors: 0 },
  };
}
