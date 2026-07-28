#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiRequestHeaders } from "../api-auth.js";
import { resolveExtensionProject } from "../project-resolver.js";

export type McpLauncherPreflight =
  | { ok: true; project: string }
  | { ok: false; message: string };

export interface McpLauncherOptions {
  /** Injectable only so the preflight-to-transport environment handoff is testable. */
  importTransport?: (transportUrl: URL) => Promise<unknown>;
}

const MISSING_TOKEN_MESSAGE = "Ingenium MCP could not read a protected API token. Run scripts/bootstrap-local-secrets.sh for local development or configure INGENIUM_API_TOKEN_FILE.";
const INVALID_PROJECT_MESSAGE = "Ingenium MCP could not resolve a safe project identity. Set INGENIUM_PROJECT to a valid project name.";
const TRANSPORT_LOAD_MESSAGE = "Ingenium MCP launcher is incomplete. Build @ingenium/extension before starting OpenCode.";

/**
 * Validate the non-secret prerequisites before loading the packaged stdio
 * transport. This fails closed rather than exposing a tool catalog that cannot
 * authenticate to the API or has an ambiguous project namespace.
 */
export function preflightMcpLauncher(
  worktree = process.env.INGENIUM_WORKTREE ?? process.cwd(),
): McpLauncherPreflight {
  const resolvedWorktree = resolve(worktree);
  let project: string;
  try {
    project = resolveExtensionProject(resolvedWorktree);
  } catch {
    return { ok: false, message: INVALID_PROJECT_MESSAGE };
  }

  if (!apiRequestHeaders(resolvedWorktree).has("Authorization")) {
    return { ok: false, message: MISSING_TOKEN_MESSAGE };
  }

  return { ok: true, project };
}

/** Resolve the packaged transport independently from a workspace node_modules path. */
export function getMcpTransportUrl(moduleUrl = import.meta.url): URL {
  return new URL("./mcp-transport.js", moduleUrl);
}

/** Resolve symlinked package bins so npm/npx invocation remains deterministic. */
export function isMcpLauncherMain(
  moduleUrl = import.meta.url,
  entrypoint = process.argv[1],
): boolean {
  if (!entrypoint) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(entrypoint));
  } catch {
    return false;
  }
}

export async function runMcpLauncher(
  worktree = process.env.INGENIUM_WORKTREE ?? process.cwd(),
  options: McpLauncherOptions = {},
): Promise<number> {
  const preflight = preflightMcpLauncher(worktree);
  if (!preflight.ok) {
    process.stderr.write(`[ingenium-mcp] ${preflight.message}\n`);
    return 2;
  }

  try {
    // The packaged transport resolves its project from the process environment.
    // Preserve the validated preflight result rather than repeating resolution
    // after its dynamic import has started.
    process.env.INGENIUM_PROJECT = preflight.project;
    const importTransport = options.importTransport ?? ((transportUrl: URL) => import(transportUrl.href));
    await importTransport(getMcpTransportUrl());
    return 0;
  } catch {
    // The transport import can reveal source paths or dependency details. Keep
    // the operator message actionable without exposing runtime topology.
    process.stderr.write(`[ingenium-mcp] ${TRANSPORT_LOAD_MESSAGE}\n`);
    return 1;
  }
}

if (isMcpLauncherMain()) {
  runMcpLauncher().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    process.stderr.write(`[ingenium-mcp] ${TRANSPORT_LOAD_MESSAGE}\n`);
    process.exitCode = 1;
  });
}
