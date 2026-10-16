import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const paths = vi.hoisted(() => ({ config: "" }));
vi.mock("../lib/tools/paths.js", () => ({
  getConfigPath: () => paths.config,
  getPluginsBase: () => "",
  isGlobal: () => false,
}));

import { addPluginToConfig, removePluginFromConfig } from "../lib/tools/plugins.js";

let directory = "";
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
});

it("migrates legacy plugin entries into the native plugins array", () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-plugin-config-"));
  paths.config = join(directory, "opencode.json");
  writeFileSync(paths.config, JSON.stringify({
    plugins: ["./bootstrap"],
    plugin: ["legacy.ts", ".opencode/plugins/local.ts"],
  }));

  addPluginToConfig("local.ts", "project");
  expect(JSON.parse(readFileSync(paths.config, "utf8"))).toEqual({
    plugins: ["./bootstrap", "legacy.ts", ".opencode/plugins/local.ts"],
  });

  removePluginFromConfig("local.ts", "project");
  expect(JSON.parse(readFileSync(paths.config, "utf8"))).toEqual({
    plugins: ["./bootstrap", "legacy.ts"],
  });
});
