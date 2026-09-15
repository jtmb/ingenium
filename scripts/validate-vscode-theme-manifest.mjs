import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, normalize } from "node:path";
import { isDeepStrictEqual } from "node:util";

const [manifestPath, runtimeVersion] = process.argv.slice(2);

if (
  !manifestPath ||
  !runtimeVersion ||
  !isAbsolute(manifestPath) ||
  normalize(manifestPath) !== manifestPath ||
  basename(manifestPath) !== "package.json"
) {
  throw new Error("invalid built-in VS Code theme manifest path or runtime version");
}

const manifestDirectory = dirname(manifestPath);
const directoryStat = lstatSync(manifestDirectory);
const manifestStat = lstatSync(manifestPath);
if (
  !directoryStat.isDirectory() ||
  directoryStat.isSymbolicLink() ||
  realpathSync(manifestDirectory) !== manifestDirectory ||
  !manifestStat.isFile() ||
  manifestStat.isSymbolicLink() ||
  !isDeepStrictEqual(readdirSync(manifestDirectory).sort(), ["package.json"])
) {
  throw new Error("unsafe built-in VS Code theme manifest location");
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const runtime = /^(\d+)\.(\d+)\.(\d+)$/.exec(runtimeVersion);
const engine = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(manifest.engines?.vscode ?? "");
const defaults = {
  "window.autoDetectColorScheme": true,
  "workbench.preferredDarkColorTheme": "Dark Modern",
  "workbench.preferredLightColorTheme": "Light Modern",
};
const forbidden = [
  "main",
  "browser",
  "activationEvents",
  "scripts",
  "dependencies",
  "devDependencies",
  "permissions",
];
const atLeast = (actual, minimum) =>
  actual[0] > minimum[0] ||
  (actual[0] === minimum[0] &&
    (actual[1] > minimum[1] ||
      (actual[1] === minimum[1] && actual[2] >= minimum[2])));

if (
  manifest.name !== "system-theme-defaults" ||
  manifest.publisher !== "ingenium" ||
  manifest.version !== "1.0.0" ||
  !runtime ||
  !engine ||
  Number(runtime[1]) !== Number(engine[1]) ||
  !atLeast(runtime.slice(1).map(Number), engine.slice(1).map(Number)) ||
  !isDeepStrictEqual(manifest.contributes?.configurationDefaults, defaults) ||
  forbidden.some((key) => Object.hasOwn(manifest, key))
) {
  throw new Error("built-in VS Code theme defaults manifest validation failed");
}
