import { readFileSync } from "node:fs";
import { join } from "node:path";

function extractToolNames(filePath: string, pattern: RegExp): string[] {
  const source = readFileSync(filePath, "utf-8");
  return Array.from(source.matchAll(pattern), (match) => match[1] ?? "");
}

/** Source-derived canonical inventory for registration parity checks. */
export function getSourceDerivedCanonicalRegistrations(): {
  server: string[];
  extension: string[];
  all: string[];
} {
  const repositoryRoot = join(__dirname, "..", "..", "..", "..");
  const server = extractToolNames(
    join(repositoryRoot, "services", "ingenium-server", "scripts", "mcp-server.ts"),
    /server\.registerTool\(\s*"([^"]+)"\s*,/g,
  ).map((name) => `ingenium_${name}`);
  const extension = ["observer.ts", "auto-observer.ts"].flatMap((file) => extractToolNames(
    join(repositoryRoot, "packages", "ingenium-extension", file),
    /tool:\s*\{\s*([a-z][\w]*):\s*tool\(/g,
  ));
  return { server, extension, all: [...server, ...extension] };
}
