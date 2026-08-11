import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SERVER_SOURCE_PATH = fileURLToPath(new URL("../scripts/mcp-server.ts", import.meta.url));
const CATALOG_SOURCE_PATH = fileURLToPath(new URL("../../../packages/ingenium-core/lib/tools/mcp-tool-catalog.ts", import.meta.url));
const EXTENSION_TOOL_NAMES = new Set(["auto_observe_now", "synthesize_observations"]);

interface SourceRegistration {
  name: string;
}

interface RegistrationComparison {
  actualCanonicalNames: string[];
  expectedCanonicalNames: string[];
  invalidTransportNames: string[];
  duplicateTransportNames: string[];
  duplicateCanonicalNames: string[];
  projectionViolations: string[];
  staleCanonicalNames: string[];
  missingCanonicalNames: string[];
}

function isServerRegisterTool(node: ts.Node): node is ts.PropertyAccessExpression {
  return ts.isPropertyAccessExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === "server"
    && node.name.text === "registerTool";
}

function isOriginalRegisterRestoration(node: ts.Node): node is ts.BinaryExpression {
  return ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && isServerRegisterTool(node.left)
    && ts.isIdentifier(node.right)
    && node.right.text === "originalRegisterTool";
}

function collectServerToolRegistrations(source: string): SourceRegistration[] {
  const sourceFile = ts.createSourceFile(
    "mcp-server.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let restorationPosition: number | undefined;
  const calls: ts.CallExpression[] = [];

  const findRestoration = (node: ts.Node): void => {
    if (isOriginalRegisterRestoration(node)) {
      restorationPosition = Math.min(restorationPosition ?? node.getStart(sourceFile), node.getStart(sourceFile));
    }
    ts.forEachChild(node, findRestoration);
  };
  ts.forEachChild(sourceFile, findRestoration);

  if (restorationPosition === undefined) {
    throw new Error("mcp-server.ts must restore originalRegisterTool before dynamic child registrations");
  }

  const collectCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isServerRegisterTool(node.expression) && node.getStart(sourceFile) < restorationPosition!) {
      calls.push(node);
    }
    ts.forEachChild(node, collectCalls);
  };
  ts.forEachChild(sourceFile, collectCalls);

  return calls
    .sort((left, right) => left.getStart(sourceFile) - right.getStart(sourceFile))
    .map((call) => {
      const firstArgument = call.arguments[0];
      if (!firstArgument || !ts.isStringLiteralLike(firstArgument)) {
        const line = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile)).line + 1;
        throw new Error(`server.registerTool at line ${line} requires a string literal name`);
      }
      return { name: firstArgument.text };
    });
}

function duplicateNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  return [...duplicates];
}

