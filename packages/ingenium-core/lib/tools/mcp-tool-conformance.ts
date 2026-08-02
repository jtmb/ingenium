/**
 * Pure MCP catalog conformance checks. Callers provide every boundary snapshot;
 * this module intentionally performs no I/O or runtime discovery.
 */

export const MCP_TOOL_CONFORMANCE_ISSUE_CODES = [
  "malformed-catalog-entry",
  "malformed-registration",
  "malformed-projection",
  "malformed-explicit-state",
  "malformed-expected-enabled-override",
  "duplicate-catalog",
  "duplicate-registration",
  "duplicate-projection",
  "duplicate-explicit-state",
  "missing-registration",
  "stale-registration",
  "missing-effective-catalog",
  "effective-catalog-mismatch",
  "missing-projection",
  "stale-projection",
  "category-mismatch",
  "unknown-category",
  "stale-explicit-state",
  "stale-expected-enabled-override",
  "wrong-toggle",
] as const;

export type McpToolConformanceIssueCode =
  (typeof MCP_TOOL_CONFORMANCE_ISSUE_CODES)[number];

export interface McpToolConformanceInput {
  catalog: readonly unknown[];
  canonicalRegistrations: readonly unknown[];
  effectiveProjection: readonly unknown[];
  effectiveCatalog?: readonly unknown[];
  rawExplicitStates?: readonly unknown[];
  expectedEnabledOverrides?: ReadonlyMap<unknown, unknown> | Readonly<Record<string, unknown>>;
  knownCategories?: readonly unknown[];
}

export interface McpToolConformanceIssue {
  code: McpToolConformanceIssueCode;
  message: string;
  name?: string;
}

export interface McpToolConformanceReport {
  ok: boolean;
  issues: McpToolConformanceIssue[];
}

/** A message-free input suitable for reports or other untrusted output boundaries. */
export interface McpToolConformanceEvidence {
  status: "known" | "unknown";
  issues: ReadonlyArray<{ code: McpToolConformanceIssueCode; toolName: string }>;
}

interface CatalogEntry {
  name: string;
  category: string;
  defaultEnabled: boolean;
}

interface ProjectionEntry {
  name: string;
  category: string;
  enabled: boolean;
}

interface ExplicitState {
  name: string;
  enabled: boolean;
}

type ValueRecord = Record<string, unknown>;

function isRecord(value: unknown): value is ValueRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function readCatalogEntry(value: unknown): CatalogEntry | undefined {
  if (!isRecord(value)
    || !isNonEmptyString(value.name)
    || !isNonEmptyString(value.category)
    || !isNonEmptyString(value.description)
    || (value.projectScope !== "per-project" && value.projectScope !== "global")
    || typeof value.defaultEnabled !== "boolean"
    || !Array.isArray(value.apiEndpoints)
    || !value.apiEndpoints.every(isNonEmptyString)) return undefined;

  return { name: value.name, category: value.category, defaultEnabled: value.defaultEnabled };
}

function readProjectionEntry(value: unknown): ProjectionEntry | undefined {
  if (!isRecord(value)) return undefined;
  const name = value.tool_name ?? value.name;
  if (!isNonEmptyString(name)
    || !isNonEmptyString(value.category)
    || typeof value.enabled !== "boolean") return undefined;

  return { name, category: value.category, enabled: value.enabled };
}

function readExplicitState(value: unknown): ExplicitState | undefined {
  if (!isRecord(value)
    || !isNonEmptyString(value.tool_name)
    || typeof value.enabled !== "boolean") return undefined;

  return { name: value.tool_name, enabled: value.enabled };
}

function collectCatalog(
  entries: readonly unknown[],
  label: string,
  issues: McpToolConformanceIssue[],
): Map<string, CatalogEntry> {
  const catalog = new Map<string, CatalogEntry>();
  entries.forEach((value) => {
    const entry = readCatalogEntry(value);
    if (!entry) {
      issues.push({ code: "malformed-catalog-entry", message: `${label} entry is malformed` });
      return;
    }
    if (catalog.has(entry.name)) {
      issues.push({ code: "duplicate-catalog", name: entry.name, message: `catalog duplicates '${entry.name}'` });
      return;
    }
    catalog.set(entry.name, entry);
  });
  return catalog;
}

function collectExpectedEnabledOverrides(
  overrides: McpToolConformanceInput["expectedEnabledOverrides"],
  effectiveCatalog: ReadonlyMap<string, CatalogEntry>,
  issues: McpToolConformanceIssue[],
): Map<string, boolean> {
  const values = new Map<string, boolean>();
  if (!overrides) return values;

  if (!(overrides instanceof Map) && !isRecord(overrides)) {
    issues.push({ code: "malformed-expected-enabled-override", message: "expected enabled overrides are malformed" });
    return values;
  }
  const entries = overrides instanceof Map ? Array.from(overrides.entries()) : Object.entries(overrides);

  for (const [name, enabled] of entries) {
    if (!isNonEmptyString(name) || typeof enabled !== "boolean") {
      issues.push({ code: "malformed-expected-enabled-override", message: "expected enabled override is malformed" });
      continue;
    }
    if (!effectiveCatalog.has(name)) {
      issues.push({ code: "stale-expected-enabled-override", name, message: `expected enabled override '${name}' is stale` });
      continue;
    }
    values.set(name, enabled);
  }
  return values;
}

function isExtensionOwned(name: string): boolean {
  return !name.startsWith("ingenium_");
}

function sortIssues(issues: McpToolConformanceIssue[]): McpToolConformanceIssue[] {
  return issues.sort((left, right) => (
    left.code < right.code ? -1
      : left.code > right.code ? 1
        : (left.name ?? "") < (right.name ?? "") ? -1
          : (left.name ?? "") > (right.name ?? "") ? 1
            : left.message < right.message ? -1
              : left.message > right.message ? 1 : 0
  ));
}

