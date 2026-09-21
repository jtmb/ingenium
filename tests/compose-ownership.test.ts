import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  inspectComposeOwnership,
  type DockerReadOnlyRunner,
} from "./compose-ownership";

const repoRoot = resolve(import.meta.dirname, "..");
const containerId = "a".repeat(64);
const replacementContainerId = "b".repeat(64);
const revision = "e5e76703f6daf45b972e41894cfc9f33ff3961d5";

function healthyContainer(
  overrides: Record<string, unknown> = {},
  service: "ingenium" | "control-plane" = "ingenium",
): Record<string, unknown> {
  const labels = {
    "com.docker.compose.project": "ingenium",
    "com.docker.compose.service": service,
    "com.docker.compose.project.working_dir": repoRoot,
    "com.docker.compose.project.config_files": `${repoRoot}/docker-compose.yml`,
    "org.opencontainers.image.revision": revision,
  };
  return {
    Id: containerId,
    State: { Running: true, Health: { Status: "healthy" } },
    Config: { Labels: labels },
    NetworkSettings: {
      Ports: {
        "3000/tcp": [
          { HostIp: "0.0.0.0", HostPort: "3000" },
          { HostIp: "::", HostPort: "3000" },
        ],
        "4097/tcp": [{ HostIp: "127.0.0.1", HostPort: "4097" }],
        "1455/tcp": [{ HostIp: "127.0.0.1", HostPort: "1455" }],
      },
    },
    ...overrides,
  };
}

function runner(responses: Array<string | Error>): DockerReadOnlyRunner {
  return () => {
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected Docker call");
    if (next instanceof Error) throw next;
    return next;
  };
}

function inspection(container: Record<string, unknown>): string {
  return JSON.stringify([container]);
}

function containerWithWrongLabel(): Record<string, unknown> {
  const base = healthyContainer();
  const labels = (base.Config as { Labels: Record<string, string> }).Labels;
  return healthyContainer({
    Config: { Labels: { ...labels, "com.docker.compose.service": "rogue" } },
  });
}

function containerWithWrongMapping(): Record<string, unknown> {
  const base = healthyContainer();
  const ports = (base.NetworkSettings as { Ports: Record<string, unknown> }).Ports;
  return healthyContainer({
    NetworkSettings: {
      Ports: { ...ports, "4097/tcp": [{ HostIp: "0.0.0.0", HostPort: "4097" }] },
    },
  });
}

describe("Compose ownership inspection", () => {
  it("accepts one healthy, stable Compose container with exact labels, mappings, and optional OCI revision", () => {
    const report = inspectComposeOwnership({
      repoRoot,
      expectedOciRevision: revision,
      docker: runner([`${containerId.slice(0, 12)}\n`, inspection(healthyContainer()), inspection(healthyContainer())]),
    });

    expect(report).toMatchObject({
      classification: "compose-owned",
      containerId,
      ociRevision: revision,
      hostPorts: [3000, 4097, 1455],
    });
  });

  it("accepts the isolated production control plane when the compatibility service is absent", () => {
    const controlPlane = healthyContainer({}, "control-plane");
    const report = inspectComposeOwnership({
      repoRoot,
      expectedOciRevision: revision,
      docker: runner(["", `${containerId.slice(0, 12)}\n`, inspection(controlPlane), inspection(controlPlane)]),
    });

    expect(report).toMatchObject({
      classification: "compose-owned",
      containerId,
      ociRevision: revision,
      hostPorts: [3000, 4097, 1455],
    });
  });

  it("accepts an absolute operator override after the canonical repository config", () => {
    const base = healthyContainer({}, "control-plane");
    const labels = (base.Config as { Labels: Record<string, string> }).Labels;
    const container = healthyContainer({
      Config: {
        Labels: {
          ...labels,
          "com.docker.compose.project.config_files": `${repoRoot}/docker-compose.yml,/operator/compose.override.yml`,
        },
      },
    }, "control-plane");
    const report = inspectComposeOwnership({
      repoRoot,
      docker: runner(["", `${containerId.slice(0, 12)}\n`, inspection(container), inspection(container)]),
    });

    expect(report).toMatchObject({ classification: "compose-owned", containerId });
  });

  it("rejects a config list that does not start with this repository's canonical config", () => {
    const base = healthyContainer();
    const labels = (base.Config as { Labels: Record<string, string> }).Labels;
    const container = healthyContainer({
      Config: {
        Labels: {
          ...labels,
          "com.docker.compose.project.config_files": `/operator/compose.override.yml,${repoRoot}/docker-compose.yml`,
        },
      },
    });
    const report = inspectComposeOwnership({
      repoRoot,
      docker: runner([`${containerId.slice(0, 12)}\n`, inspection(container)]),
    });

    expect(report).toMatchObject({ classification: "unverified" });
  });

  it("does not treat multiple same-port candidates as Compose ownership", () => {
    const report = inspectComposeOwnership({
      repoRoot,
      docker: runner([`${containerId.slice(0, 12)}\n${replacementContainerId.slice(0, 12)}\n`]),
    });

    expect(report).toMatchObject({ classification: "unverified" });
    expect(report.reason).toMatch(/exactly one/i);
  });

  it("fails closed when a container is replaced between inspection passes", () => {
    const replacement = healthyContainer({ Id: replacementContainerId });
    const report = inspectComposeOwnership({
      repoRoot,
      docker: runner([`${containerId.slice(0, 12)}\n`, inspection(healthyContainer()), inspection(replacement)]),
    });

    expect(report).toMatchObject({ classification: "unverified" });
    expect(report.reason).toMatch(/canonical container ID|changed/i);
  });

  it.each([
    ["wrong Compose labels", containerWithWrongLabel()],
    ["wrong host mapping", containerWithWrongMapping()],
    ["unhealthy container", healthyContainer({ State: { Running: true, Health: { Status: "unhealthy" } } })],
  ])("rejects %s", (_name, container) => {
    const report = inspectComposeOwnership({
      repoRoot,
      docker: runner([`${containerId.slice(0, 12)}\n`, inspection(container as Record<string, unknown>)]),
    });

    expect(report).toMatchObject({ classification: "unverified" });
  });

  it("reports unavailable Docker without assuming a host listener is owned", () => {
    const report = inspectComposeOwnership({
      repoRoot,
      docker: runner([new Error("spawn docker ENOENT")]),
    });

    expect(report).toMatchObject({ classification: "unverified" });
    expect(report.reason).toMatch(/unavailable/i);
  });
});
