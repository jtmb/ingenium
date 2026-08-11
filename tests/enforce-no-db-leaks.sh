#!/usr/bin/env bash
# 🔴 CI Gate — prevents DB access leaks from non-API runtime consumers
#
# The scanner deliberately parses complete source files. Line-oriented grep is
# not sufficient for imports or request options split across multiple lines.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXIT_CODE=0
SELF_TEST_DIR=""

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

cleanup() {
  if [[ -n "$SELF_TEST_DIR" && -d "$SELF_TEST_DIR" ]]; then
    rm -rf -- "$SELF_TEST_DIR"
  fi
}
trap cleanup EXIT

runtime_source_files() {
  git -C "$ROOT_DIR" ls-files -z -- \
    '*.ts' '*.tsx' '*.mts' '*.cts' '*.js' '*.jsx' '*.mjs' '*.cjs' |
    while IFS= read -r -d '' file; do
      case "$file" in
        packages/ingenium-core/*|services/ingenium-api/*)
          continue
          ;;
        */tests/*|tests/*|*/__tests__/*|__tests__/*|*.test.*|*.spec.*)
          continue
          ;;
        docs/*|*/dist/*|*/build/*|*/.next/*|*/coverage/*|*/node_modules/*|*/vendor/*|*/artifacts/*|packages/ingenium-extension/ponytail/*)
          continue
          ;;
        *.config.ts|*.config.tsx|*.config.mts|*.config.cts|*.config.js|*.config.jsx|*.config.mjs|*.config.cjs|*/next-env.d.ts|*.d.ts)
          continue
          ;;
      esac
      printf '%s\0' "$file"
    done
}

mapfile -d '' RUNTIME_FILES < <(runtime_source_files)

