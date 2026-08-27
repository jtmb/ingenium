#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { preflightApiAuthentication } from "../api-auth.js";
import { resolveExtensionBinding } from "../extension-binding.js";
import { isValidProjectName } from "../project-resolver.js";
import { repositorySync, type RepositorySyncScope } from "../resource-sync.js";
import { SessionCoordinator } from "../session-coordinator.js";

const AUTHENTICATION_FAILURE_MESSAGE = "Unable to authenticate with Ingenium API";

export interface InitProjectArgs {
  dryRun: boolean;
  scope: RepositorySyncScope;
  project?: string;
}

export interface InitProjectHelpArgs {
  help: true;
}

export type ParsedInitProjectArgs = InitProjectArgs | InitProjectHelpArgs;

export const INIT_PROJECT_USAGE = `Usage:
  ingenium-init-project --dry-run [--docs-only] [--project <name>]
  ingenium-init-project --apply [--docs-only] [--project <name>]

Options:
  --dry-run         Preview the repository projection without mutation.
  --apply           Provision the resolved project and apply the projection.
  --docs-only       Limit the projection to docs/**/*.md.
  --project <name>  Use a validated project name instead of INGENIUM_PROJECT
                    or the validated worktree basename.
  --help            Show this help text.
`;

/** Parse the intentionally small, non-interactive `/init-project` CLI surface. */
export function parseInitProjectArgs(args: string[]): ParsedInitProjectArgs {
  let mode: "dry-run" | "apply" | undefined;
  let scope: RepositorySyncScope = "all";
  let project: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--dry-run") {
      if (mode) throw new Error("Specify exactly one of --dry-run or --apply");
      mode = "dry-run";
    } else if (arg === "--apply") {
      if (mode) throw new Error("Specify exactly one of --dry-run or --apply");
      mode = "apply";
    } else if (arg === "--docs-only") {
      scope = "docs";
    } else if (arg === "--project") {
      if (project !== undefined) throw new Error("Specify --project at most once");
      const requestedProject = args[index + 1];
      if (!requestedProject || requestedProject.startsWith("--")) {
        throw new Error("--project requires a project name");
      }
      if (!isValidProjectName(requestedProject)) throw new Error("--project must be a safe project name");
      project = requestedProject;
      index += 1;
    } else if (arg === "--help") {
      if (args.length !== 1) throw new Error("--help cannot be combined with other arguments");
      return { help: true };
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!mode) throw new Error("Specify exactly one of --dry-run or --apply");
  return { dryRun: mode === "dry-run", scope, ...(project === undefined ? {} : { project }) };
}

export async function runInitProject(args = process.argv.slice(2), worktree = process.env.INGENIUM_WORKTREE ?? process.cwd()): Promise<number> {
  const options = parseInitProjectArgs(args);
  if ("help" in options) {
    process.stdout.write(INIT_PROJECT_USAGE);
    return 0;
  }
  const resolvedWorktree = resolve(worktree);
  let apiBase: string;
  try {
    apiBase = resolveExtensionBinding(resolvedWorktree, { purpose: "repository-sync" }).apiUrl;
  } catch {
    process.stderr.write(`${AUTHENTICATION_FAILURE_MESSAGE}\n`);
    return 2;
  }
  const authentication = await preflightApiAuthentication(apiBase, resolvedWorktree, fetch, {
    credentialPurpose: "repository-sync",
  });
  if (!authentication.authenticated) {
    // Deliberately use the same generic error as the preflight helper. API
    // status, URL, transport diagnostics, and token-source details must not be
    // exposed by a command that may run in an interactive OpenCode session.
    process.stderr.write(`${AUTHENTICATION_FAILURE_MESSAGE}\n`);
    return 2;
  }
  const binding = resolveExtensionBinding(resolvedWorktree, {
    purpose: "repository-sync",
    project: options.project,
  });
  const coordinator = new SessionCoordinator({ worktree: resolvedWorktree, client: undefined }, {
    binding,
    disableHeartbeat: true,
  });
  const sessionId = `init-project-${randomUUID()}`;
  try {
    const result = await coordinator.withRepositoryClaim(
      sessionId,
      (claim) => repositorySync(resolvedWorktree, { ...options, claim }),
    );
    if (!result) {
      process.stderr.write("Repository coordination unavailable\n");
      return 2;
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.docs.errors + result.skills.errors + result.agents.errors + result.plugins.errors > 0 ? 1 : 0;
  } finally {
    await coordinator.closeSession(sessionId);
  }
}

/** Resolve both paths so a package-manager or runtime symlink remains executable. */
export function isInitProjectMain(moduleUrl = import.meta.url, entrypoint = process.argv[1]): boolean {
  if (!entrypoint) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(entrypoint));
  } catch {
    return false;
  }
}

if (isInitProjectMain()) {
  runInitProject().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Initialization failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 2;
  });
}
