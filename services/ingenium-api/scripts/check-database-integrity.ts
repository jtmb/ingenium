import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkDatabaseIntegrity, type DatabaseIntegrityResult } from "ingenium-core";

export function runDatabaseIntegrityCheck(databasePath?: string): DatabaseIntegrityResult {
  return checkDatabaseIntegrity(databasePath);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runDatabaseIntegrityCheck();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}
