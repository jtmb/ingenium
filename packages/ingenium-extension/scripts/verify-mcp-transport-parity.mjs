import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TRANSPORT_REGISTRATION_PATTERN = /server\.registerTool\(\s*"([^"]+)"\s*,/g;
const CATALOG_NAME_PATTERN = /\bname:\s*"([^"]+)"/g;
// Current built-in registrations in services/ingenium-server/scripts/mcp-server.ts.
// Update only with an intentional server/catalog parity change.
const EXPECTED_TRANSPORT_REGISTRATION_COUNT = 277;
const CONTEXT_UPLOAD_TRANSPORT_NAME = "context_upload_file";
const CONTEXT_UPLOAD_CATALOG_NAME = `ingenium_${CONTEXT_UPLOAD_TRANSPORT_NAME}`;
const CONTEXT_UPLOAD_SCHEMA_MARKER = "contextUploadFilePathParam";
const MCP_REPORT_TRANSPORT_NAME = "mcp_report_get";
const MCP_REPORT_CATALOG_NAME = `ingenium_${MCP_REPORT_TRANSPORT_NAME}`;
const MCP_REPORT_SCHEMA_MARKER = "mcpReportFilters";

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
  for (const [label, names] of [
    ["server", serverToolNames],
    ["packaged", packagedToolNames],
  ]) {
    if (names.length !== EXPECTED_TRANSPORT_REGISTRATION_COUNT) {
      throw new Error(
        `Expected ${EXPECTED_TRANSPORT_REGISTRATION_COUNT} ${label} transport registrations, found ${names.length}`,
      );
    }
  }
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

  if (!serverToolNames.includes(CONTEXT_UPLOAD_TRANSPORT_NAME)
    || !packagedToolNames.includes(CONTEXT_UPLOAD_TRANSPORT_NAME)
    || !catalogNames.has(CONTEXT_UPLOAD_CATALOG_NAME)) {
    throw new Error(`Required context upload registration is absent: ${CONTEXT_UPLOAD_CATALOG_NAME}`);
  }
  for (const [label, source] of [
    ["server source", serverTransport],
    ["packaged transport", packagedTransport],
  ]) {
    if (!source.includes(CONTEXT_UPLOAD_SCHEMA_MARKER)) {
      throw new Error(`Required context upload schema marker is absent from ${label}: ${CONTEXT_UPLOAD_SCHEMA_MARKER}`);
    }
  }

  if (!serverToolNames.includes(MCP_REPORT_TRANSPORT_NAME)
    || !packagedToolNames.includes(MCP_REPORT_TRANSPORT_NAME)
    || !catalogNames.has(MCP_REPORT_CATALOG_NAME)) {
    throw new Error(`Required MCP report registration is absent: ${MCP_REPORT_CATALOG_NAME}`);
  }
  for (const [label, source] of [
    ["server source", serverTransport],
    ["packaged transport", packagedTransport],
  ]) {
    if (!source.includes(MCP_REPORT_SCHEMA_MARKER)) {
      throw new Error(`Required MCP report schema marker is absent from ${label}: ${MCP_REPORT_SCHEMA_MARKER}`);
    }
  }

  return {
    serverToolCount: serverToolNames.length,
    packagedToolCount: packagedToolNames.length,
    contextUploadTransportName: CONTEXT_UPLOAD_TRANSPORT_NAME,
    contextUploadCatalogName: CONTEXT_UPLOAD_CATALOG_NAME,
    contextUploadSchemaMarker: CONTEXT_UPLOAD_SCHEMA_MARKER,
    mcpReportTransportName: MCP_REPORT_TRANSPORT_NAME,
    mcpReportCatalogName: MCP_REPORT_CATALOG_NAME,
    mcpReportSchemaMarker: MCP_REPORT_SCHEMA_MARKER,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = assertMcpTransportParity();
    console.log(
      `MCP transport parity verified: ${result.packagedToolCount} registrations, `
      + `${result.contextUploadCatalogName}, schema ${result.contextUploadSchemaMarker}; `
      + `${result.mcpReportCatalogName}, schema ${result.mcpReportSchemaMarker}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : "MCP transport parity verification failed");
    process.exitCode = 1;
  }
}
