import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error The Docker closure utility is intentionally runtime JavaScript.
import { createCanonicalPluginClosure, materializePluginClosure, resolvePluginSourceClosure } from "./scripts/plugin-source-closure.mjs";
// @ts-expect-error This runtime ESM manifest intentionally has no TypeScript declaration file.
import { CANONICAL_PLUGIN_RUNTIME_ASSETS, CANONICAL_PLUGIN_SPECS } from "./plugin-specs.mjs";

const extensionRoot = resolve(import.meta.dirname);
const temporaryDirectories: string[] = [];
const expectedSources = [
  "api-auth.ts",
  "auto-observer.ts",
  "coordination-outbox.ts",
  "extension-binding.ts",
  "mcp-client.ts",
  "mcp-tool-state.ts",
  "observer-core.ts",
  "observer.ts",
  "plugin-lifecycle-log.ts",
  "plugins/auto-observer.ts",
  "plugins/observer.ts",
  "plugins/resource-sync.ts",
  "plugins/session-coordinator.ts",
  "ponytail/.opencode/plugins/ponytail-frontmatter.cjs",
  "ponytail/.opencode/plugins/ponytail.mjs",
  "ponytail/hooks/ponytail-config.js",
  "ponytail/hooks/ponytail-instructions.js",
  "project-name.ts",
  "project-resolver.ts",
  "resource-sync.ts",
  "scripts/managed-command-wrapper.ts",
  "session-coordinator.ts",
];
const expectedAssets = [
  "plugin-specs.mjs",
  "ponytail/.opencode/command/ponytail-audit.md",
  "ponytail/.opencode/command/ponytail-debt.md",
  "ponytail/.opencode/command/ponytail-gain.md",
  "ponytail/.opencode/command/ponytail-help.md",
  "ponytail/.opencode/command/ponytail-review.md",
  "ponytail/.opencode/command/ponytail.md",
  "ponytail/package.json",
  "ponytail/skills/ponytail-audit/SKILL.md",
  "ponytail/skills/ponytail-debt/SKILL.md",
  "ponytail/skills/ponytail-gain/SKILL.md",
  "ponytail/skills/ponytail-help/SKILL.md",
  "ponytail/skills/ponytail-review/SKILL.md",
  "ponytail/skills/ponytail/SKILL.md",
];

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function listFiles(root: string, directory = root): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(root, path) : [path.slice(root.length + 1).replaceAll("\\", "/")];
  }).sort();
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("canonical plugin source closure", () => {
  it("resolves the exact configured source graph and runtime assets", () => {
    const closure = createCanonicalPluginClosure(extensionRoot, CANONICAL_PLUGIN_SPECS, CANONICAL_PLUGIN_RUNTIME_ASSETS);

    expect(closure.sources).toEqual(expectedSources);
    expect(closure.assets).toEqual(expectedAssets);
    expect(closure.files).not.toContain("skill-sync.ts");
    expect(closure.files.every((path: string) => !/(^|\/)(?:tests?|secrets?)(\/|$)|\.(?:test|spec)\./i.test(path))).toBe(true);
  });

  it("materializes only the validated closure with byte-identical content", () => {
    const parent = temporaryDirectory("ingenium-plugin-closure-");
    const destination = join(parent, "runtime");
    const closure = createCanonicalPluginClosure(extensionRoot, CANONICAL_PLUGIN_SPECS, CANONICAL_PLUGIN_RUNTIME_ASSETS);

    materializePluginClosure(extensionRoot, destination, closure);

    expect(listFiles(destination)).toEqual(closure.files);
    for (const path of closure.files) {
      expect(readFileSync(join(destination, path))).toEqual(readFileSync(join(extensionRoot, path)));
    }
  });

  it("reports the importing file and exact unresolved path", () => {
    const fixture = temporaryDirectory("ingenium-plugin-missing-import-");
    writeFileSync(join(fixture, "entry.ts"), 'import "./missing.js";\n', "utf8");

    expect(() => resolvePluginSourceClosure(fixture, ["entry.ts"]))
      .toThrow('Missing local plugin import "./missing.js" from "entry.ts" (resolved path: "missing.js")');
  });
});
