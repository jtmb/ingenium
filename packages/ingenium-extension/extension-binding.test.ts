import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import {
  effectiveExtensionCredentialPurpose,
  ExtensionBindingError,
  resolveExtensionBinding,
} from "./extension-binding.js";

let worktree = "";

function token(name: string, value = "a".repeat(32), mode = 0o600): string {
  const path = join(worktree, ".opencode", name);
  writeFileSync(path, `${value}\n`, { mode });
  chmodSync(path, mode);
  return path;
}

function config(environment: Record<string, string>, extraMcp: Record<string, unknown> = {}): void {
  writeFileSync(join(worktree, "opencode.json"), JSON.stringify({
    mcp: {
      ingenium: {
        type: "local",
        enabled: true,
        command: ["node", "packages/ingenium-extension/dist/scripts/mcp-server.js"],
        environment,
      },
      ...extraMcp,
    },
  }));
}

function prepare(): void {
  worktree = mkdtempSync(join(tmpdir(), "ingenium-binding-"));
  mkdirSync(join(worktree, ".opencode"));
  for (const key of [
    "INGENIUM_API_URL", "INGENIUM_PROJECT", "INGENIUM_WORKSPACE_ID", "INGENIUM_WORKTREE",
    "INGENIUM_PROJECT_ID", "INGENIUM_RUNTIME_ID", "INGENIUM_STORAGE_MAPPING_HASH", "INGENIUM_RUNTIME_CREDENTIAL_FILE",
    "INGENIUM_MCP_CREDENTIAL", "INGENIUM_MCP_CREDENTIAL_FILE", "INGENIUM_MCP_AUDIENCE",
    "INGENIUM_MCP_CREDENTIAL_PURPOSE",
    "INGENIUM_LEARNING_CREDENTIAL_FILE", "INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE",
  ]) vi.stubEnv(key, undefined);
}

afterEach(() => {
  vi.unstubAllEnvs();
  if (worktree) rmSync(worktree, { recursive: true, force: true });
  worktree = "";
});

