import { readFileSync } from "node:fs";

try {
  const token = readFileSync(process.env.INGENIUM_RUNTIME_MANAGER_TOKEN_FILE, "utf8").trim();
  const port = process.env.INGENIUM_RUNTIME_MANAGER_PORT ?? "4110";
  const response = await fetch(`http://127.0.0.1:${port}/v1/health`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(2_000),
  });
  await response.body?.cancel();
  if (!response.ok) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
