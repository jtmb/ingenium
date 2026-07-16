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
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, rmdirSync } from "node:fs";
import { resolve, basename, dirname } from "node:path";
import { createHash } from "node:crypto";

// ── Configuration ──────────────────────────────────────────────────────────

const API_BASE =
  (typeof process !== "undefined" ? process.env.INGENIUM_API_URL : undefined) ??
  "http://localhost:4097/api/v1";

let _projectCache: string | null = null;
let _projectResolved = false;

/**
 * Resolve the project name exactly once per process.
 *
 * Priority:
 *   1. INGENIUM_PROJECT env var (explicit override — Docker containers use this)
 *   2. Worktree directory basename (external worktree sessions)
 *   3. Throw — NEVER default to "global-default"
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

// ── Hashing ────────────────────────────────────────────────────────────────

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

// ── Manifest ───────────────────────────────────────────────────────────────

export interface ResourceHashes {
  [name: string]: string; // name → sha256
}

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

// ── API Helpers ────────────────────────────────────────────────────────────

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

// ── Sync Result Types ──────────────────────────────────────────────────────

export interface SyncResult {
  synced: number;   // items written to disk
  pushed: number;   // items pushed to API
  removed: number;  // items removed from disk (API deleted)
  conflicts: number;
  skipped: number;
  errors: number;
}

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

// ── Per-Resource Disk Helpers ──────────────────────────────────────────────

/** Scan disk for skill directories and return name→content-hash map. */
function scanDiskSkills(worktree: string): Map<string, string> {
  const map = new Map<string, string>();
  const skillsDir = resolve(worktree, ".opencode", "skills");
  if (!existsSync(skillsDir)) return map;
  try {
    for (const entry of readdirSync(skillsDir)) {
      const dir = resolve(skillsDir, entry);
      if (!statSync(dir).isDirectory()) continue;
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

/** Write a skill from API data to disk. */
function writeSkillToDisk(worktree: string, skill: { name: string; description: string; content: string; tags?: string; always_apply?: number; file_tree?: string }): void {
  const dir = resolve(worktree, ".opencode", "skills", skill.name);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  // SKILL.md with YAML frontmatter
  const frontmatter = `---\nname: ${skill.name}\ndescription: "${(skill.description || "").replace(/"/g, '\\"')}"\n---\n`;
  writeFileSync(resolve(dir, "SKILL.md"), frontmatter + "\n" + (skill.content || ""));

  // metadata.json
  const tags = skill.tags ? skill.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
  const meta = JSON.stringify({ tags, alwaysApply: (skill.always_apply || 0) === 1 }, null, 2);
  writeFileSync(resolve(dir, "metadata.json"), meta);

  // file_tree entries
  if (skill.file_tree) {
    try {
      const tree = JSON.parse(skill.file_tree) as Record<string, string>;
      for (const [relPath, content] of Object.entries(tree)) {
        const filePath = resolve(dir, relPath);
        const parent = dirname(filePath);
        if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
        writeFileSync(filePath, content, "utf-8");
      }
    } catch {
      /* skip broken file_tree */
    }
  }
}

/** Recursively remove a skill directory from disk. */
function removeSkillFromDisk(worktree: string, name: string): void {
  const dir = resolve(worktree, ".opencode", "skills", name);
  if (!existsSync(dir)) return;
  try {
    rmRecursive(dir);
  } catch {
    /* non-fatal */
  }
}

function rmRecursive(dir: string): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      rmRecursive(full);
    } else {
      unlinkSync(full);
    }
  }
  rmdirSync(dir);
}

// ── Agents ─────────────────────────────────────────────────────────────────

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

// ── Plugins ────────────────────────────────────────────────────────────────

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

// ── Commands ───────────────────────────────────────────────────────────────

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

// ── Config ─────────────────────────────────────────────────────────────────

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

// ── Plugin opencode.json Merge ─────────────────────────────────────────────

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
    // Strip comments for JSONC support
    const stripped = raw.replace(/^\s*\/\/.*$/gm, "");
    const config = JSON.parse(stripped);
    const existing: string[] = Array.isArray(config.plugin) ? config.plugin : [];

    // Build set of enabled API plugin file paths
    const apiPaths = new Set(apiPlugins.filter((p) => p.enabled !== false).map((p) => p.file_path));

    // Identify non-ingenium plugins (those NOT from the extension package)
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

// ── Push to API (disk → API, used by onboarding and conflict resolution) ──