/**
 * Converts a diagnostic conformance result to a bounded, message-free form.
 * Unattributed failures make the catalog unknown rather than attaching a
 * potentially misleading global failure to every tool.
 */
export function toMcpToolConformanceEvidence(
  report: McpToolConformanceReport,
): McpToolConformanceEvidence {
  if (report.issues.some((issue) => !isNonEmptyString(issue.name))) {
    return { status: "unknown", issues: [] };
  }
  return {
    status: "known",
    issues: report.issues.map((issue) => ({ code: issue.code, toolName: issue.name! })),
  };
}

/**
 * Pure fixture validator for MCP catalog, registration, projection, and toggle parity.
 * The optional effective catalog is a complete projection: static catalog entries must
 * remain present, while discovered child MCP tools may be appended in any order.
 */
export function buildMcpToolConformanceReport(input: McpToolConformanceInput): McpToolConformanceReport {
  const issues: McpToolConformanceIssue[] = [];
  const catalog = collectCatalog(input.catalog, "catalog", issues);
  const suppliedEffectiveCatalog = input.effectiveCatalog === undefined
    ? undefined
    : collectCatalog(input.effectiveCatalog, "effective catalog", issues);
  const effectiveCatalog = new Map(catalog);

  if (suppliedEffectiveCatalog) {
    for (const [name, entry] of catalog) {
      const supplied = suppliedEffectiveCatalog.get(name);
      if (!supplied) {
        issues.push({ code: "missing-effective-catalog", name, message: `catalog tool '${name}' is missing from the effective catalog` });
        continue;
      }
      if (supplied.category !== entry.category || supplied.defaultEnabled !== entry.defaultEnabled) {
        issues.push({ code: "effective-catalog-mismatch", name, message: `effective catalog entry '${name}' differs from the canonical catalog` });
      }
    }
    for (const [name, entry] of suppliedEffectiveCatalog) {
      if (!catalog.has(name)) effectiveCatalog.set(name, entry);
    }
  }

  if (input.knownCategories !== undefined) {
    const knownCategories = new Set<string>();
    for (const category of input.knownCategories) {
      if (!isNonEmptyString(category)) {
        issues.push({ code: "unknown-category", message: "known category is malformed" });
        continue;
      }
      knownCategories.add(category);
    }
    for (const entry of effectiveCatalog.values()) {
      if (!knownCategories.has(entry.category)) {
        issues.push({ code: "unknown-category", name: entry.name, message: `catalog category '${entry.category}' is unknown` });
      }
    }
  }

  const registrations = new Set<string>();
  input.canonicalRegistrations.forEach((value) => {
    if (!isNonEmptyString(value)) {
      issues.push({ code: "malformed-registration", message: "canonical registration is malformed" });
      return;
    }
    if (registrations.has(value)) {
      issues.push({ code: "duplicate-registration", name: value, message: `registration duplicates '${value}'` });
      return;
    }
    registrations.add(value);
  });
  for (const name of catalog.keys()) {
    if (!isExtensionOwned(name) && !registrations.has(name)) {
      issues.push({ code: "missing-registration", name, message: `catalog tool '${name}' is not registered` });
    }
  }
  for (const name of registrations) {
    if (!catalog.has(name)) {
      issues.push({ code: "stale-registration", name, message: `registration '${name}' is not cataloged` });
    }
  }

  const projection = new Map<string, ProjectionEntry>();
  input.effectiveProjection.forEach((value) => {
    const entry = readProjectionEntry(value);
    if (!entry) {
      issues.push({ code: "malformed-projection", message: "effective projection entry is malformed" });
      return;
    }
    if (projection.has(entry.name)) {
      issues.push({ code: "duplicate-projection", name: entry.name, message: `projection duplicates '${entry.name}'` });
      return;
    }
    projection.set(entry.name, entry);
  });

  const explicitStates = new Map<string, boolean>();
  for (const value of input.rawExplicitStates ?? []) {
    const state = readExplicitState(value);
    if (!state) {
      issues.push({ code: "malformed-explicit-state", message: "explicit state is malformed" });
      continue;
    }
    if (explicitStates.has(state.name)) {
      issues.push({ code: "duplicate-explicit-state", name: state.name, message: `explicit state duplicates '${state.name}'` });
      continue;
    }
    explicitStates.set(state.name, state.enabled);
    if (!effectiveCatalog.has(state.name)) {
      issues.push({ code: "stale-explicit-state", name: state.name, message: `explicit state '${state.name}' is stale` });
    }
  }

  const expectedEnabled = collectExpectedEnabledOverrides(input.expectedEnabledOverrides, effectiveCatalog, issues);
  for (const [name, entry] of effectiveCatalog) {
    const projected = projection.get(name);
    if (!projected) {
      issues.push({ code: "missing-projection", name, message: `effective catalog tool '${name}' is not projected` });
      continue;
    }
    if (projected.category !== entry.category) {
      issues.push({ code: "category-mismatch", name, message: `projection category for '${name}' is '${projected.category}', expected '${entry.category}'` });
    }
    const enabled = expectedEnabled.get(name) ?? explicitStates.get(name) ?? entry.defaultEnabled;
    if (projected.enabled !== enabled) {
      issues.push({ code: "wrong-toggle", name, message: `projection toggle for '${name}' is ${projected.enabled}, expected ${enabled}` });
    }
  }
  for (const name of projection.keys()) {
    if (!effectiveCatalog.has(name)) {
      issues.push({ code: "stale-projection", name, message: `projection '${name}' is not in the effective catalog` });
    }
  }

  return { ok: issues.length === 0, issues: sortIssues(issues) };
}
