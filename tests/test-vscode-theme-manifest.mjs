import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(
  new URL("../scripts/validate-vscode-theme-manifest.mjs", import.meta.url),
);
const fixtureRoot = mkdtempSync(join(tmpdir(), "ingenium-vscode-theme-"));
const validManifest = {
  name: "system-theme-defaults",
  publisher: "ingenium",
  version: "1.0.0",
  engines: { vscode: "^1.131.0" },
  contributes: {
    configurationDefaults: {
      "window.autoDetectColorScheme": true,
      "workbench.preferredDarkColorTheme": "Dark Modern",
      "workbench.preferredLightColorTheme": "Light Modern",
    },
  },
};

const writeManifest = (directory, manifest = validManifest) => {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "package.json");
  writeFileSync(path, JSON.stringify(manifest));
  return path;
};
const validate = (manifestPath, runtimeVersion = "1.131.0") =>
  spawnSync(process.execPath, [validator, manifestPath, runtimeVersion], {
    encoding: "utf8",
  });
const expectRejected = (description, manifestPath, runtimeVersion) => {
  const result = validate(manifestPath, runtimeVersion);
  assert.notEqual(result.status, 0, `${description} was accepted`);
};

try {
  const validPath = writeManifest(join(fixtureRoot, "valid"));
  assert.equal(validate(validPath).status, 0, "VS Code 1.131.0 fixture was rejected");

  const malformedPath = writeManifest(join(fixtureRoot, "malformed"));
  writeFileSync(malformedPath, "{");
  expectRejected("malformed JSON", malformedPath);

  const missingDirectory = join(fixtureRoot, "missing");
  mkdirSync(missingDirectory);
  expectRejected("missing manifest", join(missingDirectory, "package.json"));

  const duplicateDirectory = join(fixtureRoot, "duplicate");
  const duplicatePath = writeManifest(duplicateDirectory);
  writeFileSync(join(duplicateDirectory, "package-copy.json"), "{}");
  expectRejected("duplicate sibling manifest", duplicatePath);

  const escapedDirectory = join(fixtureRoot, "escaped-target");
  writeManifest(escapedDirectory);
  const escapedLink = join(fixtureRoot, "escaped-link");
  symlinkSync(escapedDirectory, escapedLink, "dir");
  expectRejected("symlink path escape", join(escapedLink, "package.json"));

  const wrongEngine = structuredClone(validManifest);
  wrongEngine.engines.vscode = "^1.132.0";
  expectRejected(
    "incompatible VS Code engine",
    writeManifest(join(fixtureRoot, "wrong-engine"), wrongEngine),
  );

  console.log("PASS: built-in VS Code theme manifest validation");
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
}
