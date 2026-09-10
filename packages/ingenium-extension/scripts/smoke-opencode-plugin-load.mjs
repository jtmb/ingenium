import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const [extensionRootArgument, opencodeArgument] = process.argv.slice(2);
if (!extensionRootArgument || !opencodeArgument) {
  throw new Error("Usage: smoke-opencode-plugin-load.mjs <extension-root> <opencode-binary>");
}

const extensionRoot = resolve(extensionRootArgument);
const opencode = resolve(opencodeArgument);
const temporaryRoot = mkdtempSync(join(tmpdir(), "ingenium-plugin-smoke-"));
const workspace = join(temporaryRoot, "workspace");
const home = join(temporaryRoot, "home");
const configHome = join(home, ".config");
const dataHome = join(home, ".local", "share");
const cacheHome = join(home, ".cache");
const stateHome = join(home, ".local", "state");

try {
  for (const directory of [workspace, configHome, dataHome, cacheHome, stateHome]) {
    mkdirSync(directory, { recursive: true });
  }
  const { CANONICAL_PLUGIN_SPECS, CANONICAL_PROJECT_PLUGIN_PREFIX } = await import(
    pathToFileURL(join(extensionRoot, "plugin-specs.mjs")).href
  );
  const plugin = CANONICAL_PLUGIN_SPECS.map((spec) => {
    if (!spec.startsWith(CANONICAL_PROJECT_PLUGIN_PREFIX)) throw new Error(`Invalid canonical plugin spec: ${spec}`);
    return pathToFileURL(join(extensionRoot, spec.slice(CANONICAL_PROJECT_PLUGIN_PREFIX.length)
      .replace("packages/ingenium-extension/", ""))).href;
  });
  const configPath = join(workspace, "opencode.json");
  writeFileSync(configPath, `${JSON.stringify({ permission: { "*": "deny" }, mcp: {}, plugin })}\n`, "utf8");
  const version = spawnSync(opencode, ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (version.status !== 0 || version.stdout.trim() !== "1.18.9") {
    throw new Error(`Expected OpenCode 1.18.9, received ${version.stdout.trim() || version.stderr.trim()}`);
  }
  const result = spawnSync(opencode, ["debug", "config"], {
    cwd: workspace,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: home,
      XDG_CONFIG_HOME: configHome,
      XDG_DATA_HOME: dataHome,
      XDG_CACHE_HOME: cacheHome,
      XDG_STATE_HOME: stateHome,
      PWD: workspace,
      CI: "1",
      NO_COLOR: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`OpenCode plugin load failed: ${(result.error?.message ?? result.stderr ?? result.stdout).trim().slice(0, 2000)}`);
  }
  const resolvedConfig = JSON.parse(result.stdout);
  if (JSON.stringify(resolvedConfig.plugin) !== JSON.stringify(plugin)) {
    throw new Error("OpenCode did not retain the exact canonical plugin list");
  }
  const commandNames = Object.keys(resolvedConfig.command ?? {}).filter((name) => name.startsWith("ponytail")).sort();
  if (JSON.stringify(commandNames) !== JSON.stringify([
    "ponytail",
    "ponytail-audit",
    "ponytail-debt",
    "ponytail-gain",
    "ponytail-help",
    "ponytail-review",
  ])) {
    throw new Error("OpenCode did not load Ponytail's complete runtime command assets");
  }
  if (readdirSync(workspace).join("\n") !== "opencode.json" || readFileSync(configPath, "utf8").includes("credential")) {
    throw new Error("OpenCode plugin smoke mutated the worktree or introduced credential material");
  }
  process.stdout.write(`OpenCode loaded ${plugin.length} canonical plugins without credentials\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
