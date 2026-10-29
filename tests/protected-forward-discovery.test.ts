import { expect, it } from "vitest";
import { qualifiesProtectedForward, type ForwardFacts } from "./protected-forward-discovery";

const fixture: ForwardFacts = {
  pid: 200, parentPid: 100, supervisorPid: 100, sshPid: 200, service: "ingenium",
  stateRoot: "/owned/production-access", executable: "/usr/bin/ssh",
  arguments: ["ssh", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "-L", "127.0.0.1:3000:127.0.0.1:23000", "-L", "127.0.0.1:1455:127.0.0.1:21456"],
  parentArguments: ["python3", "/operator/production_forward.py", "--state-root", "/owned/production-access"],
  listeningPorts: [3000, 1455],
};

it("recognizes the declared existing forward without treating arbitrary listeners as protected", () => {
  expect(qualifiesProtectedForward(fixture)).toBe(true);
  for (const patch of [
    { sshPid: 201 }, { parentPid: 101 }, { service: "other" }, { executable: "/usr/bin/node" },
    { listeningPorts: [3000] }, { listeningPorts: [3000, 1455, 4097] }, { stateRoot: "/other" },
    { arguments: fixture.arguments.filter((value) => value !== "StrictHostKeyChecking=yes") },
    { arguments: [...fixture.arguments, "-L", "127.0.0.1:4097:127.0.0.1:4097"] },
    { parentArguments: ["python3", "/operator/other.py", "--state-root", "/owned/production-access"] },
  ]) expect(qualifiesProtectedForward({ ...fixture, ...patch })).toBe(false);
});