scan_runtime_sources_at() {
  local scan_root="$1"
  shift
  node --input-type=module - "$scan_root" "$@" <<'NODE'
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const args = process.argv.slice(2);
const root = args.shift();
const files = args;
const violations = [];

const SQL_SPECIFIER = /^(?:better-sqlite3|sqlite3|sqlite|node:sqlite|bun:sqlite|sql\.js|@libsql\/client|@sqlite\.org\/sqlite-wasm|wa-sqlite|sqlite-wasm)$/i;
const SQLITE_SPECIFIER = /(?:^|[/])(?:better-sqlite3|sqlite3|sqlite|node:sqlite|bun:sqlite|sql\.js|@libsql\/client|@sqlite\.org\/sqlite-wasm|wa-sqlite|sqlite-wasm)(?:[/]|$)/i;
const DB_ENV_KEYS = new Set([
  "INGENIUM_CORE_DB_PATH",
  "INGENIUM_OPENCODE_DB_PATH",
  "OPENCODE_DB_PATH",
  "DATABASE_URL",
  "DATABASE_PATH",
  "DB_PATH",
]);
const DB_CALLS = new Set([
  "readFile", "readFileSync", "writeFile", "writeFileSync", "open", "openSync",
  "stat", "statSync", "lstat", "lstatSync", "access", "accessSync", "unlink",
  "unlinkSync", "rename", "renameSync", "copyFile", "copyFileSync",
  "createReadStream", "createWriteStream", "exists", "existsSync", "realpath",
  "realpathSync", "join", "resolve",
]);

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function scriptKind(file) {
  return ts.getScriptKindFromFileName(file);
}

function sourceFile(file) {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
}

function stringSpecifier(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function isProcessEnv(node) {
  return ts.isPropertyAccessExpression(node)
    && node.name.text === "env"
    && ts.isIdentifier(node.expression)
    && node.expression.text === "process";
}

function envKey(node) {
  if (ts.isPropertyAccessExpression(node)
    && isProcessEnv(node.expression)) return node.name.text;
  if (ts.isElementAccessExpression(node)
    && isProcessEnv(node.expression)) return stringSpecifier(node.argumentExpression);
  return null;
}

function databasePath(node, literalNames = new Map()) {
  let found = null;
  const visit = (child) => {
    if (found !== null) return;
    if (ts.isIdentifier(child) && literalNames.has(child.text)) {
      found = literalNames.get(child.text);
      return;
    }
    if (ts.isStringLiteralLike(child) && /\.db(?:$|[^A-Za-z0-9_])/i.test(child.text)) {
      found = child.text;
      return;
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
}

function isCoreSpecifier(specifier, importer) {
  const normalized = specifier.replaceAll("\\", "/");
  if (normalized === "ingenium-core"
    || normalized.startsWith("ingenium-core/")
    || normalized === "@ingenium/core"
    || normalized.startsWith("@ingenium/core/")
    || /(?:^|[/])packages[/]ingenium-core(?:[/]|$)/i.test(normalized)
    || /(?:^|[/])ingenium-core(?:[/]|$)/i.test(normalized)) return true;

  if (normalized.startsWith(".")) {
    const resolved = resolve(dirname(importer), normalized).replaceAll("\\", "/");
    if (/(?:^|[/])packages[/]ingenium-core(?:[/]|$)/i.test(resolved)) return true;
  }

  return /(?:^|[/])(?:core|ingenium-core)[/](?:src[/]|lib[/])?(?:tools|schema|db)(?:[/]|\.|$)/i.test(normalized);
}

function report(sourceFileValue, node, message) {
  violations.push(`${sourceFileValue.fileName}:${lineOf(sourceFileValue, node)}: ${message}`);
}

function inspect(file) {
  const absolute = resolve(root, file);
  let parsed;
  try {
    parsed = sourceFile(absolute);
  } catch (error) {
    violations.push(`${file}: unable to read or parse runtime source (${error instanceof Error ? error.message : String(error)})`);
    return;
  }

  const literalDatabaseNames = new Map();
  const collectLiteralDatabaseNames = (node) => {
    if (ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
      && ts.isStringLiteralLike(node.initializer)
      && /\.db(?:$|[^A-Za-z0-9_])/i.test(node.initializer.text)) {
      literalDatabaseNames.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, collectLiteralDatabaseNames);
  };
  collectLiteralDatabaseNames(parsed);

  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const specifier = stringSpecifier(node.moduleSpecifier);
      if (specifier !== null && (SQL_SPECIFIER.test(specifier) || SQLITE_SPECIFIER.test(specifier))) {
        report(parsed, node.moduleSpecifier, `forbidden SQL library import ${JSON.stringify(specifier)}`);
      }
      if (specifier !== null && isCoreSpecifier(specifier, absolute)) {
        report(parsed, node.moduleSpecifier, `forbidden core import ${JSON.stringify(specifier)}`);
      }
    }

    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const specifier = stringSpecifier(node.moduleSpecifier);
      if (specifier !== null && (SQL_SPECIFIER.test(specifier) || SQLITE_SPECIFIER.test(specifier))) {
        report(parsed, node.moduleSpecifier, `forbidden SQL export ${JSON.stringify(specifier)}`);
      }
      if (specifier !== null && isCoreSpecifier(specifier, absolute)) {
        report(parsed, node.moduleSpecifier, `forbidden core export ${JSON.stringify(specifier)}`);
      }
    }

    if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = stringSpecifier(node.moduleReference.expression);
      if (specifier !== null && (SQL_SPECIFIER.test(specifier) || SQLITE_SPECIFIER.test(specifier))) {
        report(parsed, node.moduleReference.expression, `forbidden SQL require ${JSON.stringify(specifier)}`);
      }
      if (specifier !== null && isCoreSpecifier(specifier, absolute)) {
        report(parsed, node.moduleReference.expression, `forbidden core require ${JSON.stringify(specifier)}`);
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const specifier = ts.isIdentifier(callee) && callee.text === "require"
        ? stringSpecifier(node.arguments[0])
        : callee.kind === ts.SyntaxKind.ImportKeyword
          ? stringSpecifier(node.arguments[0])
          : null;
      if (specifier !== null && (SQL_SPECIFIER.test(specifier) || SQLITE_SPECIFIER.test(specifier))) {
        report(parsed, node.arguments[0], `${ts.isIdentifier(callee) ? "forbidden SQL require" : "forbidden SQL dynamic import"} ${JSON.stringify(specifier)}`);
      }
      if (specifier !== null && isCoreSpecifier(specifier, absolute)) {
        report(parsed, node.arguments[0], `${ts.isIdentifier(callee) ? "forbidden core require" : "forbidden core dynamic import"} ${JSON.stringify(specifier)}`);
      }

      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : null;
      if (name && DB_CALLS.has(name)) {
        const databasePathValue = node.arguments.map((argument) => databasePath(argument, literalDatabaseNames)).find((value) => value !== null);
        if (databasePathValue !== undefined) report(parsed, node, `raw database path ${JSON.stringify(databasePathValue)} passed to ${name}()`);
      }
    }

    const key = envKey(node);
    if (key !== null && DB_ENV_KEYS.has(key)) {
      report(parsed, node, `forbidden database path environment access ${JSON.stringify(key)}`);
    }

    ts.forEachChild(node, visit);
  };
  visit(parsed);
}

for (const file of files) inspect(file);
if (violations.length > 0) {
  process.stdout.write(`${violations.join("\n")}\n`);
  process.exitCode = 1;
}
NODE
}

