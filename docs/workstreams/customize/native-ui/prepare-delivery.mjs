import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function flag(name) { const i = args.indexOf(name); if (i < 0 || !args[i + 1]) throw new Error("Missing " + name); return args[i + 1]; }
const source = flag("--source"), gitRoot = flag("--git-root"), git = flag("--git-executable");
const tree = "268acab8c5dcf14ab188ecd8fdcbb21c9316179b";
const canonical = data => Buffer.from(data.toString("utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"), "utf8");
const sha = data => createHash("sha256").update(data).digest("hex");
const gitArgs = ["-c", "safe.directory=" + gitRoot, "-c", "core.longpaths=true", "-C", gitRoot];
const gitRead = (...more) => execFileSync(git, [...gitArgs, ...more], {stdio: ["ignore", "pipe", "pipe"]});
if (gitRead("cat-file", "-t", tree).toString().trim() !== "tree") throw new Error("Required native baseline tree missing");
const filesRoot = path.join(root, "files");
function walk(dir) { return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
  if (entry.isSymbolicLink()) throw new Error("Source delivery cannot contain links");
  const current = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(current) : [current];
}); }
const files = walk(filesRoot).sort().map(file => {
  const target = path.relative(filesRoot, file).split(path.sep).join("/");
  if (!target.startsWith("apps/web/src/features/customize/")) throw new Error("Unexpected target territory");
  if (fs.existsSync(path.join(source, target))) throw new Error("Target already exists; preserve and reconcile: " + target);
  const data = canonical(fs.readFileSync(file));
  if (!data.toString().endsWith("\n")) throw new Error("Source must end in LF: " + target);
  fs.writeFileSync(file, data);
  return {path: target, precondition: "absent", preSha256: null, postSha256: sha(data), bytes: data.length};
});
const paths = [
  "apps/web/src/app/App.tsx", "apps/web/src/features/work-ui/NativeWorkDesktop.tsx",
  "apps/web/src/features/extensions/PluginPackages.tsx", "apps/web/src/features/extensions/SkillWorkspace.tsx",
  "apps/web/src/features/extensions/ExtensionsPanel.tsx", "apps/web/src/features/extensions/InstructionEditor.tsx",
  "apps/web/src/features/extensions/ScopedEngineSettings.tsx", "apps/web/src/platform/types.ts",
  "apps/service/src/routes/plugin_packages.rs", "apps/service/src/routes/extension_config/skill_workspace.rs",
  "crates/adapters/src/plugin_packages.rs",
];
const prerequisites = paths.map(file => {
  const data = gitRead("cat-file", "blob", tree + ":" + file);
  const live = fs.readFileSync(path.join(source, file));
  return {path: file, baselineBlob: gitRead("rev-parse", tree + ":" + file).toString().trim(),
    canonicalPreSha256: sha(canonical(data)), baselineRawSha256: sha(data), observedRawSha256: sha(live),
    currentCanonicalMatchesBaseline: sha(canonical(live)) === sha(canonical(data))};
});
const patch = files.map(file => {
  const text = fs.readFileSync(path.join(filesRoot, file.path), "utf8");
  const lines = text.slice(0, -1).split("\n");
  return "diff --git a/" + file.path + " b/" + file.path + "\nnew file mode 100644\n--- /dev/null\n+++ b/" + file.path
    + "\n@@ -0,0 +1," + lines.length + " @@\n" + lines.map(line => "+" + line).join("\n") + "\n";
}).join("");
fs.writeFileSync(path.join(root, "native-customize.patch"), patch);
const manifest = {schemaVersion: 1, sourceTree: tree, canonicalization: "UTF-8 without BOM; CRLF to LF; otherwise bytes preserved",
  mode: "new files only; no native integration/index/lock/route/root mutation", files, prerequisites,
  patchSha256: sha(Buffer.from(patch)), generatedDisposableOutputs: [],
  requiredConsumer: "Coordinator reviewed application, native semantic tests and browser/native qualification",
  endCondition: "Keep minimal durable source/patch/manifest receipts; coordinator reconciles its own build outputs"};
fs.writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({files: files.length, bytes: files.reduce((n,f)=>n+f.bytes,0), patchSha256: manifest.patchSha256,
  prerequisiteDrift: prerequisites.filter(p=>!p.currentCanonicalMatchesBaseline).map(p=>p.path)}));
