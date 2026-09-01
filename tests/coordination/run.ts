import { basename, join } from "node:path";
import { auditSuiteContainment, strictFailures, type ContainmentAuditReport } from "../suite-containment-audit";
import { parseHarnessOptions, usage } from "./contracts";
import { runCoordinationHarness, type CoordinationRunEvidence } from "./harness";

export interface CoordinationRunDependencies {
  run?: typeof runCoordinationHarness;
  audit?: (options: { telemetryPaths: string[]; includeRepositoryTelemetry: true }) => Promise<ContainmentAuditReport>;
}

function attachContainmentAuditError(primaryError: unknown, auditError: unknown): void {
  if (!(primaryError instanceof Error)) return;
  try {
    Object.defineProperty(primaryError, "containmentAuditError", {
      configurable: true,
      enumerable: false,
      value: auditError,
    });
  } catch {}
}

export async function runMain(
  argv: readonly string[] = process.argv.slice(2),
  dependencies: CoordinationRunDependencies = {},
): Promise<{ result: "PASS"; runId: string } | undefined> {
  if (argv.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return undefined;
  }
  const options = parseHarnessOptions(argv);
  let evidence: CoordinationRunEvidence | undefined;
  let runId: string | undefined;
  let harnessError: unknown;
  let hasHarnessError = false;
  try {
    runId = await (dependencies.run ?? runCoordinationHarness)(options, (reported) => { evidence = reported; });
  } catch (error) {
    harnessError = error;
    hasHarnessError = true;
  }

  const telemetryPath = evidence?.telemetryPath ?? (runId
    ? join(options.worktree, "tests", "artifacts", "test-runs", runId, "runner-telemetry.json")
    : undefined);
  let auditError: unknown;
  try {
    if (!telemetryPath) throw new Error("Coordination harness failure omitted run telemetry evidence");
    const report = await (dependencies.audit ?? auditSuiteContainment)({
      telemetryPaths: [telemetryPath],
      includeRepositoryTelemetry: true,
    });
    const failures = strictFailures(report);
    if (failures.length > 0) throw new Error(`Strict containment failed: ${failures.join("; ")}`);
  } catch (error) {
    auditError = error;
  }

  if (hasHarnessError) {
    if (auditError !== undefined) attachContainmentAuditError(harnessError, auditError);
    throw harnessError;
  }
  if (auditError !== undefined) throw auditError;
  if (!runId) throw new Error("Coordination harness completed without a run ID");
  return { result: "PASS", runId };
}

if (basename(process.argv[1] ?? "") === "run.ts") {
  runMain().then((result) => {
    if (result) process.stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
