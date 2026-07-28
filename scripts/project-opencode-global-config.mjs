#!/usr/bin/env node
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, resolve } from "node:path";

const DEFAULT_CONFIG = "opencode.jsonc";
const REQUIRED_PLUGINS = [
  "/app/packages/ingenium-extension/auto-observer-plugin.ts",
  "/app/packages/ingenium-extension/observer-plugin.ts",
  "/app/packages/ingenium-extension/resource-sync-plugin.ts",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

  const parsed = JSON.parse(removeTrailingCommas(stripJsoncComments(readRegularFile(configPath))));
  if (!isRecord(parsed)) throw new Error("Config root must be an object");
  return parsed;
}

function isManagedPlugin(value) {
  return typeof value === "string" && /(?:^|\/)(?:auto-observer|observer|resource-sync)(?:-plugin)?(?:\.ts|\.js)?$|(?:^|\/)skill-sync(?:\.ts|\.js)?$/.test(value);
}

function writeAtomically(configPath, value) {
  const directory = dirname(configPath);
  const directoryMetadata = statSync(directory);
  if (!directoryMetadata.isDirectory()) throw new Error("Config directory is unavailable");
  const temporaryPath = resolve(directory, `.${basename(configPath)}.${process.pid}.${randomUUID()}.tmp`);
  const content = `${JSON.stringify(value, null, 2)}\n`;
  let descriptor;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    writeFileSync(descriptor, content, "utf8");
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
  const mcp = isRecord(config.mcp) ? config.mcp : {};
  const existingIngenium = isRecord(mcp.ingenium) ? mcp.ingenium : {};
  const environment = isRecord(existingIngenium.environment) ? { ...existingIngenium.environment } : {};

  // Config is persistent and may predate protected token files. Remove any
  // accidental inline bearer value and install only the relative protected path.
  delete environment.INGENIUM_API_TOKEN;
  environment.INGENIUM_API_URL = "http://localhost:4097/api/v1";
  environment.INGENIUM_API_TOKEN_FILE = ".opencode/.ingenium-api-token";
  environment.INGENIUM_PROJECT = "global-default";
  environment.INGENIUM_WORKTREE = "/workspace";
  mcp.ingenium = {
    ...existingIngenium,
    type: "local",
    command: ["node", "/app/packages/ingenium-extension/dist/scripts/mcp-server.js"],
    enabled: true,
    environment,
  };
  config.mcp = mcp;

  const existingPlugins = Array.isArray(config.plugin) ? config.plugin : [];
  const retainedPlugins = existingPlugins.filter((entry) => !isManagedPlugin(entry));
  config.plugin = [
    ...retainedPlugins,
    ...REQUIRED_PLUGINS.filter((entry) => !retainedPlugins.includes(entry)),
  ];

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
