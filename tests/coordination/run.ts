import { parseHarnessOptions, usage } from "./contracts";
import { runCoordinationHarness } from "./harness";

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const options = parseHarnessOptions(process.argv.slice(2));
  const runId = await runCoordinationHarness(options);
  process.stdout.write(`${JSON.stringify({ result: "PASS", runId })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