function isLowercaseLetter(character: string): boolean {
  return character >= "a" && character <= "z";
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isValidTransportName(name: string): boolean {
  if (!name || name.startsWith("ingenium_") || !isLowercaseLetter(name[0]!)) return false;

  let previousUnderscore = false;
  for (const character of name) {
    if (character === "_") {
      if (previousUnderscore) return false;
      previousUnderscore = true;
      continue;
    }
    if (!isLowercaseLetter(character) && !isDigit(character)) return false;
    previousUnderscore = false;
  }
  return !previousUnderscore;
}

function compareRegistrations(
  registrations: readonly SourceRegistration[] | readonly string[],
  catalogNames: readonly string[],
): RegistrationComparison {
  const transportNames = registrations.map((registration) => typeof registration === "string" ? registration : registration.name);
  const actualCanonicalNames = transportNames.map((name) => `ingenium_${name}`);
  const expectedCanonicalNames = catalogNames.filter((name) => !EXTENSION_TOOL_NAMES.has(name));
  const expectedSet = new Set(expectedCanonicalNames);
  const catalogEntryCount = new Map<string, number>();
  for (const name of catalogNames) {
    catalogEntryCount.set(name, (catalogEntryCount.get(name) ?? 0) + 1);
  }

  return {
    actualCanonicalNames,
    expectedCanonicalNames,
    invalidTransportNames: transportNames.filter((name) => !isValidTransportName(name)),
    duplicateTransportNames: duplicateNames(transportNames),
    duplicateCanonicalNames: duplicateNames(actualCanonicalNames),
    projectionViolations: [...new Set(actualCanonicalNames.filter((name) => catalogEntryCount.get(name) !== 1))],
    staleCanonicalNames: [...new Set(actualCanonicalNames.filter((name) => !expectedSet.has(name)))],
    missingCanonicalNames: expectedCanonicalNames.filter((name) => !actualCanonicalNames.includes(name)),
  };
}

function assertCurrentRegistrationConformance(): RegistrationComparison {
  const registrations = collectServerToolRegistrations(readFileSync(SERVER_SOURCE_PATH, "utf8"));
  const catalogNames = Array.from(
    readFileSync(CATALOG_SOURCE_PATH, "utf8").matchAll(/\bname:\s*"([^"]+)"/g),
    (match) => match[1]!,
  );
  const comparison = compareRegistrations(registrations, catalogNames);
  const catalogDuplicates = duplicateNames(catalogNames);
  const catalogNonIngeniumNames = catalogNames.filter((name) => !name.startsWith("ingenium_"));

  expect(catalogDuplicates, "the canonical catalog must have unique names").toEqual([]);
  expect([...new Set(catalogNonIngeniumNames)].sort(), "only the approved extension tools may lack the canonical prefix")
    .toEqual([...EXTENSION_TOOL_NAMES].sort());
  expect(catalogNonIngeniumNames, "each approved extension tool must occur exactly once in the catalog")
    .toHaveLength(EXTENSION_TOOL_NAMES.size);
  expect(comparison.invalidTransportNames, "transport names must be lowercase, snake-case, and unprefixed").toEqual([]);
  expect(comparison.duplicateTransportNames, "transport registrations must be unique").toEqual([]);
  expect(comparison.duplicateCanonicalNames, "transport names must have exactly one canonical projection each").toEqual([]);
  expect(comparison.projectionViolations, "every transport name must project to one canonical catalog entry").toEqual([]);
  expect(comparison.staleCanonicalNames, "the server must not register stale catalog names").toEqual([]);
  expect(comparison.missingCanonicalNames, "the server must register every current catalog name").toEqual([]);
  expect(comparison.actualCanonicalNames).toHaveLength(comparison.expectedCanonicalNames.length);

  return comparison;
}

describe("MCP server registration conformance", () => {
  it("matches the current canonical core catalog without a historical count", () => {
    const comparison = assertCurrentRegistrationConformance();

    expect(new Set(comparison.actualCanonicalNames)).toEqual(new Set(comparison.expectedCanonicalNames));
  });

  it("requires a literal registration name and ignores calls after restoration", () => {
    const restoredSource = `
      server.registerTool("fixture_before", {}, handler);
      server.registerTool = originalRegisterTool;
      server.registerTool("child_only", {}, handler);
    `;
    const malformedSource = `
      server.registerTool(dynamicName, {}, handler);
      server.registerTool = originalRegisterTool;
    `;

    expect(collectServerToolRegistrations(restoredSource).map((registration) => registration.name))
      .toEqual(["fixture_before"]);
    expect(() => collectServerToolRegistrations(malformedSource)).toThrow("requires a string literal name");
  });

  it("detects duplicate transport and canonical projections in a deterministic fixture", () => {
    const source = `
      server.registerTool("fixture_probe", {}, handler);
      server.registerTool("fixture_probe", {}, handler);
      server.registerTool = originalRegisterTool;
    `;
    const comparison = compareRegistrations(collectServerToolRegistrations(source), ["ingenium_fixture_probe"]);

    expect(comparison.duplicateTransportNames).toEqual(["fixture_probe"]);
    expect(comparison.duplicateCanonicalNames).toEqual(["ingenium_fixture_probe"]);
  });

  it("detects stale and missing projections in a deterministic fixture", () => {
    const source = `
      server.registerTool("stale_probe", {}, handler);
      server.registerTool = originalRegisterTool;
    `;
    const comparison = compareRegistrations(collectServerToolRegistrations(source), ["ingenium_current_probe"]);

    expect(comparison.staleCanonicalNames).toEqual(["ingenium_stale_probe"]);
    expect(comparison.missingCanonicalNames).toEqual(["ingenium_current_probe"]);
  });
});
