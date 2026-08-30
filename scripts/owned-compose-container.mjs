import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

function runDocker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error("Docker container ownership inspection is unavailable");
  }
  return result.stdout.trim();
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function repositoryIdentity(callerUrl) {
  const repositoryRoot = realpathSync(join(dirname(fileURLToPath(callerUrl)), ".."));
  return {
    repositoryRoot,
    composeFile: realpathSync(join(repositoryRoot, "docker-compose.yml")),
    project: basename(repositoryRoot),
  };
}

function hasRepositoryConfig(labels, composeFile) {
  const configFiles = labels["com.docker.compose.project.config_files"]?.split(",");
  return Boolean(
    configFiles?.length
    && configFiles[0] === composeFile
    && configFiles.every((path) => path.length > 0 && isAbsolute(path)),
  );
}

export function resolveOwnedComposeContainer(service, callerUrl) {
  const identity = repositoryIdentity(callerUrl);
  const candidates = runDocker([
    "ps",
    "--filter", `label=com.docker.compose.service=${service}`,
    "--format", "{{.ID}}",
  ]).split(/\r?\n/).filter(Boolean);

  if (candidates.length === 0) {
    throw new Error(`${service} Compose service is not running`);
  }
  if (candidates.length !== 1 || !/^[a-f0-9]{12,64}$/.test(candidates[0])) {
    throw new Error(`${service} Compose service must have exactly one inspectable running container`);
  }

  let parsed;
  try {
    parsed = JSON.parse(runDocker(["inspect", candidates[0]]));
  } catch {
    throw new Error("running Compose container inspection is not valid JSON");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0])) {
    throw new Error("Docker did not inspect exactly one Compose container");
  }

  const container = parsed[0];
  const labels = container.Config?.Labels;
  if (
    typeof container.Id !== "string"
    || !/^[a-f0-9]{64}$/.test(container.Id)
    || !container.Id.startsWith(candidates[0])
    || container.State?.Running !== true
    || !isRecord(labels)
    || Object.values(labels).some((value) => typeof value !== "string")
    || labels["com.docker.compose.project"] !== identity.project
    || labels["com.docker.compose.service"] !== service
    || labels["com.docker.compose.project.working_dir"] !== identity.repositoryRoot
    || !hasRepositoryConfig(labels, identity.composeFile)
  ) {
    throw new Error("running container is not owned by the expected repository, Compose project, and service");
  }
  if (typeof container.Image !== "string" || !container.Image.startsWith("sha256:")) {
    throw new Error("running Compose container image is not inspectable");
  }

  return { containerId: container.Id, imageId: container.Image };
}
