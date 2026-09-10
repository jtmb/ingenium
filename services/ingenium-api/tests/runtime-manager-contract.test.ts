import type { ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildRuntimeContainerSpec,
  runtimeStorageMappingHash,
  validateWorkspaceMapping,
  type RuntimeProvisionRequest,
} from "../lib/runtime-manager-contract.js";
import { inspectManagedRuntime } from "../lib/runtime-manager-client.js";
import { respondWithRuntimeInspect } from "../scripts/runtime-manager.js";

let root = "";
const originalManagerUrl = process.env.INGENIUM_RUNTIME_MANAGER_URL;
const originalManagerTokenFile = process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ingenium-runtime-manager-")); });
afterEach(() => {
  vi.restoreAllMocks();
  if (originalManagerUrl === undefined) delete process.env.INGENIUM_RUNTIME_MANAGER_URL;
  else process.env.INGENIUM_RUNTIME_MANAGER_URL = originalManagerUrl;
  if (originalManagerTokenFile === undefined) delete process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE;
  else process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE = originalManagerTokenFile;
  rmSync(root, { recursive: true, force: true });
});

function fixture(id: string, hostPath: string, validationPath: string): RuntimeProvisionRequest {
  const runtimeId = id === "one" ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222";
  return {
    runtimeId,
    backendName: `ingenium-runtime-${runtimeId.replaceAll("-", "")}`,
    organizationId: id === "one" ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" : "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    projectId: id === "one" ? "cccccccc-cccc-4ccc-8ccc-cccccccccccc" : "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    projectName: `project-${id}`,
    ownerUserId: id === "one" ? "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" : "ffffffff-ffff-4fff-8fff-ffffffffffff",
    workspaceId: `workspace-${id}`,
    storagePath: hostPath,
    storageMappingHash: runtimeStorageMappingHash(`workspace-${id}`, hostPath),
    securityEpoch: 0,
    revision: 1,
    capability: `ing_${id.padEnd(12, "x")}_${"a".repeat(43)}`,
    capabilityExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    limits: { cpuMillis: 1_000, memoryBytes: 1_073_741_824, pidsLimit: 256, diskBytes: 2_147_483_648, processLimit: 128 },
  };
}

function mountInfo(hostPath: string, validationPath: string): string {
  return `100 99 0:1 ${hostPath} ${validationPath} rw,relatime - ext4 /dev/test rw`;
}

