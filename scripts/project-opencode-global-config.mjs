#!/usr/bin/env node
import { closeSync, constants, fchmodSync, fchownSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, resolve } from "node:path";
import { CANONICAL_PLUGIN_SPECS_V2 } from "../packages/ingenium-extension/plugin-specs.mjs";

const DEFAULT_CONFIG = "opencode.jsonc";
const REQUIRED_PLUGINS = CANONICAL_PLUGIN_SPECS_V2;
const MANAGED_AGENT_NAMES = new Set([
  "plan", "build", "general", "explore",
  "ingenium-docs", "ingenium-qa",
  "ingenium-software-engineer-fast", "ingenium-software-engineer-premium",
  "ingenium-recovery-engineer", "ingenium-orchestrator", "ingenium-explore",
  "ingenium-scout", "ingenium-chat", "ingenium-security-auditor",
]);
const RETIRED_AGENT_NAMES = new Set(["browser-agent"]);
const RESERVED_BROKER_AGENT = "ingenium-llm-broker";
const MANAGED_AGENT_IDS = new Map([
  ["primary/plan", "plan"],
  ["ingenium-docs", "execution/ingenium-docs"],
  ["ingenium-qa", "execution/ingenium-qa"],
  ["ingenium-software-engineer-fast", "execution/ingenium-software-engineer-fast"],
  ["ingenium-software-engineer-premium", "execution/ingenium-software-engineer-premium"],
  ["ingenium-recovery-engineer", "execution/ingenium-recovery-engineer"],
  ["ingenium-orchestrator", "primary/ingenium-orchestrator"],
  ["ingenium-explore", "research/ingenium-explore"],
  ["ingenium-scout", "research/ingenium-scout"],
  ["ingenium-chat", "chat/ingenium-chat"],
  ["ingenium-security-auditor", "security/ingenium-security-auditor"],
]);
const PERMISSION_ACTION_ALIASES = { bash: "shell", task: "subagent", write: "edit", patch: "edit" };

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function permissionRules(value) {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map((rule) => ({ ...rule }));
  if (typeof value === "string") return [{ action: "*", resource: "*", effect: value }];
  if (!isRecord(value)) throw new Error("Invalid agent permissions");
  return Object.entries(value).flatMap(([rawAction, effect]) => {
    const action = PERMISSION_ACTION_ALIASES[rawAction] ?? rawAction;
    if (typeof effect === "string") return [{ action, resource: "*", effect }];
    if (!isRecord(effect)) throw new Error("Invalid agent permission effect");
    return Object.entries(effect).map(([resource, resourceEffect]) => {
      if (typeof resourceEffect !== "string") throw new Error("Invalid agent permission resource effect");
      return { action, resource, effect: resourceEffect };
    });
  });
}

function nativeAgent(value) {
  const entry = { ...value };
  if (typeof entry.model === "string" && typeof entry.variant === "string" && !entry.model.includes("#")) {
    entry.model = `${entry.model}#${entry.variant}`;
  }
  delete entry.variant;
  if (entry.system === undefined && entry.prompt !== undefined) entry.system = entry.prompt;
  delete entry.prompt;
  if (entry.disabled === undefined && entry.disable !== undefined) entry.disabled = entry.disable;
  delete entry.disable;
  if (entry.permissions === undefined && entry.permission !== undefined) {
    entry.permissions = permissionRules(entry.permission);
  }
  delete entry.permission;
  if (isRecord(entry.tools)) {
    entry.permissions = [
      ...permissionRules(entry.permissions),
      ...Object.entries(entry.tools).map(([action, enabled]) => ({
        action: PERMISSION_ACTION_ALIASES[action] ?? action,
        resource: "*",
        effect: enabled === true ? "allow" : "deny",
      })),
    ];
    delete entry.tools;
  }
  if (entry.steps === undefined && entry.maxSteps !== undefined) entry.steps = entry.maxSteps;
  delete entry.maxSteps;
  return entry;
}

function hasDefaultDeny(value) {
  if (!Array.isArray(value.permissions)) return false;
  const wildcardRules = value.permissions.filter((rule) => isRecord(rule)
    && rule.action === "*" && rule.resource === "*");
  return wildcardRules.at(-1)?.effect === "deny";
}

/** Remove JSONC comments without changing string literal contents. */
function stripJsoncComments(input) {
  let output = "";
  let quote = "";
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    const next = input[index + 1];
    if (quote) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === '"') {
      quote = current;
      output += current;
      continue;
    }
    if (current === "/" && next === "/") {
      index += 1;
      while (index + 1 < input.length && input[index + 1] !== "\n" && input[index + 1] !== "\r") index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      index += 1;
      while (index + 1 < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
        index += 1;
      }
      if (index + 1 >= input.length) throw new Error("Unterminated JSONC comment");
      index += 1;
      continue;
    }
    output += current;
  }
  if (quote) throw new Error("Unterminated JSON string");
  return output;
}

