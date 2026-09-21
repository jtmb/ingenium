import { describe, expect, it } from "vitest";
import { getDockerActiveProject, resolveDockerActiveProject } from "./docker-active-project";

const projects = (data: unknown[]) => ({ data });

describe("Docker active project resolution", () => {
  it("uses an explicitly configured existing active project", () => {
    expect(resolveDockerActiveProject(projects([
      { name: "external-session", is_global: false },
      { name: "global-default", is_global: true },
    ]), "external-session")).toBe("external-session");
  });

  it("uses the sole active global project when no target is configured", () => {
    expect(resolveDockerActiveProject(projects([
      { name: "global-default", is_global: true },
      { name: "archived-session", is_global: false, archived_at: "2026-08-01T00:00:00.000Z" },
    ]), undefined)).toBe("global-default");
  });

  it("rejects a configured stale project instead of navigating with it", () => {
    expect(() => resolveDockerActiveProject(projects([
      { name: "global-default", is_global: true },
    ]), "gh-llm-bootstrap")).toThrow("is not an active project");
  });

  it("rejects malformed project-list entries", () => {
    expect(() => resolveDockerActiveProject(projects([
      { name: { unsafe: "global-default" }, is_global: true },
    ]), undefined)).toThrow("invalid project at data[0]");
  });

  it("fails clearly when the active global project is ambiguous", () => {
    expect(() => resolveDockerActiveProject(projects([
      { name: "global-default", is_global: true },
      { name: "other-global", is_global: true },
    ]), undefined)).toThrow("exactly one active global project; found 2");
  });

  it("reports a project-read rate limit without retrying", async () => {
    await expect(getDockerActiveProject({
      get: async () => ({
        status: () => 429,
        headers: () => ({ "retry-after": "3" }),
        json: async () => ({ data: [] }),
      }),
    })).rejects.toThrow("Docker project read GET /api/v1/projects returned HTTP 429 (Retry-After: 3)");
  });
});