describe("AUTH-108 runtime manager contract", () => {
  it("does not commit a response before Docker inspection succeeds", async () => {
    const runtimeId = "11111111-1111-4111-8111-111111111111";
    const end = vi.fn();
    const writeHead = vi.fn(() => ({ end }));
    const response = { writeHead } as unknown as ServerResponse;

    await expect(respondWithRuntimeInspect(response, async () => {
      throw new Error("Docker unavailable");
    })).rejects.toThrow("Docker unavailable");
    expect(writeHead).not.toHaveBeenCalled();

    await respondWithRuntimeInspect(response, async () => ({
      Id: "a".repeat(64),
      Name: `/ingenium-runtime-${runtimeId.replaceAll("-", "")}`,
      Config: { Labels: {
        "com.ingenium.runtime.id": runtimeId,
        "org.opencontainers.image.revision": "b".repeat(40),
      } },
      State: { Status: "running", Health: { Status: "healthy" } },
    }));
    expect(writeHead).toHaveBeenCalledWith(200);
    expect(end).toHaveBeenCalledOnce();
    expect(JSON.parse(end.mock.calls[0]![0])).toEqual({ data: {
      backendId: "a".repeat(64),
      backendName: `ingenium-runtime-${runtimeId.replaceAll("-", "")}`,
      runtimeId,
      imageRevision: "b".repeat(40),
      state: "running",
      health: "healthy",
    } });
  });

  it.each([undefined, "b".repeat(39), "B".repeat(40)])("rejects invalid OCI image revision provenance (%s)", async (imageRevision) => {
    const runtimeId = "11111111-1111-4111-8111-111111111111";
    const writeHead = vi.fn();
    const response = { writeHead } as unknown as ServerResponse;

    await expect(respondWithRuntimeInspect(response, async () => ({
      Id: "a".repeat(64),
      Name: `/ingenium-runtime-${runtimeId.replaceAll("-", "")}`,
      Config: { Labels: {
        "com.ingenium.runtime.id": runtimeId,
        ...(imageRevision === undefined ? {} : { "org.opencontainers.image.revision": imageRevision }),
      } },
      State: { Status: "running", Health: { Status: "healthy" } },
    }))).rejects.toThrow("Runtime image provenance is invalid");
    expect(writeHead).not.toHaveBeenCalled();
  });

  it("validates the complete Runtime Manager inspect identity at the client boundary", async () => {
    const runtimeId = "11111111-1111-4111-8111-111111111111";
    const tokenPath = join(root, "manager-token");
    writeFileSync(tokenPath, "m".repeat(43), { mode: 0o600 });
    process.env.INGENIUM_RUNTIME_MANAGER_URL = "http://runtime-manager:4088/";
    process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE = tokenPath;
    const valid = {
      backendId: "a".repeat(64),
      backendName: `ingenium-runtime-${runtimeId.replaceAll("-", "")}`,
      runtimeId,
      imageRevision: "b".repeat(40),
      state: "running",
      health: "healthy",
    };
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: valid }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { ...valid, imageRevision: "invalid" } }), { status: 200 }));

    await expect(inspectManagedRuntime(runtimeId)).resolves.toEqual(valid);
    await expect(inspectManagedRuntime(runtimeId)).rejects.toThrow("Runtime manager response is invalid");
  });

  it("rejects workspace symlinks and host-to-validation mapping mismatch", () => {
    const real = join(root, "real");
    const linked = join(root, "linked");
    mkdirSync(real);
    symlinkSync(real, linked);
    expect(() => validateWorkspaceMapping({ id: "workspace", hostPath: real, validationPath: linked }, mountInfo(real, linked))).toThrow(/symbolic link/);
    expect(() => validateWorkspaceMapping({ id: "workspace", hostPath: "/host/other", validationPath: real }, mountInfo("/host/workspace", real))).toThrow(/canonical source/);
  });

  it("isolates same-basename workspaces, HOME/XDG/provider/VS Code state, mounts, processes, and ports", () => {
    const firstValidation = join(root, "first", "repository");
    const secondValidation = join(root, "second", "repository");
    mkdirSync(firstValidation, { recursive: true });
    mkdirSync(secondValidation, { recursive: true });
    const firstHost = "/srv/approved/first/repository";
    const secondHost = "/srv/approved/second/repository";
    const firstMapping = validateWorkspaceMapping({ id: "workspace-one", hostPath: firstHost, validationPath: firstValidation }, mountInfo(firstHost, firstValidation));
    const secondMapping = validateWorkspaceMapping({ id: "workspace-two", hostPath: secondHost, validationPath: secondValidation }, mountInfo(secondHost, secondValidation));
    const first = buildRuntimeContainerSpec(fixture("one", firstHost, firstValidation), firstMapping, {
      image: "ingenium-user-runtime:test",
      network: "ingenium-runtime-one",
      apiUrl: "http://ingenium-control-plane:4096/api/v1",
    });
    const second = buildRuntimeContainerSpec(fixture("two", secondHost, secondValidation), secondMapping, {
      image: "ingenium-user-runtime:test",
      network: "ingenium-runtime-two",
      apiUrl: "http://ingenium-control-plane:4096/api/v1",
    });

    expect(first.HostConfig.Binds).toEqual([`${firstHost}:/workspace:rw,rprivate`]);
    expect(second.HostConfig.Binds).toEqual([`${secondHost}:/workspace:rw,rprivate`]);
    expect(first.Labels["com.ingenium.runtime.owner"]).not.toBe(second.Labels["com.ingenium.runtime.owner"]);
    expect(first.Labels["com.ingenium.runtime.workspace"]).not.toBe(second.Labels["com.ingenium.runtime.workspace"]);
    expect(first.Labels["com.ingenium.runtime.revision"]).toBe("1");
    expect(first.HostConfig.NetworkMode).not.toBe(second.HostConfig.NetworkMode);
    expect(first.HostConfig.Tmpfs["/home/appuser"]).toContain("mode=0700");
    expect(first.HostConfig.Tmpfs["/home/appuser/.tmp"]).toContain("rw,exec,nosuid,nodev");
    expect(first.HostConfig.Tmpfs["/tmp"]).toContain("noexec");
    expect(first.HostConfig.Tmpfs["/run/ingenium-runtime"]).toContain("noexec");
    expect(first.HostConfig).toMatchObject({
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges:true"],
      PublishAllPorts: false,
      PortBindings: {},
      PidsLimit: 128,
      Memory: 1_073_741_824,
      NanoCpus: 1_000_000_000,
    });
    expect(first).toMatchObject({ OpenStdin: true, StdinOnce: true });
    expect(first.Env).toEqual(expect.arrayContaining([
      "HOME=/home/appuser",
      "XDG_CONFIG_HOME=/home/appuser/.config",
      "XDG_DATA_HOME=/home/appuser/.local/share",
      "TMPDIR=/home/appuser/.tmp",
      "INGENIUM_WORKTREE=/workspace",
      `INGENIUM_STORAGE_MAPPING_HASH=${runtimeStorageMappingHash("workspace-one", firstHost)}`,
      "INGENIUM_MCP_CREDENTIAL_FILE=/run/ingenium-runtime/capability",
    ]));
    expect(first.Env.join("\n")).not.toMatch(/INGENIUM_API_TOKEN|VAULT|BACKUP|AUTH_ENCRYPTION|OPENCODE_SERVER_PASSWORD|DOCKER/);
    expect(first).not.toHaveProperty("ExposedPorts");
    expect(first.HostConfig.Binds.join("\n")).not.toContain("docker.sock");
  });
});
