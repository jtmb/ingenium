import { readFileSync, realpathSync, lstatSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

export interface ForwardFacts {
  pid: number;
  parentPid: number;
  supervisorPid: number;
  sshPid: number;
  service: string;
  stateRoot: string;
  executable: string;
  arguments: string[];
  parentArguments: string[];
  listeningPorts: number[];
}

/** Classify a pre-existing access client, never authorize stopping it. The
 * ordinary fixture baseline still binds its PID/start/group/command hashes. */
export function qualifiesProtectedForward(facts: ForwardFacts): boolean {
  const at = facts.parentArguments.indexOf("--state-root");
  const forwards = facts.arguments.flatMap((value, index) => value === "-L" ? [facts.arguments[index + 1]] : []);
  return Number.isSafeInteger(facts.pid) && facts.pid > 1 && facts.pid === facts.sshPid
    && facts.parentPid > 1 && facts.parentPid === facts.supervisorPid && facts.service === "ingenium"
    && basename(facts.executable) === "ssh" && isAbsolute(facts.stateRoot)
    && at >= 0 && facts.parentArguments[at + 1] === facts.stateRoot
    && facts.parentArguments.some((argument) => isAbsolute(argument) && basename(argument) === "production_forward.py")
    && facts.arguments.includes("StrictHostKeyChecking=yes") && facts.arguments.includes("BatchMode=yes")
    && forwards.length === 2 && forwards.includes("127.0.0.1:3000:127.0.0.1:23000")
    && forwards.includes("127.0.0.1:1455:127.0.0.1:21456")
    && facts.listeningPorts.length === 2 && facts.listeningPorts.includes(3000) && facts.listeningPorts.includes(1455);
}

export function isDeclaredProtectedForward(pid: number, executable: string, commandLine: string, listeningPorts: number[]): boolean {
  if (basename(executable) !== "ssh") return false;
  const stateRoot = process.env.INGENIUM_TEST_PROTECTED_FORWARD_STATE_ROOT;
  if (!stateRoot || !isAbsolute(stateRoot)) return false;
  try {
    if (realpathSync(stateRoot) !== stateRoot) return false;
    const path = join(stateRoot, "status.json");
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 16_384
      || (process.getuid && metadata.uid !== process.getuid())) return false;
    const status = JSON.parse(readFileSync(path, "utf8"));
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const parentPid = Number(stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/)[1]);
    const parentArguments = readFileSync(`/proc/${parentPid}/cmdline`, "utf8").split("\0").filter(Boolean);
    return qualifiesProtectedForward({ pid, parentPid, supervisorPid: status.supervisorPid, sshPid: status.sshPid,
      service: status.service, stateRoot, executable, arguments: commandLine.split("\0").filter(Boolean), parentArguments, listeningPorts });
  } catch { return false; }
}
