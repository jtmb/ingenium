import { runThreadBridge } from "../../../../scripts/thread-bridge-guard.mjs";

const upstreamFixture = process.env.THREAD_BRIDGE_UPSTREAM_FIXTURE;
const exportDirectory = process.env.THREAD_BRIDGE_EXPORT_DIRECTORY;
if (!upstreamFixture || !exportDirectory) process.exit(2);

runThreadBridge({
  command: process.execPath,
  args: [upstreamFixture],
  cwd: process.cwd(),
  env: {
    THREAD_BRIDGE_AUDIT_FILE: process.env.THREAD_BRIDGE_AUDIT_FILE ?? "",
  },
  exportDirectory,
});
