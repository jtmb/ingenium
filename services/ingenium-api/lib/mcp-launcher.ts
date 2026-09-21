import { lstatSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGED_MCP_LAUNCHER_RELATIVE_PATH = "packages/ingenium-extension/dist/scripts/mcp-server.js";

export interface DefaultMcpServerProjection {
  command: string;
  args: string;
  environment: string;
}

/** Resolve the extension-owned launcher from the API entrypoint in source and dist layouts. */
export function resolvePackagedMcpLauncher(apiEntrypointUrl: string): string {
  const scriptDirectory = dirname(fileURLToPath(apiEntrypointUrl));
  const apiDirectory = basename(dirname(scriptDirectory)) === "dist"
    ? resolve(scriptDirectory, "../..")
    : resolve(scriptDirectory, "..");
  return resolve(
    apiDirectory,
    "../..",
    PACKAGED_MCP_LAUNCHER_RELATIVE_PATH,
  );
}

/** Do not project a missing or symlinked launcher as a healthy MCP server. */
export function isPackagedMcpLauncher(path: string): boolean {
  try {
    const metadata = lstatSync(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

/** The server/public OpenCode process is the sole explicit global MCP session. */
export function defaultMcpServerProjection(launcherPath: string): DefaultMcpServerProjection {
  return {
    command: `node ${launcherPath}`,
    args: "[]",
    // The token is intentionally absent: OpenCode supplies it from the protected
    // token-file configuration, and the launcher verifies that prerequisite.
    environment: JSON.stringify({
      INGENIUM_API_URL: "http://localhost:4097/api/v1",
      INGENIUM_API_TIMEOUT: "10000",
      INGENIUM_PROJECT: "global-default",
    }),
  };
}
