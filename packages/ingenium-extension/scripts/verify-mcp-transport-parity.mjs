import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TRANSPORT_REGISTRATION_PATTERN = /server\.registerTool\(\s*"([^"]+)"\s*,/g;
const CATALOG_NAME_PATTERN = /\bname:\s*"([^"]+)"/g;

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

export function getMcpTransportParityPaths(repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")) {
  const extensionRoot = join(repositoryRoot, "packages", "ingenium-extension");
  const serverRoot = join(repositoryRoot, "services", "ingenium-server");
  return {
    catalogSource: join(repositoryRoot, "packages", "ingenium-core", "lib", "tools", "mcp-tool-catalog.ts"),
    packagedTransport: join(extensionRoot, "dist", "scripts", "mcp-transport.js"),
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

  return {
    serverToolCount: serverToolNames.length,
    packagedToolCount: packagedToolNames.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = assertMcpTransportParity();
    console.log(`MCP transport parity verified: ${result.packagedToolCount} registrations`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "MCP transport parity verification failed");
    process.exitCode = 1;
  }
}
