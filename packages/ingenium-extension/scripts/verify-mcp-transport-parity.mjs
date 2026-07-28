import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TRANSPORT_REGISTRATION_PATTERN = /server\.registerTool\(\s*"([^"]+)"\s*,/g;
const CATALOG_NAME_PATTERN = /\bname:\s*"([^"]+)"/g;
const SESSION_IMPORT_TRANSPORT_NAME = "context_opencode_session_import";
const SESSION_IMPORT_CATALOG_NAME = `ingenium_${SESSION_IMPORT_TRANSPORT_NAME}`;
const CURRENT_SESSION_IMPORT_NAME = "ingenium_context_import_current_session";
const OPTIONAL_LIMIT_SCHEMA_PATTERN = /limit:\s*z\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)\.optional\(\)/;
const CURRENT_SESSION_SCHEMA_PATTERNS = [
  /title:\s*tool\.schema\.string\(\)\.trim\(\)\.min\(1\)\.max\(CONTEXT_IMPORT_TITLE_MAX_CHARS\)\.optional\(\)/,
  /maxSourceEnvelopes:\s*tool\.schema\.number\(\)\.int\(\)\.min\(1\)\.max\(CONTEXT_IMPORT_MAX_SOURCE_ENVELOPES\)\.optional\(\)/,
];

function readRequiredFile(path) {
  if (!existsSync(path)) {
    throw new Error(`MCP transport parity artifact is missing: ${path}`);
  }
  return readFileSync(path, "utf8");
}

function extractNames(source, pattern, label) {
  const names = [...source.matchAll(pattern)].map((match) => match[1]);
  if (names.length === 0) throw new Error(`No ${label} were found`);
  if (new Set(names).size !== names.length) {
    throw new Error(`Duplicate ${label} were found`);
  }
  return names;
}

function describeDifference(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((name) => !actualSet.has(name));
  const extra = actual.filter((name) => !expectedSet.has(name));
  return [
    ...(missing.length > 0 ? [`missing: ${missing.join(", ")}`] : []),
    ...(extra.length > 0 ? [`extra: ${extra.join(", ")}`] : []),
  ].join("; ");
}

function assertMatches(pattern, source, label) {
  if (!pattern.test(source)) throw new Error(`Expected ${label} was not found`);
}

export function getMcpTransportParityPaths(repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")) {
  const extensionRoot = join(repositoryRoot, "packages", "ingenium-extension");
  const serverRoot = join(repositoryRoot, "services", "ingenium-server");
  return {
    catalogSource: join(repositoryRoot, "packages", "ingenium-core", "lib", "tools", "mcp-tool-catalog.ts"),
    currentSessionImportArtifact: join(extensionRoot, "dist", "context-import.js"),
    currentSessionImportSource: join(extensionRoot, "context-import.ts"),
    packagedContextTool: join(extensionRoot, "dist", "lib", "tools", "context.js"),
    packagedTransport: join(extensionRoot, "dist", "scripts", "mcp-transport.js"),
    serverContextTool: join(serverRoot, "lib", "tools", "context.ts"),
    serverTransport: join(serverRoot, "scripts", "mcp-server.ts"),
  };
}

/**
 * Verify the artifact actually launched by the extension. This runs after the
 * extension build so a stale copied transport cannot silently omit a server
 * registration that remains present in source and the canonical catalog.
 */
export function assertMcpTransportParity(repositoryRoot) {
  const paths = getMcpTransportParityPaths(repositoryRoot);
  const serverTransport = readRequiredFile(paths.serverTransport);
  const packagedTransport = readRequiredFile(paths.packagedTransport);
  const catalogSource = readRequiredFile(paths.catalogSource);
  const serverContextTool = readRequiredFile(paths.serverContextTool);
  const packagedContextTool = readRequiredFile(paths.packagedContextTool);
  const currentSessionImportSource = readRequiredFile(paths.currentSessionImportSource);
  const currentSessionImportArtifact = readRequiredFile(paths.currentSessionImportArtifact);

  const serverToolNames = extractNames(serverTransport, TRANSPORT_REGISTRATION_PATTERN, "server transport registrations");
  const packagedToolNames = extractNames(packagedTransport, TRANSPORT_REGISTRATION_PATTERN, "packaged transport registrations");
  const transportDifference = describeDifference(serverToolNames, packagedToolNames);
  if (transportDifference) {
    throw new Error(`Packaged MCP transport registrations differ from server source (${transportDifference})`);
  }

  const catalogNames = new Set(extractNames(catalogSource, CATALOG_NAME_PATTERN, "catalog tool names"));
  const missingCatalogNames = serverToolNames
    .map((name) => `ingenium_${name}`)
    .filter((name) => !catalogNames.has(name));
  if (missingCatalogNames.length > 0) {
    throw new Error(`Server transport registrations are absent from the catalog: ${missingCatalogNames.join(", ")}`);
  }

  if (!serverToolNames.includes(SESSION_IMPORT_TRANSPORT_NAME)
    || !packagedToolNames.includes(SESSION_IMPORT_TRANSPORT_NAME)
    || !catalogNames.has(SESSION_IMPORT_CATALOG_NAME)) {
    throw new Error(`Required session-import registration is absent: ${SESSION_IMPORT_CATALOG_NAME}`);
  }
  assertMatches(OPTIONAL_LIMIT_SCHEMA_PATTERN, serverContextTool, "optional bounded session-import limit in server source");
  assertMatches(OPTIONAL_LIMIT_SCHEMA_PATTERN, packagedContextTool, "optional bounded session-import limit in packaged artifact");

  for (const source of [currentSessionImportSource, currentSessionImportArtifact]) {
    if (!source.includes(CURRENT_SESSION_IMPORT_NAME)) {
      throw new Error(`Required extension-native tool is absent: ${CURRENT_SESSION_IMPORT_NAME}`);
    }
    for (const pattern of CURRENT_SESSION_SCHEMA_PATTERNS) {
      assertMatches(pattern, source, `expected ${CURRENT_SESSION_IMPORT_NAME} schema`);
    }
  }
  if (!catalogNames.has(CURRENT_SESSION_IMPORT_NAME)) {
    throw new Error(`Required extension-native catalog registration is absent: ${CURRENT_SESSION_IMPORT_NAME}`);
  }

  return {
    serverToolCount: serverToolNames.length,
    packagedToolCount: packagedToolNames.length,
    sessionImportTransportName: SESSION_IMPORT_TRANSPORT_NAME,
    sessionImportCatalogName: SESSION_IMPORT_CATALOG_NAME,
    currentSessionImportName: CURRENT_SESSION_IMPORT_NAME,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = assertMcpTransportParity();
    console.log(`MCP transport parity verified: ${result.packagedToolCount} registrations, ${result.sessionImportCatalogName}, ${result.currentSessionImportName}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "MCP transport parity verification failed");
    process.exitCode = 1;
  }
}