scan_runtime_sources() {
  scan_runtime_sources_at "$ROOT_DIR" "$@"
}

report_runtime_scan() {
  local matches
  if matches="$(scan_runtime_sources "${RUNTIME_FILES[@]}")"; then
    printf '%b✅ CLEAN: whole-file runtime import/path scan%b\n' "$GREEN" "$NC"
    return 0
  fi

  printf '%b❌ RUNTIME DB ISOLATION: forbidden import or database path access%b\n' "$RED" "$NC"
  printf '   %s\n' "$matches"
  return 1
}

check_configured_extension_plugins() {
  local scan_root="${1:-$ROOT_DIR}"
  local config_path="${2:-$scan_root/opencode.json}"
  local matches

  if matches="$(node --input-type=module - "$scan_root" "$config_path" <<'NODE'
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const args = process.argv.slice(2);
const root = resolve(args[0]);
const configPath = resolve(args[1]);
const extensionRoot = resolve(root, "packages/ingenium-extension");
const configured = [];
const modules = new Map();
const errors = [];
const violations = [];
const forbiddenAutomaticTool = /ingenium_skill_sync/i;
const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function display(file) {
  return relative(root, file).split(sep).join("/");
}

function lineOf(sourceFile, node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function isExcluded(file) {
  const name = display(file);
  return /(?:^|[/])(?:tests?|__tests__|dist|build|\.next|coverage|node_modules|vendor|artifacts)(?:[/]|$)/.test(name)
    || name.startsWith("packages/ingenium-extension/ponytail/")
    || /\.(?:test|spec)\.[^.]+$/.test(name);
}

function sourceFile(file) {
  const scriptKind = ts.getScriptKindFromFileName(file);
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, scriptKind);
}

function textName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) return node.argumentExpression.text;
  return null;
}

function stringValue(node) {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function resolveModule(file) {
  const candidates = [file];
  const extension = extname(file);
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    for (const replacement of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]) {
      candidates.push(file.slice(0, -extension.length) + replacement);
    }
  } else if (!extension) {
    for (const replacement of [".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]) candidates.push(file + replacement);
  }
  candidates.push(resolve(file, "index.ts"), resolve(file, "index.js"));
  for (const candidate of [...new Set(candidates)]) {
    try {
      const stat = require("node:fs").statSync(candidate);
      if (stat.isFile()) return resolve(candidate);
    } catch { /* unresolved optional/package import */ }
  }
  return null;
}

function relativeImport(from, specifier) {
  if (!specifier.startsWith(".")) return null;
  const candidate = resolve(dirname(from), specifier);
  const resolved = resolveModule(candidate);
  if (!resolved || !resolved.startsWith(extensionRoot + sep)) return null;
  return resolved;
}

function functionLike(node) {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node);
}

function functionName(node) {
  return node.name && ts.isIdentifier(node.name) ? node.name.text : null;
}

