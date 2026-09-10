import { createHash } from "node:crypto";
import { readdirSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
  TEST_RUN_PREEXISTING_PROCESS_BASELINE_LIMIT,
  TEST_RUN_PREEXISTING_PROCESS_PORT_LIMIT,
  readTestRunManifest,
  type TestRunContext,
  type TestRunPreexistingProcess,
  type TestRunPreexistingProcessBaseline,
  updateTestRunManifest,
} from "./test-run-context";

export interface ProcessIdentity {
  pidStartTime: string;
  pgid: number;
  executable: string;
  groupIdentity: string;
  runNonce?: string;
}

export interface ProcessStat {
  pgid: number;
  startTime: string;
  state: string;
}

export interface RepositoryProcessCandidate extends ProcessIdentity {
  pid: number;
  cwd: string;
  commandHash: string;
  executableHash: string;
  listeningPorts: number[];
}

export function readProcStat(pid: number): ProcessStat | undefined {
  if (process.platform === "win32") return undefined;
  try {
    const value = readFileSync(`/proc/${pid}/stat`, "utf8");
    const closingParen = value.lastIndexOf(")");
    if (closingParen < 0) return undefined;
    const fields = value.slice(closingParen + 1).trim().split(/\s+/);
    const state = fields[0];
    const pgid = Number(fields[2]);
    const startTime = fields[19];
    if (!state || !Number.isInteger(pgid) || pgid <= 1 || !startTime || !/^\d+$/.test(startTime)) return undefined;
    return { pgid, startTime, state };
  } catch {
    return undefined;
  }
}

function readProcessNonce(pid: number): string | undefined {
  if (process.platform === "win32") return undefined;
  try {
    const environment = readFileSync(`/proc/${pid}/environ`, "utf8");
    const entry = environment.split("\u0000").find((item) => item.startsWith("INGENIUM_TEST_RUN_NONCE="));
    return entry?.slice("INGENIUM_TEST_RUN_NONCE=".length);
  } catch {
    return undefined;
  }
}

export function inspectProcessIdentity(pid: number): ProcessIdentity | undefined {
  if (!Number.isInteger(pid) || pid <= 1) return undefined;
  const processStat = readProcStat(pid);
  if (!processStat) return undefined;
  const groupStat = readProcStat(processStat.pgid);
  if (!groupStat || groupStat.pgid !== processStat.pgid) return undefined;
  try {
    const executable = realpathSync(`/proc/${pid}/exe`);
    return {
      pidStartTime: processStat.startTime,
      pgid: processStat.pgid,
      executable,
      groupIdentity: `${processStat.pgid}:${groupStat.startTime}`,
      runNonce: readProcessNonce(pid),
    };
  } catch {
    return undefined;
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pathIsInside(parent: string, child: string): boolean {
  const fromParent = relative(resolve(parent), resolve(child));
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent));
}

function readListeningInodes(): Map<string, number[]> {
  const inodes = new Map<string, number[]>();
  if (process.platform === "win32") return inodes;
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      const lines = readFileSync(file, "utf8").trim().split("\n").slice(1);
      for (const line of lines) {
        const fields = line.trim().split(/\s+/);
        if (fields.length < 10 || fields[3] !== "0A") continue;
        const portText = fields[1]?.split(":")[1];
        const port = portText ? Number.parseInt(portText, 16) : Number.NaN;
        const inode = fields[9];
        if (!Number.isInteger(port) || port < 1 || port > 65535 || !inode || !/^\d+$/.test(inode)) continue;
        const ports = inodes.get(inode) ?? [];
        if (!ports.includes(port)) ports.push(port);
        inodes.set(inode, ports);
      }
    } catch {
      // A restricted /proc still permits nonce-bound candidate discovery.
    }
  }
  return inodes;
}

