import { afterEach, describe, expect, it, vi } from "vitest";
import { runManagedCommandCli } from "./scripts/managed-command-wrapper.js";

const priorExitCode = process.exitCode;
afterEach(() => { process.exitCode = priorExitCode; });

describe("retired multichat entry points", () => {
  it.each(["production-restart", "recovery-preflight", "recovery-prepare"])(
    "rejects literal and encoded %s before invoking any runner", (operation) => {
      const runRecoveryBootstrap = vi.fn(() => 0);
      const runCommand = vi.fn(() => 0);
      const args = ["deployment", operation];
      for (const payload of [args, [Buffer.from(JSON.stringify(args)).toString("base64url")]]) {
        expect(() => runManagedCommandCli("build", ["node", "build-command", ...payload],
          { runRecoveryBootstrap, runCommand })).toThrow("Multichat coordinated recovery is retired");
      }
      expect(runRecoveryBootstrap).not.toHaveBeenCalled();
      expect(runCommand).not.toHaveBeenCalled();
    },
  );

  it("retains ordinary Compose restart dispatch", () => {
    const runCommand = vi.fn(() => 0);
    const args = ["deployment", "compose-restart"];
    runManagedCommandCli("build", ["node", "build-command", Buffer.from(JSON.stringify(args)).toString("base64url")],
      { runCommand });
    expect(runCommand).toHaveBeenCalledWith("build", args);
  });
});