/** Remove JSONC trailing commas outside string literals. */
function removeTrailingCommas(input) {
  let output = "";
  let quote = "";
  let escaped = false;

  for (let index = 0; index < input.length; index += 1) {
    const current = input[index];
    if (quote) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = "";
      continue;
    }
    if (current === '"') {
      quote = current;
      output += current;
      continue;
    }
    if (current === ",") {
      let next = index + 1;
      while (next < input.length && /\s/.test(input[next])) next += 1;
      if (input[next] === "}" || input[next] === "]") continue;
    }
    output += current;
  }
  return output;
}

function readRegularFile(filePath) {
  let descriptor;
  try {
    descriptor = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(descriptor).isFile()) throw new Error("Config must be a regular file");
    return readFileSync(descriptor, "utf8");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function readConfig(configPath) {
  try {
    const metadata = lstatSync(configPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Config must be a regular non-symlink file");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return {};
    throw error;
  }

  // The descriptor is opened with O_NOFOLLOW so a persistent config cannot
  // redirect parsing through a symlink between validation and use.
  const parsed = JSON.parse(removeTrailingCommas(stripJsoncComments(readRegularFile(configPath))));
  if (!isRecord(parsed)) throw new Error("Config root must be an object");
  return parsed;
}

function isManagedPlugin(value) {
  return typeof value === "string" && (
    // Retire the cancelled multichat coordinator from persistent installations.
    /(?:^|\/)plugins\/session-coordinator(?:\.ts|\.js)?$/.test(value)
    // V2 adapter directories.
    || /(?:^|\/)plugins\/v2\/(?:auto-observer|observer|resource-sync|lifecycle|ponytail)(?:\/|$)/.test(value)
    // Legacy V1 file entries retained in persistent configs.
    || /(?:^|\/)(?:auto-observer|observer|resource-sync|lifecycle)(?:-plugin)?(?:\.ts|\.js)?$|(?:^|\/)skill-sync(?:\.ts|\.js)?$/.test(value)
    || /^@dietrichgebert\/ponytail(?:@[^/]+)?$/.test(value)
    || /(?:^|\/)\.opencode\/plugins\/ponytail\.mjs$/.test(value)
  );
}

function writeAtomically(configPath, value) {
  const directory = dirname(configPath);
  const directoryMetadata = statSync(directory);
  if (!directoryMetadata.isDirectory()) throw new Error("Config directory is unavailable");
  let mode = 0o600;
  let ownership;
  try {
    const metadata = lstatSync(configPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("Config must be a regular non-symlink file");
    mode = (metadata.mode & 0o777) === 0o660 ? 0o660 : 0o600;
    ownership = { uid: metadata.uid, gid: metadata.gid };
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }
  // Write a private, exclusive temporary file and rename only after fsync so
  // readers never observe partial JSON or follow a caller-controlled temp link.
  const temporaryPath = resolve(directory, `.${basename(configPath)}.${process.pid}.${randomUUID()}.tmp`);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  let descriptor;
  try {
    // Exclusive creation prevents a pre-existing temporary path from being
    // reused, while O_NOFOLLOW rejects a symlink at that path.
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, content, "utf8");
    if (ownership) fchownSync(descriptor, ownership.uid, ownership.gid);
    fchmodSync(descriptor, mode);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, configPath);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * Project the container-owned Ingenium entries into OpenCode's persistent global
 * config. All unrelated settings are preserved. This is intentionally separate
 * from repository synchronization: it repairs only the container bootstrap
 * contract and never reads or writes token contents.
 */
function projectedOpenCodeGlobalConfig(config) {
  const legacyAgents = isRecord(config.agent) ? config.agent : {};
  const nativeAgents = isRecord(config.agents) ? config.agents : {};
  const agents = {};
  for (const [name, value] of [...Object.entries(legacyAgents), ...Object.entries(nativeAgents)]) {
    if (name === "primary/plan" && Object.hasOwn(nativeAgents, "plan")) continue;
    const id = MANAGED_AGENT_IDS.get(name) ?? name;
    if (RETIRED_AGENT_NAMES.has(name) || RETIRED_AGENT_NAMES.has(id)) {
      delete agents[id];
      continue;
    }
    if (name === RESERVED_BROKER_AGENT || id === RESERVED_BROKER_AGENT) {
      delete agents[id];
      continue;
    }
    if (!isRecord(value)) throw new Error("Agent override must be an object");
    const entry = nativeAgent(value);
    if (!MANAGED_AGENT_NAMES.has(name) && !MANAGED_AGENT_IDS.has(name)
      && ![...MANAGED_AGENT_IDS.values()].includes(id)) {
      if (name.startsWith("ingenium-") && !hasDefaultDeny(entry)) {
        throw new Error("Permissive unknown Ingenium agent override");
      }
      agents[id] = entry;
      continue;
    }
    if (typeof entry.model === "string") agents[id] = { model: entry.model };
    else delete agents[id];
  }
  if (Object.keys(agents).length > 0) config.agents = agents;
  else delete config.agents;
  delete config.agent;
  if (config.default_agent === "primary/plan") config.default_agent = "plan";

  const mcp = isRecord(config.mcp) ? config.mcp : {};
  delete mcp.ponytail;
  const servers = isRecord(mcp.servers) ? { ...mcp.servers } : {};
  delete servers.ponytail;
  const existingIngenium = isRecord(servers.ingenium)
    ? servers.ingenium
    : isRecord(mcp.ingenium) ? mcp.ingenium : {};
  delete mcp.ingenium;
  const environment = isRecord(existingIngenium.environment) ? { ...existingIngenium.environment } : {};

  // Config is persistent and may predate scoped credentials. Remove every
  // installation-bearer projection and install only the scoped MCP reference.
  delete environment.INGENIUM_API_TOKEN;
  delete environment.INGENIUM_API_TOKEN_FILE;
  delete environment.INGENIUM_MCP_CREDENTIAL;
  environment.INGENIUM_API_URL = "http://localhost:4097/api/v1";
  environment.INGENIUM_MCP_CREDENTIAL_FILE = "/run/ingenium-opencode/.ingenium-mcp-credential";
  environment.INGENIUM_MCP_AUDIENCE = "mcp";
  environment.INGENIUM_MCP_CREDENTIAL_PURPOSE = "general";
  environment.INGENIUM_PROJECT = "ingenium";
  environment.INGENIUM_WORKSPACE_ID = "shared-memory-ingenium";
  environment.INGENIUM_WORKTREE = "/home/brajam/repos/ingenium";
  const existingTimeout = existingIngenium.timeout;
  servers.ingenium = {
    ...existingIngenium,
    type: "local",
    command: ["node", "/app/packages/ingenium-extension/dist/scripts/mcp-server.js"],
    disabled: false,
    ...(typeof existingTimeout === "number"
      ? { timeout: { catalog: existingTimeout, execution: existingTimeout } }
      : {}),
    environment,
  };
  delete servers.ingenium.enabled;
  mcp.servers = servers;
  config.mcp = mcp;

  const existingPlugins = Array.isArray(config.plugins) ? config.plugins : [];
  const legacyPlugins = Array.isArray(config.plugin) ? config.plugin : [];
  const retainedPlugins = [...existingPlugins, ...legacyPlugins].filter((entry) => !isManagedPlugin(entry));
  config.plugins = [
    ...retainedPlugins,
    ...REQUIRED_PLUGINS.filter((entry) => !retainedPlugins.includes(entry)),
  ];
  delete config.plugin;

  return config;
}

export function projectOpenCodeGlobalConfig(configPath = DEFAULT_CONFIG) {
  const config = projectedOpenCodeGlobalConfig(readConfig(configPath));
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeAtomically(configPath, config);
}

/** Prepare an explicit container config without changing the host checkout. */
export function projectOpenCodeContainerConfig(sourcePath, destinationPath) {
  if (!sourcePath || !destinationPath || resolve(sourcePath) === resolve(destinationPath)) {
    throw new Error("Container configuration requires distinct source and destination files");
  }
  // A missing source is an error here, rather than an empty installation seed.
  readRegularFile(sourcePath);
  const source = readConfig(sourcePath);
  const config = projectedOpenCodeGlobalConfig({
    ...source,
    // Container services and plugins come from the image. Host-only commands,
    // PATH overrides and credentials must not leak into this deployment copy.
    mcp: {},
    plugins: [],
    plugin: [],
  });
  mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o700 });
  writeAtomically(destinationPath, config);
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
}

if (isMain()) {
  try {
    if (process.argv[2] === "--container") {
      if (process.argv.length !== 5) throw new Error("Invalid container configuration arguments");
      projectOpenCodeContainerConfig(process.argv[3], process.argv[4]);
    } else {
      projectOpenCodeGlobalConfig(process.argv[2] ?? DEFAULT_CONFIG);
    }
  } catch {
    // This runs before OpenCode starts. Do not print a path, parsed content, or
    // lower-level error: a persistent config can contain sensitive provider data.
    process.stderr.write("ERROR: Unable to project the protected OpenCode configuration\n");
    process.exitCode = 1;
  }
}