function listeningPortsForPid(pid: number, inodes: Map<string, number[]>): number[] {
  const ports = new Set<number>();
  try {
    for (const fd of readdirSync(`/proc/${pid}/fd`)) {
      let target: string;
      try {
        target = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const match = /^socket:\[(\d+)\]$/.exec(target);
      if (!match) continue;
      for (const port of inodes.get(match[1]!) ?? []) ports.add(port);
    }
  } catch {
    // The process disappeared or its fd directory is protected.
  }
  return [...ports].sort((left, right) => left - right);
}

function repositoryProcessCandidate(
  repoRoot: string,
  pid: number,
  listeningInodes: Map<string, number[]>,
): RepositoryProcessCandidate | undefined {
  if (pid <= 1 || pid === process.pid) return undefined;
  const identity = inspectProcessIdentity(pid);
  if (!identity) return undefined;
  let cwd: string;
  let commandLine: string;
  try {
    cwd = realpathSync(`/proc/${pid}/cwd`);
    commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8");
  } catch {
    return undefined;
  }
  const commandPathCandidate = commandLine
    .split("\u0000")
    .some((argument) => isAbsolute(argument) && pathIsInside(repoRoot, argument));
  if (!pathIsInside(repoRoot, cwd)
    && !pathIsInside(repoRoot, identity.executable)
    && !commandPathCandidate) {
    return undefined;
  }
  const listeningPorts = listeningPortsForPid(pid, listeningInodes);
  if (listeningPorts.length === 0 && !identity.runNonce) return undefined;
  return {
    ...identity,
    pid,
    cwd,
    commandHash: hash(commandLine),
    executableHash: hash(identity.executable),
    listeningPorts,
  };
}

export function discoverRepositoryProcessCandidates(repoRoot: string): RepositoryProcessCandidate[] {
  if (process.platform === "win32") return [];
  const listeningInodes = readListeningInodes();
  const discovered: RepositoryProcessCandidate[] = [];
  try {
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      const candidate = repositoryProcessCandidate(repoRoot, Number(entry.name), listeningInodes);
      if (candidate) discovered.push(candidate);
    }
  } catch {
    return discovered;
  }
  return discovered.sort((left, right) => left.pid - right.pid);
}

export function toPreexistingProcess(candidate: RepositoryProcessCandidate): TestRunPreexistingProcess {
  return {
    pid: candidate.pid,
    pidStartTime: candidate.pidStartTime,
    pgid: candidate.pgid,
    groupIdentity: candidate.groupIdentity,
    executableHash: candidate.executableHash,
    commandHash: candidate.commandHash,
    listeningPorts: [...candidate.listeningPorts],
  };
}

export function capturePreexistingProcessBaseline(
  context: TestRunContext,
): TestRunPreexistingProcessBaseline {
  const manifest = readTestRunManifest(context.manifestPath);
  if (manifest.status !== "created" || manifest.processes.length > 0 || manifest.preexistingProcessBaseline !== undefined) {
    throw new Error("Pre-existing process baseline must be captured before fixture startup");
  }
  const runPorts = new Set(Object.values(manifest.ports));
  const eligibleCandidates = discoverRepositoryProcessCandidates(manifest.repoRoot)
    .filter((candidate) => candidate.runNonce === undefined
      && candidate.listeningPorts.length > 0
      && candidate.listeningPorts.every((port) => !runPorts.has(port)));
  if (eligibleCandidates.some((candidate) => candidate.listeningPorts.length > TEST_RUN_PREEXISTING_PROCESS_PORT_LIMIT)
    || eligibleCandidates.length > TEST_RUN_PREEXISTING_PROCESS_BASELINE_LIMIT) {
    throw new Error("Pre-existing process baseline exceeds the bounded candidate limit");
  }
  const baseline: TestRunPreexistingProcessBaseline = {
    version: 1,
    capturedAt: new Date().toISOString(),
    candidates: eligibleCandidates.map(toPreexistingProcess),
  };
  updateTestRunManifest(context.manifestPath, { preexistingProcessBaseline: baseline });
  return baseline;
}
