export const CANONICAL_PLUGIN_SPECS = Object.freeze([
  "file://{env:PWD}/packages/ingenium-extension/plugins/auto-observer.ts",
  "file://{env:PWD}/packages/ingenium-extension/plugins/observer.ts",
  "file://{env:PWD}/packages/ingenium-extension/plugins/resource-sync.ts",
  "file://{env:PWD}/packages/ingenium-extension/plugins/lifecycle.ts",
  "file://{env:PWD}/packages/ingenium-extension/ponytail/.opencode/plugins/ponytail.mjs",
]);

/**
 * OpenCode V2 does not run V1 plugin implementations and rejects file targets
 * for configured plugins, so the V2 runtime uses the adapter directories under
 * `plugins/v2/`. Both lists are materialized into the container image; a host
 * selects the list its OpenCode line supports.
 */
export const CANONICAL_PLUGIN_SPECS_V2 = Object.freeze([
  "file://{env:PWD}/packages/ingenium-extension/plugins/v2/auto-observer",
  "file://{env:PWD}/packages/ingenium-extension/plugins/v2/observer",
  "file://{env:PWD}/packages/ingenium-extension/plugins/v2/resource-sync",
  "file://{env:PWD}/packages/ingenium-extension/plugins/v2/lifecycle",
  "file://{env:PWD}/packages/ingenium-extension/plugins/v2/ponytail",
]);

export const CANONICAL_PROJECT_PLUGIN_PREFIX = "file://{env:PWD}/";

export const CANONICAL_PLUGIN_RUNTIME_ASSETS = Object.freeze([
  "context-upload-codec.mjs",
  "plugin-specs.mjs",
  "ponytail/package.json",
  "ponytail/.opencode/command",
  "ponytail/skills",
]);

/**
 * The V2 Ponytail adapter resolves the vendored helper modules at runtime, so
 * the closure cannot follow them as static imports. Keep them as explicit
 * runtime assets.
 */
export const CANONICAL_PLUGIN_RUNTIME_ASSETS_V2 = Object.freeze([
  "ponytail/hooks",
  "ponytail/.opencode/plugins/ponytail-frontmatter.cjs",
]);
