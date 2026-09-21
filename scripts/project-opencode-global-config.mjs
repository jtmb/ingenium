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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasDefaultDeny(value) {
  if (value === "deny" || (isRecord(value) && value["*"] === "deny")) return true;
  // V2 agent permissions are an ordered rule array; a terminal wildcard deny
  // is the equivalent guarantee.
  return isRecord(value) && Array.isArray(value.permissions)
    && value.permissions.some((rule) => isRecord(rule)
      && rule.action === "*" && rule.resource === "*" && rule.effect === "deny");
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
    // V2 adapter directories.
    /(?:^|\/)plugins\/v2\/(?:auto-observer|observer|resource-sync|lifecycle|ponytail)(?:\/|$)/.test(value)
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
export function projectOpenCodeGlobalConfig(configPath = DEFAULT_CONFIG) {
  const config = readConfig(configPath);
  const agentsSource = isRecord(config.agents) ? config.agents : (isRecord(config.agent) ? config.agent : {});
  const agent = { ...agentsSource };
  for (const [name, value] of Object.entries(agent)) {
    if (RETIRED_AGENT_NAMES.has(name)) {
      delete agent[name];
      continue;
    }
    if (!MANAGED_AGENT_NAMES.has(name)) {
      if (name.startsWith("ingenium-") && name !== RESERVED_BROKER_AGENT
        && (!isRecord(value) || !hasDefaultDeny(value.permission))) {
        throw new Error("Permissive unknown Ingenium agent override");
      }
      continue;
    }
    if (!isRecord(value)) {
      delete agent[name];
      continue;
    }
    const projection = Object.fromEntries(
      Object.entries(value).filter(([key]) => key === "model" || key === "variant"),
    );
    if (Object.keys(projection).length > 0) agent[name] = projection;
    else delete agent[name];
  }
  if (Object.keys(agent).length > 0) config.agents = agent;
  else delete config.agents;
  delete config.agent;

  const mcp = isRecord(config.mcp) ? config.mcp : {};
  delete mcp.ponytail;
  const existingIngenium = isRecord(mcp.ingenium) ? mcp.ingenium : {};
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
  mcp.ingenium = {
    ...existingIngenium,
    type: "local",
    command: ["node", "/app/packages/ingenium-extension/dist/scripts/mcp-server.js"],
    enabled: true,
    environment,
  };
  config.mcp = mcp;

  const existingPlugins = Array.isArray(config.plugins) ? config.plugins : [];
  const retainedPlugins = existingPlugins.filter((entry) => !isManagedPlugin(entry));
  config.plugins = [
    ...retainedPlugins,
    ...REQUIRED_PLUGINS.filter((entry) => !retainedPlugins.includes(entry)),
  ];
  // Legacy V1 entries cannot load under V2. Drop the container-owned ones while
  // preserving operator entries that are not part of the bootstrap contract.
  if (Array.isArray(config.plugin)) {
    const retainedLegacy = config.plugin.filter((entry) => !isManagedPlugin(entry));
    if (retainedLegacy.length > 0) config.plugin = retainedLegacy;
    else delete config.plugin;
  }

  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeAtomically(configPath, config);
}

function isMain() {
  return process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
}

if (isMain()) {
  try {
    projectOpenCodeGlobalConfig(process.argv[2] ?? DEFAULT_CONFIG);
  } catch {
    // This runs before OpenCode starts. Do not print a path, parsed content, or
    // lower-level error: a persistent config can contain sensitive provider data.
    process.stderr.write("ERROR: Unable to project the protected OpenCode configuration\n");
    process.exitCode = 1;
  }
}
