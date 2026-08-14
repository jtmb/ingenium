import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildRuntimeContainerSpec,
  runtimeStorageMappingHash,
  validateWorkspaceMapping,
  type RuntimeProvisionRequest,
} from "../lib/runtime-manager-contract.js";

let root = "";

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "ingenium-runtime-manager-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

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
      "INGENIUM_WORKTREE=/workspace",
      "INGENIUM_MCP_CREDENTIAL_FILE=/run/ingenium-runtime/capability",
    ]));
    expect(first.Env.join("\n")).not.toMatch(/INGENIUM_API_TOKEN|VAULT|BACKUP|AUTH_ENCRYPTION|OPENCODE_SERVER_PASSWORD|DOCKER/);
    expect(first).not.toHaveProperty("ExposedPorts");
    expect(first.HostConfig.Binds.join("\n")).not.toContain("docker.sock");
  });
});
