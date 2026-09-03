import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { Hooks } from "@opencode-ai/plugin";
import { managedCommand } from "../../packages/ingenium-extension/scripts/managed-command-wrapper";
import { repositorySync } from "../../packages/ingenium-extension/resource-sync";
import type { HarnessCheck } from "./contracts";

export const CANARY_AGENT = "coordination-harness-canary";
export const CANARY_TOOL = "coordination_canary";

export const CANARY_OPERATIONS = ["mutate_commit_sync", "mutate_only", "commit_sync", "observe", "fail_local", "noop"] as const;
export type CanaryOperation = typeof CANARY_OPERATIONS[number];

export interface CanaryStep {
  operation: CanaryOperation;
  slot: "a" | "ambiguous" | "restart" | "control";
  path: string | null;
  marker: string | null;
}

export interface CanaryPlan {
  version: 1;
  role: "A" | "B" | "C";
  nonce: string;
  worktree: string;
  project: string;
  check: HarnessCheck;
  steps: CanaryStep[];
}

export interface CanaryRequest {
  nonce: string;
  operation: CanaryOperation;
  path: string | null;
  command: string | null;
  mcpTool: string | null;
}

export interface CanaryActionContext {
  sessionId: string;
  messageId: string;
  abort: AbortSignal;
}

export interface CanaryActions {
  execute(step: CanaryStep, context: CanaryActionContext): Promise<string>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const OPERATIONS = new Set<CanaryOperation>(CANARY_OPERATIONS);

function required(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectedCommand(step: CanaryStep): string | null {
  if (step.operation === "mutate_commit_sync") return "fixed:edit-check-commit-sync";
  if (step.operation === "commit_sync") return "fixed:check-commit-sync";
  if (step.operation === "mutate_only") return "fixed:edit";
  if (step.operation === "fail_local") return "fixed:fail-local";
  if (step.operation === "observe") return "fixed:observe";
  return null;
}

function safeRunPath(worktree: string, path: string): string | undefined {
  if (path.length < 1 || path.length > 1024 || isAbsolute(path) || path.includes("\\")
    || /[\u0000-\u001f\u007f]/.test(path)
    || path.split("/").some((segment) => !segment || segment === "." || segment === ".." || segment === ".git")
    || !path.startsWith("tests/coordination/")) return undefined;
  const absolute = resolve(worktree, path);
  const fromRoot = relative(worktree, absolute);
  return !fromRoot.startsWith("..") && !isAbsolute(fromRoot) ? absolute : undefined;
}

export function assertCanaryPlan(value: unknown): asserts value is CanaryPlan {
  required(value !== null && typeof value === "object" && !Array.isArray(value), "Canary plan is invalid");
  const plan = value as Record<string, unknown>;
  required(plan.version === 1 && ["A", "B", "C"].includes(String(plan.role)) && typeof plan.nonce === "string" && UUID.test(plan.nonce)
    && typeof plan.worktree === "string" && isAbsolute(plan.worktree) && realpathSync(plan.worktree) === plan.worktree
    && typeof plan.project === "string" && SAFE_NAME.test(plan.project)
    && ["build", "lint", "test", "typecheck"].includes(String(plan.check)) && Array.isArray(plan.steps) && plan.steps.length > 0 && plan.steps.length <= 16,
  "Canary plan is invalid");
  for (const value of plan.steps) {
    required(value !== null && typeof value === "object" && !Array.isArray(value), "Canary step is invalid");
    const step = value as Record<string, unknown>;
    required(Object.keys(step).sort().join(",") === "marker,operation,path,slot"
      && OPERATIONS.has(step.operation as CanaryOperation) && ["a", "ambiguous", "restart", "control"].includes(String(step.slot))
      && (step.path === null || (typeof step.path === "string" && safeRunPath(plan.worktree as string, step.path) !== undefined))
      && (step.marker === null || (typeof step.marker === "string" && /^[A-Za-z0-9._-]{1,256}$/.test(step.marker))), "Canary step is invalid");
    const needsFile = step.operation !== "noop";
    required(needsFile === (step.path !== null && step.marker !== null), "Canary step file binding is invalid");
  }
}

function exactRequest(step: CanaryStep, nonce: string): CanaryRequest {
  return {
    nonce,
    operation: step.operation,
    path: step.path,
    command: expectedCommand(step),
    mcpTool: null,
  };
}

export class CanaryDispatcher {
  private cursor = 0;

  constructor(readonly plan: CanaryPlan, private readonly actions: CanaryActions) {
    assertCanaryPlan(plan);
  }

  nextOperation(): CanaryOperation | undefined {
    return this.plan.steps[this.cursor]?.operation;
  }

  requestForCurrentStep(nonce: string, operation: CanaryOperation): CanaryRequest {
    const step = this.plan.steps[this.cursor];
    required(step !== undefined && operation === step.operation, "Canary operation is out of sequence");
    return exactRequest(step, nonce);
  }

  async dispatch(request: CanaryRequest, context: CanaryActionContext): Promise<string> {
    context.abort.throwIfAborted();
    const step = this.plan.steps[this.cursor];
    required(step !== undefined, "Canary plan is complete");
    required(Object.keys(request).sort().join(",") === "command,mcpTool,nonce,operation,path", "Canary request shape is invalid");
    const expected = exactRequest(step, this.plan.nonce);
    required(request.nonce === expected.nonce, "Canary nonce is invalid");
    required(request.operation === expected.operation, "Canary operation is out of sequence");
    required(request.path === expected.path, "Canary path is not allowlisted");
    required(request.command === expected.command, "Canary command is not allowlisted");
    required(request.mcpTool === null, "Canary MCP tool is not allowlisted");
    context.abort.throwIfAborted();
    const result = await this.actions.execute(step, context);
    context.abort.throwIfAborted();
    this.cursor += 1;
    return result;
  }
}

function readExactFile(path: string, marker: string): string {
  const before = lstatSync(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : before.uid;
  required(before.isFile() && !before.isSymbolicLink() && before.uid === uid && before.nlink === 1, "Canary evidence file is unsafe");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    required(opened.dev === before.dev && opened.ino === before.ino && opened.uid === before.uid && opened.mode === before.mode, "Canary evidence identity changed");
    const content = readFileSync(descriptor, "utf8");
    const after = lstatSync(path);
    required(after.dev === opened.dev && after.ino === opened.ino && content === `${marker}\n`, "Canary evidence changed during read");
    return content;
  } finally {
    closeSync(descriptor);
  }
}

async function coordinatedMutation(
  hooks: Hooks,
  context: CanaryActionContext,
  toolName: "apply_patch" | "bash",
  args: Record<string, unknown>,
  action: () => Promise<void> | void,
): Promise<void> {
  context.abort.throwIfAborted();
  const callID = `canary-${randomUUID()}`;
  await hooks["tool.execute.before"]?.({ tool: toolName, sessionID: context.sessionId, callID }, { args });
  context.abort.throwIfAborted();
  try {
    await action();
  } catch (error) {
    await hooks.event?.({ event: {
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          sessionID: context.sessionId,
          messageID: context.messageId,
          callID,
          tool: toolName,
          state: { status: "error", input: args, error: "Injected local canary failure", time: { start: Date.now(), end: Date.now() } },
        },
      },
    } as never });
    throw error;
  }
  context.abort.throwIfAborted();
  await hooks["tool.execute.after"]?.(
    { tool: toolName, sessionID: context.sessionId, callID, args },
    { title: "coordination canary", output: "completed", metadata: { additions: toolName === "apply_patch" ? 1 : 0, deletions: 0 } },
  );
}

