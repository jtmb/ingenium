import { startThreadGuardService } from "../../../../scripts/thread-guard-service.mjs";

const upstreamFixture = process.env.THREAD_BRIDGE_UPSTREAM_FIXTURE;
const auditFile = process.env.THREAD_BRIDGE_AUDIT_FILE;
const temporaryDirectory = process.env.THREAD_GUARD_TEMP_DIRECTORY;
const port = Number(process.env.THREAD_GUARD_PORT);
if (!upstreamFixture || !auditFile || !temporaryDirectory || !Number.isInteger(port)) process.exit(2);

const service = startThreadGuardService({
  host: "127.0.0.1",
  port,
  tempDirectory: temporaryDirectory,
  command: process.execPath,
  args: [upstreamFixture],
  cwd: process.cwd(),
  env: {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    THREAD_BRIDGE_AUDIT_FILE: auditFile,
  },
  onShutdown: (exitCode) => process.exit(exitCode),
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { void service.shutdown(0); });
}