/** Push a skill from disk to API. */
async function pushSkillToApi(worktree: string, project: string, name: string): Promise<boolean> {
  const dir = resolve(worktree, ".opencode", "skills", name);
  const skillMdPath = resolve(dir, "SKILL.md");
  if (!existsSync(skillMdPath)) return false;

  try {
    const rawContent = readFileSync(skillMdPath, "utf-8");
    const { body, frontmatter } = parseYamlFrontmatter(rawContent);
    const skillName = frontmatter.name || name;
    const description = frontmatter.description || "";

    let tags = "";
    let alwaysApply = 0;
    const metaPath = resolve(dir, "metadata.json");
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
        tags = Array.isArray(meta.tags) ? meta.tags.join(", ") : (meta.tags || "");
        alwaysApply = meta.alwaysApply ? 1 : 0;
      } catch { /* ignore bad metadata */ }
    }

    const res = await fetch(`${API_BASE}/skills?${encodeProject(project)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: skillName, description, content: body, tags, always_apply: alwaysApply }),
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

// ── YAML Frontmatter Parser ────────────────────────────────────────────────

function parseYamlFrontmatter(content: string): { body: string; frontmatter: Record<string, string> } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { body: content, frontmatter: {} };
  const fm: Record<string, string> = {};
  for (const line of match[1]!.split("\n")) {
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

// ── Core Conflict Resolver ─────────────────────────────────────────────────

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
    writeToDisk: () => void;
    removeFromDisk: () => void;
    pushToApi: () => Promise<boolean>;
    changedLabel: string;
  },
  result: SyncResult,
): Promise<void> {
  // API-only: exists in API, not on disk
  if (apiHash !== undefined && diskHash === undefined) {
    opts.writeToDisk();
    result.synced++;
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
      opts.writeToDisk();
      result.synced++;
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

// ── Per-Resource Sync Functions ────────────────────────────────────────────

interface SyncOptions {
  /** If true, this is the initial/onboarding sync — push disk items to API. */
  isInitialSync: boolean;
}

export async function syncSkills(worktree: string, project: string, manifest: SyncManifest, opts: SyncOptions): Promise<SyncResult> {
  const result = emptyResult();
  const diskMap = scanDiskSkills(worktree);

  // Fetch API skills
  const listRes = await apiGet<{ data: Array<{ name: string; description: string; content: string; tags?: string; always_apply?: number; file_tree?: string; enabled?: boolean }> }>(`/skills?${encodeProject(project)}`);
  if (!listRes || !Array.isArray(listRes.data)) return result;

  const apiMap = new Map<string, { hash: string; data: (typeof listRes.data)[number] }>();
  for (const skill of listRes.data) {
    const h = hashContent(skill.content || "");
    apiMap.set(skill.name, { hash: h, data: skill });
  }

  // For initial sync: push all disk→API first
  if (opts.isInitialSync) {
    for (const [name] of diskMap) {
      if (!apiMap.has(name)) {
        const ok = await pushSkillToApi(worktree, project, name);
        if (ok) {
          result.pushed++;
          // Refresh API map
          const updated = hashContent(readFileSync(resolve(worktree, ".opencode", "skills", name, "SKILL.md"), "utf-8"));
          apiMap.set(name, {
            hash: updated,
            data: {
              name,
              description: "",
              content: "",
              // Minimal data; we'll re-fetch if needed, but the hash is what matters
            },
          });
        } else {
          result.errors++;
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

    await resolveResource(
      name,
      apiHash,
      diskHash,
      baselineHash,
      {
        writeToDisk: () => {
          if (apiEntry) writeSkillToDisk(worktree, apiEntry.data);
        },
        removeFromDisk: () => removeSkillFromDisk(worktree, name),
        pushToApi: async () => pushSkillToApi(worktree, project, name),
        changedLabel: "skills",
      },
      result,
    );

    // Update manifest hash
    if (apiEntry) {
      manifest.resources.skills[name] = apiEntry.hash;
    } else {
      delete manifest.resources.skills[name];
    }
  }

  return result;
}

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
          if (apiEntry) writeAgentToDisk(worktree, apiEntry.data);
        },
        removeFromDisk: () => removeAgentFromDisk(worktree, name),
        pushToApi: async () => pushAgentToApi(worktree, project, name, "execution"),
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

  return result;
}

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
          if (apiEntry) writePluginToDisk(worktree, apiEntry.data);
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

  // Plugin merge into opencode.json
  const merge = mergePluginsIntoConfig(worktree, listRes.data);
  if (merge.changed && merge.config) {
    writeConfigToDisk(worktree, merge.config);
    result.synced++; // count as a sync action for restart notification
  }

  return result;
}

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
          if (apiEntry) writeCommandToDisk(worktree, apiEntry.data);
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

  return result;
}

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
        if (apiContent) writeConfigToDisk(worktree, apiContent);
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

// ── Bulk Sync Operations ───────────────────────────────────────────────────

/**
 * Full sync — triggered on session.created.
 * Performs all resource syncs and writes the manifest.
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

// ── Throttle State ─────────────────────────────────────────────────────────

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

// ── Logging Helper ─────────────────────────────────────────────────────────

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

// ── Plugin Exports ─────────────────────────────────────────────────────────

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