export class RealCanaryActions implements CanaryActions {
  constructor(private readonly plan: CanaryPlan, private readonly hooks: Hooks) {}

  async execute(step: CanaryStep, context: CanaryActionContext): Promise<string> {
    context.abort.throwIfAborted();
    if (step.operation === "noop") return "noop";
    const path = safeRunPath(this.plan.worktree, step.path!);
    const canaryDirectory = resolve(this.plan.worktree, "tests", "coordination");
    required(path !== undefined && dirname(path) === canaryDirectory && realpathSync(dirname(path)) === canaryDirectory,
      "Canary path escaped its run-owned directory");
    if (step.operation === "observe") return readExactFile(path, step.marker!);

    if (step.operation === "fail_local") {
      const patchText = `*** Begin Patch\n*** Add File: ${step.path}\n+${step.marker}\n*** End Patch`;
      await coordinatedMutation(this.hooks, context, "apply_patch", { patchText, currentTaskId: this.plan.nonce }, () => {
        throw new Error("Injected local canary failure");
      });
    }

    if (step.operation === "mutate_only" || step.operation === "mutate_commit_sync") {
      const patchText = `*** Begin Patch\n*** Add File: ${step.path}\n+${step.marker}\n*** End Patch`;
      await coordinatedMutation(this.hooks, context, "apply_patch", { patchText, currentTaskId: this.plan.nonce }, () => {
        const descriptor = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { writeFileSync(descriptor, `${step.marker}\n`, "utf8"); } finally { closeSync(descriptor); }
      });
      if (step.operation === "mutate_only") return step.marker!;
    } else {
      readExactFile(path, step.marker!);
    }

    const buildPayload = Buffer.from(JSON.stringify(["run", this.plan.check]), "utf8").toString("base64url");
    await coordinatedMutation(this.hooks, context, "bash", { command: `ingenium-build ${buildPayload}` }, () => {
      required(managedCommand("build", ["run", this.plan.check], this.plan.worktree) === 0, "Canary check failed");
    });
    const addPayload = Buffer.from(JSON.stringify(["add", step.path]), "utf8").toString("base64url");
    await coordinatedMutation(this.hooks, context, "bash", { command: `ingenium-repository ${addPayload}` }, () => {
      required(managedCommand("repository", ["add", step.path!], this.plan.worktree) === 0, "Canary Git add failed");
    });
    const message = `test(coordination): add ${step.slot} canary`;
    const commitPayload = Buffer.from(JSON.stringify(["commit", message]), "utf8").toString("base64url");
    await coordinatedMutation(this.hooks, context, "bash", { command: `ingenium-repository ${commitPayload}` }, () => {
      required(managedCommand("repository", ["commit", message], this.plan.worktree) === 0, "Canary Git commit failed");
    });
    context.abort.throwIfAborted();
    const sync = await repositorySync(this.plan.worktree, { project: this.plan.project });
    required(sync.docs.errors === 0 && sync.skills.errors === 0 && sync.agents.errors === 0 && sync.plugins.errors === 0, "Canary repository sync failed");
    return step.marker!;
  }
}
