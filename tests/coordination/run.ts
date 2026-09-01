import { basename, join } from "node:path";
import { auditSuiteContainment, strictFailures, type ContainmentAuditReport } from "../suite-containment-audit";
import { parseHarnessOptions, usage } from "./contracts";
import { runCoordinationHarness } from "./harness";

export interface CoordinationRunDependencies {
  run?: typeof runCoordinationHarness;
  audit?: (options: { telemetryPaths: string[]; includeRepositoryTelemetry: true }) => Promise<ContainmentAuditReport>;
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
  const runId = await (dependencies.run ?? runCoordinationHarness)(options);
  const report = await (dependencies.audit ?? auditSuiteContainment)({
    telemetryPaths: [join(options.worktree, "tests", "artifacts", "test-runs", runId, "runner-telemetry.json")],
    includeRepositoryTelemetry: true,
  });
  const failures = strictFailures(report);
  if (failures.length > 0) throw new Error(`Strict containment failed: ${failures.join("; ")}`);
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
