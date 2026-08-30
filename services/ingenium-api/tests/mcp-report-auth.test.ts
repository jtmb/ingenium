import { afterEach, describe, expect, it, vi } from "vitest";
import { constants } from "node:fs";

const fileState = vi.hoisted(() => ({
  descriptor: 91,
  openedPath: "",
  openedFlags: 0,
  openedMode: 0,
  contents: "",
  directoryEntries: [] as string[],
  unlinked: [] as string[],
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    lstatSync(path: string) {
      if (path === "/run/ingenium-secrets/api") return {
        isDirectory: () => true,
        isSymbolicLink: () => false,
        mode: 0o40700,
        uid: process.getuid?.() ?? 0,
      } as ReturnType<typeof actual.lstatSync>;
      if (path.startsWith("/run/ingenium-secrets/api/mcp-report-")) return {
        isFile: () => true,
        isSymbolicLink: () => false,
        mode: 0o100600,
        uid: process.getuid?.() ?? 0,
      } as ReturnType<typeof actual.lstatSync>;
      return actual.lstatSync(path);
    },
    readdirSync(path: string) {
      if (path === "/run/ingenium-secrets/api") return fileState.directoryEntries;
      return actual.readdirSync(path);
    },
    openSync(path: string, flags: number, mode: number) {
      fileState.openedPath = path;
      fileState.openedFlags = flags;
      fileState.openedMode = mode;
      return fileState.descriptor;
    },
    writeFileSync(descriptor: number, contents: string) {
      if (descriptor === fileState.descriptor) fileState.contents = contents;
      else actual.writeFileSync(descriptor, contents);
    },
    fstatSync(descriptor: number) {
      if (descriptor === fileState.descriptor) return {
        isFile: () => true,
        mode: 0o100600,
        uid: process.getuid?.() ?? 0,
      } as ReturnType<typeof actual.fstatSync>;
      return actual.fstatSync(descriptor);
    },
    closeSync(descriptor: number) {
      if (descriptor !== fileState.descriptor) actual.closeSync(descriptor);
    },
    unlinkSync(path: string) {
      fileState.unlinked.push(path);
    },
  };
});

import {
  disposeMcpReportCredential,
  issueMcpReportCredential,
  resolveMcpReportCredential,
} from "../lib/mcp-report-auth.js";

const binding = {
  project: "report-project",
  projectId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  launcherWorktree: "/app" as const,
  toolNames: ["ingenium_health_check", "ingenium_project_list"],
};

afterEach(() => {
  fileState.openedPath = "";
  fileState.openedFlags = 0;
  fileState.openedMode = 0;
  fileState.contents = "";
  fileState.directoryEntries = [];
  fileState.unlinked = [];
});

describe("API-owned MCP report credentials", () => {
  it("writes an owner-only file and resolves only its exact report binding", () => {
    const issued = issueMcpReportCredential(binding);
    const token = fileState.contents.replace(/\n$/, "");

    expect(fileState.openedPath).toMatch(/^\/run\/ingenium-secrets\/api\/mcp-report-[0-9a-f-]{36}$/);
    expect(fileState.openedFlags).toBe(constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW);
    expect(fileState.openedMode).toBe(0o600);
    expect(resolveMcpReportCredential(token, {
      project: binding.project,
      projectId: binding.projectId,
      workspaceId: binding.workspaceId,
      launcherWorktree: binding.launcherWorktree,
    })).toMatchObject({ id: issued.id, toolNames: binding.toolNames });
    expect(resolveMcpReportCredential(token, {
      project: "other-project",
      projectId: binding.projectId,
      workspaceId: binding.workspaceId,
      launcherWorktree: binding.launcherWorktree,
    })).toBeUndefined();

    disposeMcpReportCredential(issued.id);
    expect(fileState.unlinked).toEqual([issued.tokenFile]);
    expect(resolveMcpReportCredential(token, {
      project: binding.project,
      projectId: binding.projectId,
      workspaceId: binding.workspaceId,
      launcherWorktree: binding.launcherWorktree,
    })).toBeUndefined();
  });

  it("rejects unbounded or malformed report authority before creating a file", () => {
    expect(() => issueMcpReportCredential({ ...binding, toolNames: ["unsafe/tool"] })).toThrow("Invalid MCP report credential binding");
    expect(fileState.openedPath).toBe("");
  });

  it("removes only safe stale report files before issuing a replacement", () => {
    const stale = "mcp-report-33333333-3333-4333-8333-333333333333";
    fileState.directoryEntries = [stale, "installation-api-token"];

    const issued = issueMcpReportCredential(binding);

    expect(fileState.unlinked).toEqual([`/run/ingenium-secrets/api/${stale}`]);
    disposeMcpReportCredential(issued.id);
  });
});
