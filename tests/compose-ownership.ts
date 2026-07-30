import { execFileSync } from "node:child_process";
import { basename, join } from "node:path";
import { getCanonicalRepoRoot } from "./test-run-context";

export const COMPOSE_OWNED_HOST_PORTS = [3000, 4097, 1455] as const;

export type ComposeOwnershipClassification = "compose-owned" | "unverified";

export interface ComposeOwnershipReport {
  classification: ComposeOwnershipClassification;
  hostPorts: readonly number[];
  reason?: string;
  containerId?: string;
  ociRevision?: string;
}

export type DockerReadOnlyRunner = (args: readonly string[]) => string;

export interface InspectComposeOwnershipOptions {
  /** Canonical repository root whose Compose labels must match exactly. */
  repoRoot: string;
  /** Optional image revision pin for callers that require a particular build. */
  expectedOciRevision?: string;
  /** Test seam; production uses read-only Docker CLI calls. */
  docker?: DockerReadOnlyRunner;
}

interface DockerContainer {
  Id?: unknown;
  State?: {
    Running?: unknown;
    Health?: { Status?: unknown };
  };
  Config?: { Labels?: unknown };
  NetworkSettings?: { Ports?: unknown };
}

interface PortBinding {
  HostIp: string;
  HostPort: string;
}

interface VerifiedContainer {
  id: string;
  labels: Record<string, string>;
  bindings: Record<string, PortBinding[]>;
  ociRevision?: string;
}

const EXPECTED_BINDINGS: Record<string, PortBinding[]> = {
  "3000/tcp": [
    { HostIp: "0.0.0.0", HostPort: "3000" },
    { HostIp: "::", HostPort: "3000" },
  ],
  "4097/tcp": [{ HostIp: "127.0.0.1", HostPort: "4097" }],
  "1455/tcp": [{ HostIp: "127.0.0.1", HostPort: "1455" }],
};

function defaultDockerRunner(args: readonly string[]): string {
  return execFileSync("docker", [...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .slice(0, 512);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function bindingKey(binding: PortBinding): string {
  return `${binding.HostIp}:${binding.HostPort}`;
}

function normalizedBindings(bindings: PortBinding[]): string[] {
  return bindings.map(bindingKey).sort();
}

function expectedLabels(repoRoot: string): Record<string, string> {
  return {
    "com.docker.compose.project": basename(repoRoot),
    "com.docker.compose.service": "ingenium",
    "com.docker.compose.project.working_dir": repoRoot,
    "com.docker.compose.project.config_files": join(repoRoot, "docker-compose.yml"),
  };
}

function parseInspection(output: string): DockerContainer {
  const parsed: unknown = JSON.parse(output);
  if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0])) {
    throw new Error("Docker inspect did not return exactly one container");
  }
  return parsed[0] as DockerContainer;
}

function validateBindings(value: unknown): Record<string, PortBinding[]> | undefined {
  if (!isRecord(value)) return undefined;
  const bindings: Record<string, PortBinding[]> = {};
  for (const [containerPort, rawBindings] of Object.entries(value)) {
    if (rawBindings === null) continue;
    if (!Array.isArray(rawBindings)) return undefined;
    const parsed: PortBinding[] = [];
    for (const rawBinding of rawBindings) {
      if (!isRecord(rawBinding)
        || typeof rawBinding.HostIp !== "string"
        || typeof rawBinding.HostPort !== "string") {
        return undefined;
      }
      parsed.push({ HostIp: rawBinding.HostIp, HostPort: rawBinding.HostPort });
    }
    bindings[containerPort] = parsed;
  }
  return bindings;
}

