import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runManagedTui } from "./tui-recovery.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:child_process")>(),
  spawn: vi.fn(),
}));

vi.mock("node:crypto", async (importOriginal) => ({
  ...await importOriginal<typeof import("node:crypto")>(),
  randomBytes: vi.fn(),
}));

const { randomBytes: secureRandomBytes } = await vi.importActual<typeof import("node:crypto")>("node:crypto");
const consoleMethods = ["log", "info", "warn", "error", "debug"] as const;
const exitedChild = (code = 0) => ({ exitCode: code, signalCode: null }) as ChildProcess;
let worktree: string;

beforeEach(() => {
  worktree = mkdtempSync("/tmp/opencode/tui-recovery-");
  const executable = join(worktree, "opencode");
  writeFileSync(executable, "", { mode: 0o700 });
  vi.stubEnv("INGENIUM_WORKTREE", worktree);
  vi.stubEnv("INGENIUM_OPENCODE_EXECUTABLE", executable);
  vi.stubEnv("OPENCODE_SERVER_PASSWORD", undefined);
  vi.mocked(spawn).mockReset().mockReturnValue(exitedChild());
  vi.mocked(randomBytes).mockReset().mockImplementation((size) => secureRandomBytes(size));
  for (const method of consoleMethods) vi.spyOn(console, method).mockImplementation(() => {});
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(worktree, { recursive: true, force: true });
});

function expectPrivate(password: string, result: unknown): void {
  const directory = join(worktree, ".opencode/protected-runtime-index/tui-recovery");
  const surfaced = inspect({
    result,
    argv: vi.mocked(spawn).mock.calls.map(([, args]) => args),
    logs: consoleMethods.map((method) => vi.mocked(console[method]).mock.calls),
    stdout: vi.mocked(process.stdout.write).mock.calls,
    stderr: vi.mocked(process.stderr.write).mock.calls,
    records: readdirSync(directory).map((name) => readFileSync(join(directory, name), "utf8")),
  }, { depth: null, maxStringLength: null });
  // Boolean comparisons keep credentials out of failed assertion diagnostics, too.
  expect(surfaced.includes(password)).toBe(false);
}

describe("managed TUI launcher", () => {
  it.each([
    { name: "missing", value: undefined },
    { name: "empty", value: "" },
    { name: "too short", value: "p".repeat(42) },
    { name: "too long", value: "p".repeat(129) },
    { name: "non-URL-safe", value: `${"p".repeat(42)}+` },
    { name: "trailing newline", value: `${"p".repeat(43)}\n` },
  ])("provisions a private 256-bit URL-safe password when the value is $name", async ({ value }) => {
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", value);
    const argv = ["--model", "provider/model"];
    const result = await runManagedTui(argv);
    expect(result).toBe(0);
    expect(vi.mocked(spawn).mock.calls.length).toBe(1);
    const [command, args, options] = vi.mocked(spawn).mock.calls[0]!;
    const { env, cwd, shell, stdio } = options as SpawnOptions;
    const password = env!.OPENCODE_SERVER_PASSWORD!;
    const port = env!.INGENIUM_OPENCODE_PORT!;
    expect(typeof password).toBe("string");
    expect(password.length).toBe(43);
    expect(/^[A-Za-z0-9_-]{43}$/.test(password)).toBe(true);
    expect(password === value).toBe(false);
    expect(password === env!.INGENIUM_RESTART_NONCE).toBe(false);
    expect(password === env!.INGENIUM_RECOVERY_OWNER_NONCE).toBe(false);
    expect(process.env.OPENCODE_SERVER_PASSWORD === value).toBe(true);
    expect(command).toBe(join(worktree, "opencode"));
    expect(JSON.stringify(args) === JSON.stringify([...argv, "--port", port])).toBe(true);
    expect(Number.isInteger(Number(port)) && Number(port) >= 1024 && Number(port) <= 65535).toBe(true);
    expect({ cwd, shell, stdio }).toEqual({ cwd: worktree, shell: false, stdio: "inherit" });
    expect(vi.mocked(randomBytes).mock.calls.map(([size]) => size)).toEqual([32, 32, 32]);
    expectPrivate(password, result);
  });

  it.each([43, 64, 128])("respects an existing valid %i-character value on launch and relaunch", async (length) => {
    const password = "aZ0_-".repeat(26).slice(0, length);
    vi.stubEnv("OPENCODE_SERVER_PASSWORD", password);
    vi.mocked(spawn).mockReturnValueOnce(exitedChild(1));
    const result = await runManagedTui(["--session", "ses_resume"]);
    expect(result).toBe(0);
    expect(vi.mocked(spawn).mock.calls.length).toBe(2);
    for (const [, , options] of vi.mocked(spawn).mock.calls) {
      expect((options as SpawnOptions).env!.OPENCODE_SERVER_PASSWORD === password).toBe(true);
    }
    expect(process.env.OPENCODE_SERVER_PASSWORD === password).toBe(true);
    expect(vi.mocked(randomBytes).mock.calls.map(([size]) => size)).toEqual([32, 32, 32]);
    expectPrivate(password, result);
  });

  it("generates a fresh password for a continuation relaunch without changing session arguments", async () => {
    vi.mocked(spawn).mockReturnValueOnce(exitedChild(1));
    const argv = ["--continue", "--session=ses_resume", "--model", "provider/model"];
    const result = await runManagedTui(argv);
    expect(result).toBe(0);
    expect(vi.mocked(spawn).mock.calls.length).toBe(2);
    const passwords: string[] = [];
    for (const [index, [, args, options]] of vi.mocked(spawn).mock.calls.entries()) {
      const env = (options as SpawnOptions).env!;
      const password = env.OPENCODE_SERVER_PASSWORD!;
      const expected = index === 0 ? argv : ["--model", "provider/model", "--session", "ses_resume"];
      expect(JSON.stringify(args) === JSON.stringify([...expected, "--port", env.INGENIUM_OPENCODE_PORT])).toBe(true);
      expect(/^[A-Za-z0-9_-]{43}$/.test(password)).toBe(true);
      expectPrivate(password, result);
      passwords.push(password);
    }
    expect(new Set(passwords).size).toBe(2);
    expect(process.env.OPENCODE_SERVER_PASSWORD).toBeUndefined();
  });

  it("fails closed without leaking the generation error or launching a child", async () => {
    const sentinel = secureRandomBytes(32).toString("base64url");
    vi.mocked(randomBytes)
      .mockImplementationOnce((size) => secureRandomBytes(size))
      .mockImplementationOnce(() => { throw new Error(sentinel); });
    const outcome = await runManagedTui([]).then(
      (result) => ({ result, error: undefined }),
      (error: Error) => ({ result: null, error }),
    );
    expect(outcome.result).toBeNull();
    expect(outcome.error?.message === "TUI recovery server authentication is unavailable").toBe(true);
    expect(vi.mocked(spawn).mock.calls.length).toBe(0);
    expectPrivate(sentinel, outcome);
  });

  it.each([["--port", "4100"], ["--port=4100"]])("still rejects caller-owned ports (%j)", async (...argv) => {
    await expect(runManagedTui(argv)).rejects.toThrow("ingenium-opencode owns the recovery port");
    expect(vi.mocked(spawn).mock.calls.length).toBe(0);
  });
});