function propertyName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isStringLiteralLike(node)) return node.text;
  return null;
}

function addFunction(info, name, node) {
  if (name && functionLike(node)) info.functions.set(name, node);
}

function parseModule(file) {
  const parsed = sourceFile(file);
  const info = {
    file,
    parsed,
    functions: new Map(),
    exports: new Map(),
    imports: new Map(),
    starExports: [],
    entryNames: [],
    mutationOptions: new Map(),
  };

  for (const statement of parsed.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const name = functionName(statement);
      addFunction(info, name, statement);
      if (name && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) info.exports.set(name, { local: name });
      if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
        addFunction(info, "default", statement);
        info.exports.set("default", { local: name ?? "default" });
      }
    }
    if (ts.isVariableStatement(statement)) {
      const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (declaration.initializer && functionLike(declaration.initializer)) addFunction(info, declaration.name.text, declaration.initializer);
        if (exported) info.exports.set(declaration.name.text, { local: declaration.name.text });
      }
    }
    if (ts.isImportDeclaration(statement)) {
      const specifier = stringValue(statement.moduleSpecifier);
      const target = specifier ? relativeImport(file, specifier) : null;
      if (!target || !statement.importClause) continue;
      if (statement.importClause.name) info.imports.set(statement.importClause.name.text, { target, exported: "default" });
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) info.imports.set(bindings.name.text, { target, exported: "*" });
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          info.imports.set(element.name.text, { target, exported: element.propertyName?.text ?? element.name.text });
        }
      }
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) {
      const specifier = stringValue(statement.moduleSpecifier);
      const target = specifier ? relativeImport(file, specifier) : null;
      if (!target) continue;
      if (!statement.exportClause) {
        info.starExports.push(target);
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          info.exports.set(element.name.text, {
            target,
            exported: element.propertyName?.text ?? element.name.text,
          });
        }
      }
    }
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        info.exports.set(element.name.text, { local: element.propertyName?.text ?? element.name.text });
      }
    }
    if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) {
        info.entryNames.push(statement.expression.text);
        info.exports.set("default", { local: statement.expression.text });
      }
      if (functionLike(statement.expression)) {
        addFunction(info, "default", statement.expression);
        info.exports.set("default", { local: "default" });
      }
      if (ts.isObjectLiteralExpression(statement.expression)) {
        for (const property of statement.expression.properties) {
          if (!ts.isPropertyAssignment(property) || propertyName(property.name) !== "server") continue;
          if (ts.isIdentifier(property.initializer)) {
            info.entryNames.push(property.initializer.text);
          } else if (functionLike(property.initializer)) {
            const name = "__default_server__";
            addFunction(info, name, property.initializer);
            info.entryNames.push(name);
          }
        }
      }
    }
  }

  const collectOptions = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      const method = node.initializer.properties.find((property) =>
        ts.isPropertyAssignment(property) && propertyName(property.name) === "method");
      const value = method && ts.isPropertyAssignment(method) ? stringValue(method.initializer)?.toUpperCase() : null;
      if (value && mutationMethods.has(value)) info.mutationOptions.set(node.name.text, value);
    }
    ts.forEachChild(node, collectOptions);
  };
  collectOptions(parsed);
  return info;
}

