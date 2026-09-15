import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const extensionRoot = dirname(fileURLToPath(import.meta.url));

function source(name: string): string {
  return readFileSync(join(extensionRoot, name), "utf8");
}

describe("configured extension lifecycle MCP boundary", () => {
  it("routes repository, extraction, observer, and legacy lifecycle hooks through the shared MCP bridge", () => {
    const resourceSync = source("resource-sync.ts");
    const activeResourcePlugin = resourceSync.slice(resourceSync.indexOf("export const ResourceSyncPlugin"));
    const skillsOnly = resourceSync.slice(resourceSync.indexOf("export async function skillsOnlySync"));

    expect(resourceSync).toContain('callMcpTool(worktree, "repository_sync"');
    expect(activeResourcePlugin).not.toContain("fetch(");
    expect(activeResourcePlugin).not.toContain("ensureExtensionProject");
    expect(skillsOnly).toContain("repositorySync(worktree)");
    expect(skillsOnly).not.toContain("syncSkills(worktree");
    expect(source("auto-observer.ts")).toContain('callMcpTool(worktree, "extraction_run"');
    expect(source("observer-core.ts")).toContain('callMcpTool(worktree, "pipeline_event_log"');
    expect(source("observer-core.ts")).toContain('callMcpTool(worktree, "synthesis_run"');
    expect(source("onboarding-sync.ts")).toContain("pushDiskToApi(worktree)");
    expect(source("skill-sync.ts")).toContain("skillsOnlySync(worktree)");
  });

  it("keeps direct repository REST sync out of the active source path", () => {
    const resourceSync = source("resource-sync.ts");
    const activeRepositorySync = resourceSync.slice(resourceSync.indexOf("export async function repositorySync"), resourceSync.indexOf("export async function fullSync"));

    expect(activeRepositorySync).not.toContain("/docs/repository/sync");
    expect(activeRepositorySync).not.toContain("/repository/resources/sync");
    expect(activeRepositorySync).not.toContain("fetch(");
  });
});
