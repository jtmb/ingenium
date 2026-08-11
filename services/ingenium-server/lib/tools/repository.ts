import { api } from "../client.js";

const MAX_SUMMARY_COUNT = 10_000;
export const REPOSITORY_MAX_DOC_ITEMS = 256;
export const REPOSITORY_MAX_DOC_FILE_BYTES = 512 * 1024;
export const REPOSITORY_MAX_DOC_TOTAL_BYTES = 1_500 * 1024;
export const REPOSITORY_MAX_RESOURCE_ITEMS = 512;
export const REPOSITORY_MAX_RESOURCE_FILE_BYTES = 256 * 1024;
export const REPOSITORY_MAX_RESOURCE_TOTAL_BYTES = 1_500 * 1024;

type RepositorySummary = Record<string, number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function counter(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_SUMMARY_COUNT
    ? value
    : 0;
}

function summary(value: unknown, keys: readonly string[]): RepositorySummary {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(keys.map((key) => [key, counter(source[key])]));
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function hasBoundedResourceEntry(entry: unknown): boolean {
  if (!isRecord(entry)) return false;
  for (const field of ["skillMd", "body", "frontmatter", "source"] as const) {
    const value = entry[field];
    if (value !== undefined && (typeof value !== "string" || Buffer.byteLength(value, "utf8") > REPOSITORY_MAX_RESOURCE_FILE_BYTES)) {
      return false;
    }
  }
  if (entry.fileTree !== undefined) {
    if (!isRecord(entry.fileTree)) return false;
    for (const [path, content] of Object.entries(entry.fileTree)) {
      if (path.length === 0 || path.length > 512 || typeof content !== "string" || Buffer.byteLength(content, "utf8") > REPOSITORY_MAX_RESOURCE_FILE_BYTES) {
        return false;
      }
    }
  }
  for (const field of ["metadata", "permissions", "options"] as const) {
    if (entry[field] !== undefined && serializedBytes(entry[field]) > REPOSITORY_MAX_RESOURCE_FILE_BYTES) return false;
  }
  return true;
}

/** Mirrors API aggregate limits before a direct MCP caller can reach the HTTP boundary. */
function hasBoundedRepositoryManifests(docsManifest: unknown, resourcesManifest: unknown | undefined): boolean {
  try {
    if (!isRecord(docsManifest) || !Array.isArray(docsManifest.files) || docsManifest.files.length > REPOSITORY_MAX_DOC_ITEMS) {
      return false;
    }
    let docsBytes = 0;
    for (const entry of docsManifest.files) {
      if (!isRecord(entry) || typeof entry.content !== "string") return false;
      const bytes = Buffer.byteLength(entry.content, "utf8");
      if (bytes > REPOSITORY_MAX_DOC_FILE_BYTES) return false;
      docsBytes += bytes;
      if (docsBytes > REPOSITORY_MAX_DOC_TOTAL_BYTES) return false;
    }

    if (resourcesManifest === undefined) return true;
    if (!isRecord(resourcesManifest)
      || resourcesManifest.version !== 2
      || !Array.isArray(resourcesManifest.skills)
      || !Array.isArray(resourcesManifest.agents)
      || !Array.isArray(resourcesManifest.plugins)) return false;

    const entries = [...resourcesManifest.skills, ...resourcesManifest.agents, ...resourcesManifest.plugins];
    if (entries.length > REPOSITORY_MAX_RESOURCE_ITEMS) return false;
    let resourceBytes = 0;
    for (const entry of entries) {
      if (!hasBoundedResourceEntry(entry)) return false;
      const bytes = serializedBytes(entry);
      resourceBytes += bytes;
      if (resourceBytes > REPOSITORY_MAX_RESOURCE_TOTAL_BYTES) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function unavailable() {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code: "REPOSITORY_SYNC_FAILED", message: "Repository synchronization failed." } }) }],
  };
}

const DOC_SUMMARY_KEYS = ["created", "updated", "renamed", "restored", "archived", "unchanged", "ragCreated", "ragUpdated", "ragDeleted", "spaceCreated", "spaceRepaired"] as const;
const RESOURCE_SUMMARY_KEYS = ["created", "updated", "renamed", "archived", "removed", "unchanged"] as const;

/** Forward a bounded repository projection through the API without returning source content. */
export async function repositorySync(
  project: string,
  docsManifest: unknown,
  resourcesManifest: unknown | undefined,
  dryRun = false,
) {
  if (!hasBoundedRepositoryManifests(docsManifest, resourcesManifest)) return unavailable();
  try {
    const docs = await api.post("/docs/repository/sync", { manifest: docsManifest, dryRun }, { project });
    if (!isRecord(docs.data)) return unavailable();
    const response: Record<string, unknown> = {
      project,
      dryRun: docs.data.dryRun === true,
      docs: { summary: summary(docs.data.summary, DOC_SUMMARY_KEYS) },
    };
    if (resourcesManifest !== undefined) {
      const resources = await api.post("/repository/resources/sync", { manifest: resourcesManifest, dryRun }, { project });
      if (!isRecord(resources.data) || !isRecord(resources.data.summary)) return unavailable();
      response.resources = {
        summary: {
          skill: summary(resources.data.summary.skill, RESOURCE_SUMMARY_KEYS),
          agent: summary(resources.data.summary.agent, RESOURCE_SUMMARY_KEYS),
          plugin: summary(resources.data.summary.plugin, RESOURCE_SUMMARY_KEYS),
        },
      };
    }
    return { content: [{ type: "text" as const, text: JSON.stringify(response) }] };
  } catch {
    return unavailable();
  }
}