function loadModule(file) {
  if (modules.has(file)) return modules.get(file);
  let info;
  try {
    info = parseModule(file);
  } catch (error) {
    errors.push(`${display(file)}: unable to read or parse configured plugin source (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
  modules.set(file, info);
  for (const binding of info.imports.values()) loadModule(binding.target);
  for (const target of info.starExports) loadModule(target);
  return info;
}

function methodInExpression(info, node) {
  if (ts.isIdentifier(node) && info.mutationOptions.has(node.text)) return info.mutationOptions.get(node.text);
  if (!ts.isObjectLiteralExpression(node)) return null;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) || propertyName(property.name) !== "method") continue;
    const value = stringValue(property.initializer)?.toUpperCase();
    if (value && mutationMethods.has(value)) return value;
    if (ts.isIdentifier(property.initializer) && info.mutationOptions.has(property.initializer.text)) return info.mutationOptions.get(property.initializer.text);
  }
  return null;
}

function callMutation(info, node) {
  const callee = node.expression;
  const name = textName(callee);
  const receiver = ts.isPropertyAccessExpression(callee) ? callee.expression.getText(info.parsed).toLowerCase() : "";

  if (name && mutationMethods.has(name.toUpperCase())
    && !/(?:headers|map|set|cache|disk|projects|entries|options|list)/i.test(receiver)
    && /(?:api|client|http|request|transport|rest|fetch)/i.test(receiver)) {
    return name.toUpperCase();
  }

  if (!name || !/(?:^fetch$|fetch|request|api)/i.test(name)) return null;
  for (const argument of node.arguments) {
    const method = methodInExpression(info, argument);
    if (method) return method;
  }
  return null;
}

function walk(node, callback, skipFunctions = false) {
  if (skipFunctions && functionLike(node)) return;
  callback(node);
  ts.forEachChild(node, (child) => walk(child, callback, skipFunctions));
}

function scanMutations(info, node) {
  walk(node, (child) => {
    if (!ts.isCallExpression(child)) return;
    const method = callMutation(info, child);
    if (!method) return;
    violations.push(`${display(info.file)}:${lineOf(info.parsed, child)}: direct REST mutation helper (${method})`);
  });
}

function scanTopLevel(info) {
  for (const statement of info.parsed.statements) walk(statement, (node) => {
    if (!ts.isCallExpression(node)) return;
    const method = callMutation(info, node);
    if (method) violations.push(`${display(info.file)}:${lineOf(info.parsed, node)}: direct REST mutation helper (${method})`);
  }, true);
}

function scanForbiddenAutomaticTool(info) {
  const node = arguments.length > 1 ? arguments[1] : info.parsed;
  const skipFunctions = arguments.length > 2 ? arguments[2] : false;
  walk(node, (child) => {
    if (ts.isStringLiteralLike(child) && forbiddenAutomaticTool.test(child.text)) {
      violations.push(`${display(info.file)}:${lineOf(info.parsed, child)}: configured automatic path references ${JSON.stringify(child.text)}`);
    }
    if (ts.isIdentifier(child) && forbiddenAutomaticTool.test(child.text)) {
      violations.push(`${display(info.file)}:${lineOf(info.parsed, child)}: configured automatic path references ${child.text}`);
    }
  }, skipFunctions);
}

function resolveExport(info, exported, seen = new Set()) {
  const key = `${info.file}\u0000${exported}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const record = info.exports.get(exported);
  if (record) {
    if (record.local) return resolveReference(info, record.local, seen);
    const target = modules.get(record.target);
    return target ? resolveExport(target, record.exported, seen) : null;
  }

  for (const targetPath of info.starExports) {
    const target = modules.get(targetPath);
    const resolved = target && resolveExport(target, exported, seen);
    if (resolved) return resolved;
  }
  return null;
}

function resolveReference(info, reference, seen = new Set()) {
  if (info.functions.has(reference)) return { info, name: reference };
  const binding = info.imports.get(reference);
  if (!binding || binding.exported === "*") return null;
  const target = modules.get(binding.target);
  return target ? resolveExport(target, binding.exported, seen) : null;
}

function enqueueReference(queue, info, reference, property) {
  const binding = info.imports.get(reference);
  if (property && binding?.exported === "*") {
    const target = modules.get(binding.target);
    const resolved = target && resolveExport(target, property);
    if (resolved) queue.push(resolved);
    return;
  }
  const resolved = resolveReference(info, reference);
  if (resolved) queue.push(resolved);
}

function reachableFunctions(entries) {
  const queue = entries.map((entry) => resolveReference(entry.info, entry.name) ?? entry);
  const seen = new Set();
  const reachable = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    const key = `${current.info.file}\u0000${current.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = current.info.functions.get(current.name);
    if (!node) continue;
    reachable.push(current);
    scanMutations(current.info, node);
    walk(node, (child) => {
      if (!ts.isIdentifier(child)) return;
      const parent = child.parent;
      if (parent && ts.isPropertyAccessExpression(parent)) {
        if (parent.name === child) return;
        if (parent.expression === child) enqueueReference(queue, current.info, child.text, parent.name.text);
        return;
      }
      enqueueReference(queue, current.info, child.text);
    });
  }
  return reachable;
}

function scanConfiguredPlugin(source) {
  const resolved = resolveModule(resolve(root, source));
  if (!resolved || !resolved.startsWith(extensionRoot + sep)) {
    errors.push(`configured plugin path is missing or outside packages/ingenium-extension: ${source}`);
    return;
  }
  if (isExcluded(resolved)) return;
  const entry = loadModule(resolved);
  if (!entry) return;

  const entries = entry.entryNames.length > 0
    ? entry.entryNames.map((name) => ({ info: entry, name }))
    : entry.exports.has("default")
      ? [{ info: entry, name: "default" }]
      : [...entry.functions.keys()].map((name) => ({ info: entry, name }));
  const reachable = reachableFunctions(entries);

  for (const info of modules.values()) {
    scanForbiddenAutomaticTool(info, info.parsed, true);
    scanTopLevel(info);
  }
  for (const { info, name } of reachable) {
    scanForbiddenAutomaticTool(info, info.functions.get(name));
  }
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, "utf8"));
} catch (error) {
  errors.push(`unable to parse opencode.json (${error instanceof Error ? error.message : String(error)})`);
}

if (config) {
  for (const entry of Array.isArray(config.plugin) ? config.plugin : []) {
    const source = typeof entry === "string" ? entry : entry && typeof entry.path === "string" ? entry.path : null;
    if (source === null) continue;
    const normalized = source.replace(/^\.\//, "").replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (!normalized.startsWith("packages/ingenium-extension/") || segments.includes("..")) continue;
    configured.push(normalized);
  }
  if (configured.length === 0) errors.push("no extension plugin source paths found in opencode.json");
  for (const source of configured) scanConfiguredPlugin(source);
}

const unique = [...new Set([...errors, ...violations])];
if (unique.length > 0) {
  process.stdout.write(`${unique.join("\n")}\n`);
  process.exitCode = 1;
}
NODE
)"; then
    printf '%b✅ CLEAN: %s configured extension plugin source path(s) and implementation closure%b\n' "$GREEN" "$(node --input-type=module -e '
      import { readFileSync } from "node:fs";
      const config = JSON.parse(readFileSync(process.argv[1], "utf8"));
      console.log((Array.isArray(config.plugin) ? config.plugin : []).filter((entry) => {
        const source = typeof entry === "string" ? entry : entry && typeof entry.path === "string" ? entry.path : "";
        return source.replace(/^\.\//, "").startsWith("packages/ingenium-extension/");
      }).length);
    ' "$config_path")" "$NC"
    return 0
  fi

  printf '%b❌ CONFIGURED PLUGIN EXECUTION PATH: mutation or forbidden automatic tool reference%b\n' "$RED" "$NC"
  printf '   %s\n' "$matches"
  return 1
}

run_negative_self_test() {
  SELF_TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ingenium-db-leaks.XXXXXX")"
  mkdir -p "$SELF_TEST_DIR/packages/ingenium-extension/plugins"

  printf '%s\n' \
    'import {' \
    '  Database,' \
    '} from "better-sqlite3";' \
    'export {' \
    '  Database as Schema,' \
    '} from "ingenium-core/lib/schema";' \
    'const sqlite = require(' \
    '  "sqlite3"' \
    ');' \
    'void import(' \
    '  "@ingenium/core/lib/tools/db"' \
    ');' \
    'process.env["DB_PATH"];' \
    'const dbFile = "fixture.db";' \
    'readFileSync(dbFile);' > "$SELF_TEST_DIR/multiline.ts"

  local import_output
  if import_output="$(scan_runtime_sources_at "$SELF_TEST_DIR" "multiline.ts")"; then
    printf '%b❌ SELF-TEST: multiline import fixture was not rejected%b\n' "$RED" "$NC"
    return 1
  fi
  for expected in 'better-sqlite3' 'ingenium-core/lib/schema' 'sqlite3' '@ingenium/core/lib/tools/db' 'DB_PATH' 'fixture.db'; do
    if [[ "$import_output" != *"$expected"* ]]; then
      printf '%b❌ SELF-TEST: missing scanner evidence for %s%b\n' "$RED" "$expected" "$NC"
      return 1
    fi
  done

  printf '%s\n' \
    'import { implementation as plugin } from "../implementation.js";' \
    'export default { id: "fixture", server: plugin };' > "$SELF_TEST_DIR/packages/ingenium-extension/plugins/fixture.ts"
  printf '%s\n' \
    'export async function implementation() {' \
    '  return fetch("/api/v1/skills", {' \
    '    method:' \
    '      "PATCH",' \
    '  });' \
    '}' > "$SELF_TEST_DIR/packages/ingenium-extension/implementation.ts"
  printf '%s\n' \
    '{' \
    '  "plugin": ["./packages/ingenium-extension/plugins/fixture.ts"]' \
    '}' > "$SELF_TEST_DIR/opencode.json"

  local plugin_output
  if plugin_output="$(check_configured_extension_plugins "$SELF_TEST_DIR" "$SELF_TEST_DIR/opencode.json")"; then
    printf '%b❌ SELF-TEST: imported plugin mutation fixture was not rejected%b\n' "$RED" "$NC"
    return 1
  fi
  if [[ "$plugin_output" != *"implementation.ts"* || "$plugin_output" != *"PATCH"* ]]; then
    printf '%b❌ SELF-TEST: imported plugin mutation evidence was incomplete%b\n' "$RED" "$NC"
    return 1
  fi

  printf '%s\n' \
    'import { implementation as plugin } from "../clean-implementation.js";' \
    'export default { id: "clean-fixture", server: plugin };' > "$SELF_TEST_DIR/packages/ingenium-extension/plugins/clean-fixture.ts"
  printf '%s\n' \
    'export async function implementation(worktree) {' \
    '  return callMcpTool(worktree, "repository_sync", {});' \
    '}' > "$SELF_TEST_DIR/packages/ingenium-extension/clean-implementation.ts"
  printf '%s\n' \
    '{' \
    '  "plugin": ["./packages/ingenium-extension/plugins/clean-fixture.ts"]' \
    '}' > "$SELF_TEST_DIR/clean-opencode.json"

  local clean_plugin_output
  if ! clean_plugin_output="$(check_configured_extension_plugins "$SELF_TEST_DIR" "$SELF_TEST_DIR/clean-opencode.json")"; then
    printf '%b❌ SELF-TEST: clean MCP-call plugin fixture was rejected%b\n' "$RED" "$NC"
    printf '   %s\n' "$clean_plugin_output"
    return 1
  fi

  printf '%b✅ CLEAN: negative multiline-import/imported-plugin and clean MCP-call self-tests%b\n' "$GREEN" "$NC"
}

echo "═══════════════════════════════════════════"
echo "  DB Isolation Enforcement"
echo "═══════════════════════════════════════════"
echo "Audited roots: tracked runtime JS/TS/MJS/CJS outside packages/ingenium-core and services/ingenium-api"
echo "Excluded classification: tests, docs, generated/vendor output, and artifacts"

if ! report_runtime_scan; then EXIT_CODE=1; fi
if ! check_configured_extension_plugins "$ROOT_DIR" "$ROOT_DIR/opencode.json"; then EXIT_CODE=1; fi
if ! run_negative_self_test; then EXIT_CODE=1; fi

echo "═══════════════════════════════════════════"

if [[ "$EXIT_CODE" -ne 0 ]]; then
  echo "❌ DB isolation violations detected in non-API runtime sources."
  echo "   Allowed DB implementation layers: packages/ingenium-core and services/ingenium-api."
  echo "   Consumers must use the MCP/API boundaries; do not change source to hide this gate."
  exit "$EXIT_CODE"
fi

printf '%b✅ All DB isolation checks passed%b\n' "$GREEN" "$NC"
