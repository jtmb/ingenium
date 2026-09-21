import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const extensionRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const projectPluginPrefix = "file://{env:PWD}/packages/ingenium-extension/";
const testPathPattern = /(^|\/)(__tests__|tests?|fixtures?)(\/|$)|\.(?:spec|test)\.[^/]+$/i;
const secretPathPattern = /(^|\/)(?:\.env(?:\.[^/]*)?|secrets?)(\/|$)|\.(?:key|pem|p12|pfx)$/i;

function portablePath(path) {
  return path.replaceAll("\\", "/");
}

function assertContainedRuntimePath(root, path) {
  const relativePath = portablePath(relative(root, path));
  if (!relativePath || isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith("../")) {
    throw new Error(`Plugin runtime path escapes the extension root: ${path}`);
  }
  if (testPathPattern.test(relativePath)) throw new Error(`Plugin runtime closure includes a test path: ${relativePath}`);
  if (secretPathPattern.test(relativePath)) throw new Error(`Plugin runtime closure includes a secret path: ${relativePath}`);
  return relativePath;
}

function importCandidates(unresolvedPath) {
  const extension = extname(unresolvedPath);
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    const stem = unresolvedPath.slice(0, -extension.length);
    return [unresolvedPath, `${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`];
  }
  if (extension) return [unresolvedPath];
  return [
    unresolvedPath,
    ...[".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"].map((suffix) => `${unresolvedPath}${suffix}`),
    ...["index.ts", "index.tsx", "index.mts", "index.cts", "index.js", "index.mjs", "index.cjs"]
      .map((name) => join(unresolvedPath, name)),
  ];
}

function resolveLocalImport(root, importer, specifier) {
  const unresolvedPath = resolve(dirname(importer), specifier);
  assertContainedRuntimePath(root, unresolvedPath);
  for (const candidate of importCandidates(unresolvedPath)) {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
    const resolvedCandidate = realpathSync(candidate);
    assertContainedRuntimePath(root, resolvedCandidate);
    return resolvedCandidate;
  }
  const importerPath = portablePath(relative(root, importer));
  const missingPath = portablePath(relative(root, unresolvedPath));
  throw new Error(`Missing local plugin import "${specifier}" from "${importerPath}" (resolved path: "${missingPath}")`);
}

export function canonicalPluginEntryPaths(specs) {
  return specs.flatMap((spec) => {
    if (typeof spec !== "string" || !spec.startsWith(projectPluginPrefix)) {
      throw new Error(`Canonical plugin spec must use ${projectPluginPrefix}: ${String(spec)}`);
    }
    const entryPath = spec.slice(projectPluginPrefix.length);
    const absolutePath = resolve(extensionRoot, entryPath);
    // V2 config plugins target directories; the runtime loads their index file.
    if (existsSync(absolutePath) && statSync(absolutePath).isDirectory()) {
      return [join(entryPath, "index.ts")];
    }
    return [entryPath];
  });
}

export function resolvePluginSourceClosure(root, entryPaths) {
  const canonicalRoot = realpathSync(root);
  const pending = entryPaths.map((entryPath) => {
    const candidate = resolve(canonicalRoot, entryPath);
    assertContainedRuntimePath(canonicalRoot, candidate);
    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      throw new Error(`Missing canonical plugin entry: ${portablePath(entryPath)}`);
    }
    return realpathSync(candidate);
  });
  const visited = new Set();

  while (pending.length > 0) {
    const sourcePath = pending.pop();
    if (visited.has(sourcePath)) continue;
    assertContainedRuntimePath(canonicalRoot, sourcePath);
    visited.add(sourcePath);
    const imports = ts.preProcessFile(readFileSync(sourcePath, "utf8"), true, true).importedFiles;
    for (const imported of imports) {
      if (!imported.fileName.startsWith(".")) continue;
      pending.push(resolveLocalImport(canonicalRoot, sourcePath, imported.fileName));
    }
  }

  return [...visited].map((path) => assertContainedRuntimePath(canonicalRoot, path)).sort();
}

function collectAssetFiles(root, assetPaths) {
  const files = new Set();
  const visit = (path) => {
    const relativePath = assertContainedRuntimePath(root, path);
    if (!existsSync(path)) throw new Error(`Missing plugin runtime asset: ${relativePath}`);
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink()) throw new Error(`Plugin runtime asset must not be a symlink: ${relativePath}`);
    if (metadata.isFile()) {
      files.add(relativePath);
      return;
    }
    if (!metadata.isDirectory()) throw new Error(`Plugin runtime asset is not a regular file or directory: ${relativePath}`);
    for (const entry of readdirSync(path, { withFileTypes: true })) visit(join(path, entry.name));
  };

  for (const assetPath of assetPaths) visit(resolve(root, assetPath));
  return [...files].sort();
}

export function createCanonicalPluginClosure(root, specs, assetPaths) {
  const canonicalRoot = realpathSync(root);
  const sources = resolvePluginSourceClosure(canonicalRoot, canonicalPluginEntryPaths(specs));
  const assets = collectAssetFiles(canonicalRoot, assetPaths).filter((path) => !sources.includes(path));
  return { sources, assets, files: [...new Set([...sources, ...assets])].sort() };
}

export function materializePluginClosure(root, destination, closure) {
  if (existsSync(destination)) throw new Error(`Plugin closure destination already exists: ${destination}`);
  mkdirSync(destination, { recursive: false });
  for (const relativePath of closure.files) {
    const source = resolve(root, relativePath);
    assertContainedRuntimePath(root, source);
    const target = resolve(destination, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

async function canonicalClosure() {
  const specsPath = join(extensionRoot, "plugin-specs.mjs");
  const specs = await import(pathToFileURL(specsPath).href);
  return createCanonicalPluginClosure(
    extensionRoot,
    [...specs.CANONICAL_PLUGIN_SPECS, ...(specs.CANONICAL_PLUGIN_SPECS_V2 ?? [])],
    [...specs.CANONICAL_PLUGIN_RUNTIME_ASSETS, ...(specs.CANONICAL_PLUGIN_RUNTIME_ASSETS_V2 ?? [])],
  );
}

async function main(args) {
  const [command, value] = args;
  const closure = await canonicalClosure();
  if (command === "--check") {
    process.stdout.write(`Plugin runtime closure validated (${closure.sources.length} sources, ${closure.assets.length} assets)\n`);
    return;
  }
  if (command === "--list") {
    process.stdout.write(`${JSON.stringify(closure, null, 2)}\n`);
    return;
  }
  if (command === "--materialize" && value && args.length === 2) {
    materializePluginClosure(extensionRoot, resolve(value), closure);
    process.stdout.write(`Materialized ${closure.files.length} plugin runtime files\n`);
    return;
  }
  throw new Error("Usage: plugin-source-closure.mjs --check | --list | --materialize <directory>");
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