describe("extension binding resolution", () => {
  it("resolves a learning binding from project config when the parent has no Ingenium environment", () => {
    prepare();
    token(".ingenium-learning-credential");
    config({
      INGENIUM_API_URL: "http://127.0.0.1:4097/api/v1",
      INGENIUM_PROJECT: basename(worktree),
      INGENIUM_WORKSPACE_ID: "workspace-marker",
      INGENIUM_WORKTREE: worktree,
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_LEARNING_CREDENTIAL_FILE: ".opencode/.ingenium-learning-credential",
    });

    expect(resolveExtensionBinding(worktree, { purpose: "learning" })).toEqual({
      apiUrl: "http://127.0.0.1:4097/api/v1",
      project: basename(worktree),
      workspaceId: "workspace-marker",
      launcherWorktree: worktree,
      audience: "mcp",
      credentialFile: join(worktree, ".opencode", ".ingenium-learning-credential"),
      purpose: "learning",
    });
  });

  it("gives an explicit operation credential precedence over project config", () => {
    prepare();
    token(".ingenium-learning-credential");
    const privateDirectory = join(worktree, "private");
    mkdirSync(privateDirectory, { mode: 0o700 });
    chmodSync(privateDirectory, 0o700);
    const explicit = join(privateDirectory, ".ingenium-learning-credential");
    writeFileSync(explicit, `${"b".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(explicit, 0o600);
    config({
      INGENIUM_PROJECT: basename(worktree),
      INGENIUM_WORKSPACE_ID: "workspace-marker",
      INGENIUM_WORKTREE: worktree,
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_LEARNING_CREDENTIAL_FILE: ".opencode/.ingenium-learning-credential",
    });
    process.env.INGENIUM_LEARNING_CREDENTIAL_FILE = explicit;

    expect(resolveExtensionBinding(worktree, { purpose: "learning" }).credentialFile).toBe(explicit);
  });

  it("gives the general operation environment credential path precedence over project config", () => {
    prepare();
    token(".ingenium-mcp-credential");
    const privateDirectory = join(worktree, "private");
    mkdirSync(privateDirectory, { mode: 0o700 });
    chmodSync(privateDirectory, 0o700);
    const operationCredential = join(privateDirectory, ".ingenium-mcp-credential");
    writeFileSync(operationCredential, `${"b".repeat(32)}\n`, { mode: 0o600 });
    chmodSync(operationCredential, 0o600);
    config({
      INGENIUM_PROJECT: basename(worktree),
      INGENIUM_WORKSPACE_ID: "workspace-marker",
      INGENIUM_WORKTREE: worktree,
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
    });
    process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE = "general";
    process.env.INGENIUM_MCP_CREDENTIAL_FILE = operationCredential;

    expect(resolveExtensionBinding(worktree).credentialFile).toBe(operationCredential);
  });

  it("fails closed instead of falling back when a legacy inline credential is present", () => {
    prepare();
    token(".ingenium-mcp-credential");
    config({
      INGENIUM_PROJECT: basename(worktree),
      INGENIUM_WORKSPACE_ID: "workspace-marker",
      INGENIUM_WORKTREE: worktree,
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
    });
    process.env.INGENIUM_MCP_CREDENTIAL = "sentinel_credential_content_123456";

    expect(() => resolveExtensionBinding(worktree)).toThrow(ExtensionBindingError);
  });

  it("exposes only the canonical missing locator to the coordinator recovery boundary", () => {
    prepare();
    config({
      INGENIUM_PROJECT: basename(worktree),
      INGENIUM_WORKSPACE_ID: "workspace-marker",
      INGENIUM_WORKTREE: worktree,
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
    });

    expect(() => resolveExtensionBinding(worktree)).toThrow(ExtensionBindingError);
    expect(resolveExtensionBinding(worktree, { allowMissingCredential: true }).credentialFile)
      .toBe(join(worktree, ".opencode", ".ingenium-mcp-credential"));

    symlinkSync(join(worktree, "missing-target"), join(worktree, ".opencode", ".ingenium-mcp-credential"));
    expect(() => resolveExtensionBinding(worktree, { allowMissingCredential: true })).toThrow(ExtensionBindingError);
  });

  it("keeps learning, repository-sync, and general credentials separate", () => {
    prepare();
    token(".ingenium-learning-credential");
    token(".ingenium-repository-sync-credential");
    token(".ingenium-mcp-credential");
    config({
      INGENIUM_PROJECT: basename(worktree),
      INGENIUM_WORKSPACE_ID: "workspace-marker",
      INGENIUM_WORKTREE: worktree,
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_MCP_CREDENTIAL_FILE: ".opencode/.ingenium-mcp-credential",
      INGENIUM_LEARNING_CREDENTIAL_FILE: ".opencode/.ingenium-learning-credential",
      INGENIUM_REPOSITORY_SYNC_CREDENTIAL_FILE: ".opencode/.ingenium-repository-sync-credential",
    });

    expect(resolveExtensionBinding(worktree).credentialFile).toContain(".ingenium-mcp-credential");
    expect(resolveExtensionBinding(worktree, { purpose: "learning" }).credentialFile).toContain(".ingenium-learning-credential");
    expect(resolveExtensionBinding(worktree, { purpose: "repository-sync" })).toMatchObject({
      audience: "repository-sync",
      credentialFile: join(worktree, ".opencode", ".ingenium-repository-sync-credential"),
    });
  });

  it("uses the isolated runtime capability for every managed runtime operation", () => {
    prepare();
    process.env.INGENIUM_MCP_AUDIENCE = "runtime";

    expect(effectiveExtensionCredentialPurpose("learning")).toBe("runtime");
    expect(effectiveExtensionCredentialPurpose("repository-sync")).toBe("runtime");
    expect(effectiveExtensionCredentialPurpose("general")).toBe("runtime");
  });

  it("rejects runtime purpose selection outside the attested runtime audience", () => {
    prepare();
    process.env.INGENIUM_MCP_AUDIENCE = "mcp";

    expect(() => effectiveExtensionCredentialPurpose("runtime")).toThrow(ExtensionBindingError);
    process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE = "runtime";
    expect(() => effectiveExtensionCredentialPurpose("general")).toThrow(ExtensionBindingError);
  });

  it("rejects an incomplete managed runtime identity before reading its capability", () => {
    prepare();
    process.env.INGENIUM_MCP_AUDIENCE = "runtime";
    process.env.INGENIUM_PROJECT = basename(worktree);
    process.env.INGENIUM_WORKSPACE_ID = "workspace-marker";
    process.env.INGENIUM_WORKTREE = worktree;

    expect(() => resolveExtensionBinding(worktree)).toThrow(ExtensionBindingError);
  });

  it("fails closed for conflicting Ingenium server entries", () => {
    prepare();
    token(".ingenium-learning-credential");
    config({
      INGENIUM_PROJECT: basename(worktree), INGENIUM_WORKSPACE_ID: "workspace-marker",
      INGENIUM_MCP_AUDIENCE: "mcp", INGENIUM_LEARNING_CREDENTIAL_FILE: ".opencode/.ingenium-learning-credential",
    }, {
      duplicate: {
        type: "local",
        command: ["node", "/other/packages/ingenium-extension/dist/scripts/mcp-server.js"],
        environment: { INGENIUM_MCP_AUDIENCE: "mcp" },
      },
    });

    expect(() => resolveExtensionBinding(worktree, { purpose: "learning" })).toThrow(ExtensionBindingError);
  });

  it.each(["wrong worktree", "insecure credential", "symlinked credential"])("fails closed for %s", (scenario) => {
    prepare();
    const path = token(".ingenium-learning-credential", "a".repeat(32), scenario === "insecure credential" ? 0o640 : 0o600);
    if (scenario === "symlinked credential") {
      rmSync(path);
      const target = join(worktree, "target");
      writeFileSync(target, `${"a".repeat(32)}\n`, { mode: 0o600 });
      symlinkSync(target, path);
    }
    config({
      INGENIUM_PROJECT: basename(worktree),
      INGENIUM_WORKSPACE_ID: "workspace-marker",
      INGENIUM_WORKTREE: scenario === "wrong worktree" ? "/different/worktree" : worktree,
      INGENIUM_MCP_AUDIENCE: "mcp",
      INGENIUM_LEARNING_CREDENTIAL_FILE: ".opencode/.ingenium-learning-credential",
    });

    expect(() => resolveExtensionBinding(worktree, { purpose: "learning" })).toThrow(ExtensionBindingError);
  });
});
