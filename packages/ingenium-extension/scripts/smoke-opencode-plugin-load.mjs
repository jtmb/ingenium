import { spawn, spawnSync } from "node:child_process";
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
const EXPECTED_PLUGINS = [
  "ingenium-auto-observer",
  "ingenium-lifecycle",
  "ingenium-observer",
  "ingenium-resource-sync",
  "ponytail",
];

function isolatedEnvironment(extra) {
  return {
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
    ...extra,
  };
}

function waitForServerUrl(child, timeoutMs) {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffered = "";
    const timer = setTimeout(() => {
      rejectPromise(new Error(`OpenCode server did not report a URL within ${timeoutMs}ms: ${buffered.slice(-500)}`));
    }, timeoutMs);
    const inspect = (chunk) => {
      buffered += chunk.toString();
      const match = buffered.match(/server listening on (http:\/\/[^\s]+)/);
      if (match?.[1]) {
        clearTimeout(timer);
        resolvePromise(match[1]);
      }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", (code) => {
      clearTimeout(timer);
      rejectPromise(new Error(`OpenCode server exited early with code ${code}: ${buffered.slice(-500)}`));
    });
  });
}

try {
  for (const directory of [workspace, configHome, dataHome, cacheHome, stateHome]) {
    mkdirSync(directory, { recursive: true });
  }

  const version = spawnSync(opencode, ["--version"], { encoding: "utf8", timeout: 10_000, env: isolatedEnvironment({}) });
  const reported = `${version.stdout ?? ""}${version.stderr ?? ""}`.trim();
  if (version.status !== 0 || !/^opencode v\d+\./.test(reported)) {
    throw new Error(`Expected an OpenCode V2 binary, received "${reported}"`);
  }

  const { CANONICAL_PLUGIN_SPECS_V2, CANONICAL_PROJECT_PLUGIN_PREFIX } = await import(
    pathToFileURL(join(extensionRoot, "plugin-specs.mjs")).href
  );
  const plugins = CANONICAL_PLUGIN_SPECS_V2.map((spec) => {
    if (!spec.startsWith(CANONICAL_PROJECT_PLUGIN_PREFIX)) throw new Error(`Invalid canonical plugin spec: ${spec}`);
    return pathToFileURL(join(extensionRoot, spec.slice(CANONICAL_PROJECT_PLUGIN_PREFIX.length)
      .replace("packages/ingenium-extension/", ""))).href;
  });
  const configPath = join(workspace, "opencode.json");
  writeFileSync(configPath, `${JSON.stringify({ permissions: [{ action: "*", resource: "*", effect: "deny" }], mcp: {}, plugins })}\n`, "utf8");

  const password = `smoke-${Math.random().toString(36).slice(2)}`;
  const child = spawn(opencode, ["serve", "--port", "0", "--hostname", "127.0.0.1"], {
    cwd: workspace,
    env: isolatedEnvironment({ OPENCODE_SERVER_PASSWORD: password }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const url = await waitForServerUrl(child, 45_000);
    const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    const deadline = Date.now() + 30_000;
    let active = [];
    let entries = [];
    for (;;) {
      const response = await fetch(`${url}/api/plugin`, { headers: { authorization } });
      if (!response.ok) throw new Error(`OpenCode plugin list failed with HTTP ${response.status}`);
      const payload = await response.json();
      entries = payload.data ?? [];
      active = entries
        .filter((entry) => entry?.source?.type !== "builtin")
        .map((entry) => entry.id)
        .sort();
      const failure = entries.find((entry) => entry?.source?.type !== "builtin" && entry.state?.status === "failed");
      if (failure) throw new Error(`OpenCode plugin ${failure.id ?? failure.source?.path} failed to load: ${JSON.stringify(failure.state)}`);
      if (JSON.stringify(active) === JSON.stringify(EXPECTED_PLUGINS) || Date.now() > deadline) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
    }
    if (JSON.stringify(active) !== JSON.stringify(EXPECTED_PLUGINS)) {
      throw new Error(`OpenCode loaded unexpected plugins: ${JSON.stringify(active)}`);
    }
    for (const entry of entries) {
      if (entry?.source?.type !== "builtin" && entry.state?.status !== "active") {
        throw new Error(`OpenCode plugin ${entry.id} is not active: ${JSON.stringify(entry.state)}`);
      }
    }
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolvePromise) => {
      const timer = setTimeout(resolvePromise, 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolvePromise();
      });
    });
  }

  if (readdirSync(workspace).join("\n") !== "opencode.json" || readFileSync(configPath, "utf8").includes("credential")) {
    throw new Error("OpenCode plugin smoke mutated the worktree or introduced credential material");
  }
  process.stdout.write(`OpenCode loaded ${EXPECTED_PLUGINS.length} canonical V2 plugins without credentials\n`);
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
