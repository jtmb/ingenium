import { runThreadBridge } from "../../../../scripts/thread-bridge-guard.mjs";

const exportDirectory = process.env.THREAD_BRIDGE_EXPORT_DIRECTORY;
const guardUrl = process.env.THREAD_GUARD_URL;
if (!guardUrl || !exportDirectory) process.exit(2);

runThreadBridge({
  guardUrl,
  exportDirectory,
});
