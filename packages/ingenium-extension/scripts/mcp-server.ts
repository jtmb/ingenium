#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { apiRequestHeaders } from "../api-auth.js";
import {
  credentialPurposeFromEnvironment,
  resolveExtensionBinding,
} from "../extension-binding.js";
import {
  classifyExtensionProjectFailure,
  ensureExtensionProject,
  resolveExtensionProject,
} from "../project-resolver.js";

export type McpLauncherFailureStage =
  | "local-binding"
  | "project-preflight"
  | "authentication"
  | "import"
  | "transport";

export type McpLauncherPreflight =
  | { ok: true; project: string }
  | { ok: false; stage: McpLauncherFailureStage; message: string };

export interface McpLauncherOptions {
  /** Injectable only so the preflight-to-transport environment handoff is testable. */
  importTransport?: (transportUrl: URL) => Promise<unknown>;
  /** Injectable only to verify launcher-owned project provisioning. */
  ensureProject?: (worktree: string, apiBase: string, project: string) => Promise<string>;
}

const MISSING_TOKEN_MESSAGE = "Ingenium MCP could not read a protected scoped credential. Configure INGENIUM_MCP_CREDENTIAL_FILE.";
const INVALID_PROJECT_MESSAGE = "Ingenium MCP could not resolve a safe project identity. Set INGENIUM_PROJECT to a valid project name.";
const LOCAL_BINDING_MESSAGE = "Ingenium MCP could not resolve its protected local binding.";
const PROJECT_PREFLIGHT_MESSAGE = "Ingenium MCP project preflight rejected the configured project binding.";
const AUTHENTICATION_MESSAGE = "Ingenium MCP authentication failed during project preflight.";
const API_TRANSPORT_MESSAGE = "Ingenium MCP API transport was unavailable during project preflight.";
const TRANSPORT_LOAD_MESSAGE = "Ingenium MCP launcher is incomplete. Build @ingenium/extension before starting OpenCode.";

function writeLauncherFailure(stage: McpLauncherFailureStage, message: string): void {
  process.stderr.write(`${JSON.stringify({ boundary: "launcher", stage, reason: stage, message })}\n`);
}

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
    const purpose = credentialPurposeFromEnvironment();
    const binding = resolveExtensionBinding(resolvedWorktree, { purpose, allowMissingCredential: true });
    project = resolveExtensionProject(resolvedWorktree, binding.project);
    if (!apiRequestHeaders(resolvedWorktree, undefined, { binding }).has("Authorization")) {
      return { ok: false, stage: "authentication", message: MISSING_TOKEN_MESSAGE };
    }
  } catch {
    try {
      resolveExtensionProject(resolvedWorktree);
    } catch {
      return { ok: false, stage: "project-preflight", message: INVALID_PROJECT_MESSAGE };
    }
    return { ok: false, stage: "local-binding", message: LOCAL_BINDING_MESSAGE };
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
    writeLauncherFailure(preflight.stage, preflight.message);
    return 2;
  }

  const resolvedWorktree = resolve(worktree);
  let binding: ReturnType<typeof resolveExtensionBinding>;
  try {
    binding = resolveExtensionBinding(resolvedWorktree, { purpose: credentialPurposeFromEnvironment() });
  } catch {
    writeLauncherFailure("local-binding", LOCAL_BINDING_MESSAGE);
    return 2;
  }

  const ensureProject = options.ensureProject ?? ((candidateWorktree: string, apiBase: string, project: string) =>
    ensureExtensionProject(candidateWorktree, apiBase, project, {
      credentialPurpose: binding.purpose,
    }));
  let project: string;
  try {
    project = await ensureProject(
      resolvedWorktree,
      binding.apiUrl,
      preflight.project,
    );
  } catch (error) {
    const failure = classifyExtensionProjectFailure(error);
    const stage = failure === "authentication" || failure === "scope"
      ? "authentication"
      : failure === "unavailable"
        ? "transport"
        : "project-preflight";
    writeLauncherFailure(
      stage,
      stage === "authentication"
        ? AUTHENTICATION_MESSAGE
        : stage === "transport"
          ? API_TRANSPORT_MESSAGE
          : PROJECT_PREFLIGHT_MESSAGE,
    );
    return 2;
  }

  process.env.INGENIUM_PROJECT = project;
  process.env.INGENIUM_WORKTREE = resolvedWorktree;
  process.env.INGENIUM_API_URL = binding.apiUrl;
  process.env.INGENIUM_API_URL_TRUSTED = "1";
  process.env.INGENIUM_MCP_AUDIENCE = binding.audience;
  process.env.INGENIUM_MCP_CREDENTIAL_PURPOSE = binding.purpose;
  if (binding.purpose === "runtime") process.env.INGENIUM_RUNTIME_CREDENTIAL_FILE = binding.credentialFile;
  else process.env.INGENIUM_MCP_CREDENTIAL_FILE = binding.credentialFile;

  try {
    const importTransport = options.importTransport ?? ((transportUrl: URL) => import(transportUrl.href));
    await importTransport(getMcpTransportUrl());
    return 0;
  } catch {
    writeLauncherFailure("import", TRANSPORT_LOAD_MESSAGE);
    return 1;
  }
}

if (isMcpLauncherMain()) {
  runMcpLauncher().then((code) => {
    process.exitCode = code;
  }).catch(() => {
    writeLauncherFailure("transport", API_TRANSPORT_MESSAGE);
    process.exitCode = 1;
  });
}
