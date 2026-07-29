#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupThreadExport,
  exportOpenCodeSessionToThread,
  type ThreadExportReceipt,
} from "../thread-export.js";

export const THREAD_EXPORT_USAGE = `Usage:
  ingenium-thread-export --session <safe-session-id> --worktree <canonical-worktree> [--timeout-ms <milliseconds>]
  ingenium-thread-export --cleanup <export-file> --receipt <export-receipt> --sha256 <sha256> --worktree <canonical-worktree> --upload-succeeded

The command only exports local OpenCode data. It never starts or uploads to Thread.
`;

export type ParsedThreadExportArgs =
  | { help: true }
  | { mode: "export"; sessionId: string; worktree: string; timeoutMs?: number }
  | { mode: "cleanup"; path: string; receiptPath: string; sha256: string; worktree: string; uploadSucceeded: true };

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

/** Parse a deliberately small CLI surface so cleanup cannot run implicitly. */
export function parseThreadExportArgs(args: string[]): ParsedThreadExportArgs {
  let sessionId: string | undefined;
  let worktree: string | undefined;
  let cleanupPath: string | undefined;
  let receiptPath: string | undefined;
  let sha256: string | undefined;
  let timeoutMs: number | undefined;
  let uploadSucceeded = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help") {
      if (args.length !== 1) throw new Error("--help cannot be combined with other arguments");
      return { help: true };
    }
    if (argument === "--session") {
      if (sessionId !== undefined) throw new Error("--session may be supplied once");
      sessionId = requireValue(args, index, argument);
      index += 1;
    } else if (argument === "--worktree") {
      if (worktree !== undefined) throw new Error("--worktree may be supplied once");
      worktree = requireValue(args, index, argument);
      index += 1;
    } else if (argument === "--timeout-ms") {
      if (timeoutMs !== undefined) throw new Error("--timeout-ms may be supplied once");
      const value = requireValue(args, index, argument);
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) throw new Error("--timeout-ms must be an integer");
      timeoutMs = parsed;
      index += 1;
    } else if (argument === "--cleanup") {
      if (cleanupPath !== undefined) throw new Error("--cleanup may be supplied once");
      cleanupPath = requireValue(args, index, argument);
      index += 1;
    } else if (argument === "--sha256") {
      if (sha256 !== undefined) throw new Error("--sha256 may be supplied once");
      sha256 = requireValue(args, index, argument);
      index += 1;
    } else if (argument === "--receipt") {
      if (receiptPath !== undefined) throw new Error("--receipt may be supplied once");
      receiptPath = requireValue(args, index, argument);
      index += 1;
    } else if (argument === "--upload-succeeded") {
      uploadSucceeded = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!worktree) throw new Error("--worktree is required");
  if (cleanupPath !== undefined || receiptPath !== undefined || sha256 !== undefined || uploadSucceeded) {
    if (sessionId !== undefined || timeoutMs !== undefined || !cleanupPath || !receiptPath || !sha256 || !uploadSucceeded) {
      throw new Error("cleanup requires --cleanup, --receipt, --sha256, --worktree, and --upload-succeeded only");
    }
    return { mode: "cleanup", path: cleanupPath, receiptPath, sha256, worktree, uploadSucceeded: true };
  }
  if (!sessionId) throw new Error("--session is required");
  return { mode: "export", sessionId, worktree, ...(timeoutMs === undefined ? {} : { timeoutMs }) };
}

export async function runThreadExport(args = process.argv.slice(2)): Promise<number> {
  const parsed = parseThreadExportArgs(args);
  if ("help" in parsed) {
    process.stdout.write(THREAD_EXPORT_USAGE);
    return 0;
  }
  if (parsed.mode === "cleanup") {
    cleanupThreadExport({
      worktree: parsed.worktree,
      receipt: { path: parsed.path, receiptPath: parsed.receiptPath, sha256: parsed.sha256 },
      uploadSucceeded: true,
    });
    process.stdout.write(`${JSON.stringify({ deleted: true })}\n`);
    return 0;
  }
  const receipt: ThreadExportReceipt = await exportOpenCodeSessionToThread({
    sessionId: parsed.sessionId,
    worktree: parsed.worktree,
    ...(parsed.timeoutMs === undefined ? {} : { timeoutMs: parsed.timeoutMs }),
  });
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return 0;
}

export function isThreadExportMain(moduleUrl = import.meta.url, entrypoint = process.argv[1]): boolean {
  if (!entrypoint) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(resolve(entrypoint));
  } catch {
    return false;
  }
}

if (isThreadExportMain()) {
  runThreadExport().then((code) => { process.exitCode = code; }).catch(() => {
    process.stderr.write("Thread export failed\n");
    process.exitCode = 2;
  });
}
