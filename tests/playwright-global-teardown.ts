import { existsSync } from "node:fs";
import { TEST_RUN_MANIFEST_ENV } from "./test-run-context";
import { stopRunFromManifest } from "./test-server-lifecycle";

export default async function globalTeardown(): Promise<void> {
  const manifestPath = process.env[TEST_RUN_MANIFEST_ENV];
  if (!manifestPath) {
    throw new Error("Global teardown requires the original test-run manifest path");
  }
  if (!existsSync(manifestPath)) {
    throw new Error(`Global teardown cannot find the original test-run manifest; recovery evidence was retained: ${manifestPath}`);
  }
  await stopRunFromManifest(manifestPath, { cleanup: true });
}