function verifyContainer(
  container: DockerContainer,
  candidateId: string,
  repoRoot: string,
  expectedRevision: string | undefined,
): { container?: VerifiedContainer; reason?: string } {
  const id = container.Id;
  if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id) || !id.startsWith(candidateId)) {
    return { reason: "Docker inspection did not return the exact canonical container ID" };
  }
  if (container.State?.Running !== true || container.State.Health?.Status !== "healthy") {
    return { reason: "Compose container is not running and healthy" };
  }
  if (!isRecord(container.Config?.Labels)
    || Object.values(container.Config.Labels).some((value) => typeof value !== "string")) {
    return { reason: "Compose container labels are not inspectable" };
  }
  const labels = container.Config.Labels as Record<string, string>;
  for (const [label, expected] of Object.entries(expectedLabels(repoRoot))) {
    if (labels[label] !== expected) {
      return { reason: `Compose container label ${label} does not match this repository` };
    }
  }
  const ociRevision = labels["org.opencontainers.image.revision"];
  if (expectedRevision !== undefined && ociRevision !== expectedRevision) {
    return { reason: "Compose container OCI revision does not match the required revision" };
  }

  const bindings = validateBindings(container.NetworkSettings?.Ports);
  if (!bindings) return { reason: "Compose container port bindings are not inspectable" };
  for (const [containerPort, expected] of Object.entries(EXPECTED_BINDINGS)) {
    const actual = bindings[containerPort];
    if (!actual || JSON.stringify(normalizedBindings(actual)) !== JSON.stringify(normalizedBindings(expected))) {
      return { reason: `Compose container does not own the exact ${containerPort} host mapping` };
    }
  }
  for (const [containerPort, actual] of Object.entries(bindings)) {
    if (!(containerPort in EXPECTED_BINDINGS) && actual.length > 0) {
      return { reason: `Compose container publishes unexpected host mapping ${containerPort}` };
    }
  }

  return { container: { id, labels, bindings, ...(ociRevision ? { ociRevision } : {}) } };
}

function stableContainer(first: VerifiedContainer, second: VerifiedContainer): boolean {
  if (first.id !== second.id || first.ociRevision !== second.ociRevision) return false;
  for (const label of Object.keys(expectedLabels(first.labels["com.docker.compose.project.working_dir"]!))) {
    if (first.labels[label] !== second.labels[label]) return false;
  }
  return Object.keys(EXPECTED_BINDINGS).every((containerPort) =>
    JSON.stringify(normalizedBindings(first.bindings[containerPort]!))
      === JSON.stringify(normalizedBindings(second.bindings[containerPort]!)));
}

function unverified(reason: string): ComposeOwnershipReport {
  return { classification: "unverified", hostPorts: COMPOSE_OWNED_HOST_PORTS, reason };
}

/**
 * Read-only proof that the repository's current Compose container owns the
 * published gateway ports. A second exact-ID inspection closes the ordinary
 * replace-between-list-and-inspect race; this helper never starts, stops, or
 * otherwise mutates Docker state.
 */
export function inspectComposeOwnership(options: InspectComposeOwnershipOptions): ComposeOwnershipReport {
  const repoRoot = getCanonicalRepoRoot(options.repoRoot);
  const docker = options.docker ?? defaultDockerRunner;
  const labels = expectedLabels(repoRoot);
  let candidates: string[];
  try {
    candidates = docker([
      "ps",
      "--filter", `label=com.docker.compose.project=${labels["com.docker.compose.project"]}`,
      "--filter", `label=com.docker.compose.service=${labels["com.docker.compose.service"]}`,
      "--format", "{{.ID}}",
    ]).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  } catch (error) {
    return unverified(`Docker ownership inspection is unavailable: ${errorMessage(error)}`);
  }

  if (candidates.length !== 1 || !/^[a-f0-9]{12,64}$/.test(candidates[0]!)) {
    return unverified("Expected exactly one inspectable Compose container for this repository");
  }
  const candidateId = candidates[0]!;
  let first: VerifiedContainer;
  try {
    const validated = verifyContainer(
      parseInspection(docker(["inspect", candidateId])),
      candidateId,
      repoRoot,
      options.expectedOciRevision,
    );
    if (!validated.container) return unverified(validated.reason!);
    first = validated.container;
  } catch (error) {
    return unverified(`Docker ownership inspection is unavailable: ${errorMessage(error)}`);
  }

  try {
    const validated = verifyContainer(
      parseInspection(docker(["inspect", first.id])),
      first.id,
      repoRoot,
      options.expectedOciRevision,
    );
    if (!validated.container) return unverified(validated.reason!);
    if (!stableContainer(first, validated.container)) {
      return unverified("Compose container changed during stable reinspection");
    }
  } catch (error) {
    return unverified(`Docker ownership reinspection is unavailable: ${errorMessage(error)}`);
  }

  return {
    classification: "compose-owned",
    hostPorts: COMPOSE_OWNED_HOST_PORTS,
    containerId: first.id,
    ...(first.ociRevision ? { ociRevision: first.ociRevision } : {}),
  };
}
