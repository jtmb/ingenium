import {
  chmodSync,
  type Stats,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COORDINATION_OUTBOX_MAX_RECORD_BYTES,
  COORDINATION_OUTBOX_MAX_RECORDS,
  CoordinationOutbox,
} from "./coordination-outbox.js";

type StatFault = (subject: string | number, stat: Stats) => Stats;

const fsFaults = vi.hoisted(() => ({
  lstat: undefined as StatFault | undefined,
  fstat: undefined as StatFault | undefined,
  rejectFchmod: false,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    lstatSync(path: string) {
      const stat = actual.lstatSync(path);
      return fsFaults.lstat?.(path, stat) ?? stat;
    },
    fstatSync(descriptor: number) {
      const stat = actual.fstatSync(descriptor);
      return fsFaults.fstat?.(descriptor, stat) ?? stat;
    },
    fchmodSync(descriptor: number, mode: number) {
      if (fsFaults.rejectFchmod) throw new Error("unexpected fchmod");
      actual.fchmodSync(descriptor, mode);
    },
  };
});

afterEach(() => {
  fsFaults.lstat = undefined;
  fsFaults.fstat = undefined;
  fsFaults.rejectFchmod = false;
});

function withStatValue(stat: Stats, property: "ino" | "uid", value: number): Stats {
  return new Proxy(stat, {
    get(target, key) {
      if (key === property) return value;
      const current = Reflect.get(target, key, target) as unknown;
      return typeof current === "function" ? current.bind(target) : current;
    },
  });
}

function worktree(): string {
  const root = mkdtempSync(join(tmpdir(), "ingenium-coordination-outbox-"));
  mkdirSync(join(root, ".opencode"), { mode: 0o700 });
  return root;
}

describe("protected coordination outbox", () => {
  it("normalizes an existing owner-controlled protected index before creating the outbox", () => {
    const root = worktree();
    const protectedIndex = join(root, ".opencode", "protected-runtime-index");
    try {
      mkdirSync(protectedIndex, { mode: 0o775 });
      chmodSync(protectedIndex, 0o775);

      const outbox = new CoordinationOutbox(root);

      expect(lstatSync(protectedIndex).mode & 0o777).toBe(0o700);
      expect(lstatSync(outbox.directory).mode & 0o777).toBe(0o700);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not chmod directories that are already exactly owner-only", () => {
    const root = worktree();
    const protectedIndex = join(root, ".opencode", "protected-runtime-index");
    const outbox = join(protectedIndex, "coordination-outbox");
    try {
      mkdirSync(outbox, { mode: 0o700, recursive: true });
      fsFaults.rejectFchmod = true;

      expect(() => new CoordinationOutbox(root)).not.toThrow();
    } finally {
      fsFaults.rejectFchmod = false;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([0o500, 0o600, 0o300])("rejects restrictive protected-index mode %o without adding owner permissions", (mode) => {
    const root = worktree();
    const protectedIndex = join(root, ".opencode", "protected-runtime-index");
    try {
      mkdirSync(protectedIndex, { mode });
      chmodSync(protectedIndex, mode);

      expect(() => new CoordinationOutbox(root)).toThrow("Coordination outbox is unavailable");
      expect(lstatSync(protectedIndex).mode & 0o777).toBe(mode);
    } finally {
      chmodSync(protectedIndex, 0o700);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked outbox without traversing it", () => {
    const root = worktree();
    const outside = mkdtempSync(join(tmpdir(), "ingenium-coordination-outbox-outside-"));
    const protectedIndex = join(root, ".opencode", "protected-runtime-index");
    try {
      mkdirSync(protectedIndex, { mode: 0o700 });
      symlinkSync(outside, join(protectedIndex, "coordination-outbox"));

      expect(() => new CoordinationOutbox(root)).toThrow("Coordination outbox is unavailable");
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects mocked foreign ownership without changing mode", () => {
    const root = worktree();
    const protectedIndex = join(root, ".opencode", "protected-runtime-index");
    try {
      mkdirSync(protectedIndex, { mode: 0o775 });
      chmodSync(protectedIndex, 0o775);
      const uid = typeof process.geteuid === "function" ? process.geteuid() : process.getuid?.();
      if (uid === undefined) return;
      fsFaults.lstat = (path, stat) => path === protectedIndex ? withStatValue(stat, "uid", uid + 1) : stat;

      expect(() => new CoordinationOutbox(root)).toThrow("Coordination outbox is unavailable");
      fsFaults.lstat = undefined;
      expect(lstatSync(protectedIndex).mode & 0o777).toBe(0o775);
    } finally {
      fsFaults.lstat = undefined;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(["path", "descriptor"] as const)("rejects mocked %s identity substitution without changing mode", (subject) => {
    const root = worktree();
    const protectedIndex = join(root, ".opencode", "protected-runtime-index");
    let protectedIndexStats = 0;
    try {
      mkdirSync(protectedIndex, { mode: 0o775 });
      chmodSync(protectedIndex, 0o775);
      if (subject === "path") {
        fsFaults.lstat = (path, stat) => {
          if (path !== protectedIndex || ++protectedIndexStats !== 2) return stat;
          return withStatValue(stat, "ino", stat.ino + 1);
        };
      } else {
        fsFaults.fstat = (_descriptor, stat) => withStatValue(stat, "ino", stat.ino + 1);
      }

      expect(() => new CoordinationOutbox(root)).toThrow("Coordination outbox is unavailable");
      fsFaults.lstat = undefined;
      fsFaults.fstat = undefined;
      expect(lstatSync(protectedIndex).mode & 0o777).toBe(0o775);
    } finally {
      fsFaults.lstat = undefined;
      fsFaults.fstat = undefined;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("atomically coalesces exact snapshot keys without retaining sensitive input", () => {
    const root = worktree();
    try {
      const outbox = new CoordinationOutbox(root, () => Date.parse("2026-08-31T00:00:00.000Z"));
      const sensitive = "src/private-token.ts Bearer raw-command todo text";
      const first = outbox.put({
        exactKey: sensitive,
        kind: "snapshot",
        sessionHash: "a".repeat(64),
        failure: "unavailable",
        revision: 1,
      });
      const second = outbox.put({
        exactKey: sensitive,
        kind: "snapshot",
        sessionHash: "a".repeat(64),
        failure: "rate_limited",
        revision: 2,
      });

      expect(second.operationId).toBe(first.operationId);
      expect(outbox.list()).toEqual([expect.objectContaining({ kind: "snapshot", revision: 2, count: 2 })]);
      expect(lstatSync(join(root, ".opencode", "protected-runtime-index")).mode & 0o777).toBe(0o700);
      expect(lstatSync(outbox.directory).mode & 0o777).toBe(0o700);
      const files = readdirSync(outbox.directory);
      expect(files).toHaveLength(1);
      expect(lstatSync(join(outbox.directory, files[0]!)).mode & 0o777).toBe(0o600);
      expect(readFileSync(join(outbox.directory, files[0]!), "utf8")).not.toContain(sensitive);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps ambiguous records and removes confirmed deliveries only after replay", async () => {
    const root = worktree();
    try {
      const outbox = new CoordinationOutbox(root);
      outbox.put({ exactKey: "snapshot", kind: "snapshot", sessionHash: "b".repeat(64), failure: "unavailable" });
      const completion = outbox.put({
        exactKey: "completion",
        kind: "completion",
        sessionHash: "b".repeat(64),
        failure: "conflict",
        ambiguous: false,
        mutation: {
          phase: "completion_ambiguous",
          operation: "write",
          declaredPathSegments: [["c3Jj", "ZmlsZS50cw"]],
          footprint: [{ pathSegments: ["c3Jj", "ZmlsZS50cw"], pathSha256: "1".repeat(64), beforeSha256: null, afterSha256: "2".repeat(64) }],
          remoteClaim: {
            worktreeId: `worktree-${"3".repeat(64)}`,
            sessionId: `session-${"4".repeat(64)}`,
            incarnation: 1,
            expectedRevision: 2,
            fence: 3,
            ownershipToken: "o".repeat(32),
            clientClaimKey: "c".repeat(32),
            acceptedEpoch: 1,
            remoteOperationId: "00000000-0000-4000-8000-000000000099",
          },
        },
      });
      const delivered: string[] = [];

      await outbox.replay(async (record) => {
        delivered.push(record.operationId);
        return !record.ambiguous;
      });

      expect(delivered).toEqual(expect.arrayContaining([completion.operationId]));
      expect(outbox.list()).toEqual([expect.objectContaining({ kind: "completion", ambiguous: true })]);
      await outbox.replay(async () => true);
      await outbox.replay(async (record) => { delivered.push(record.operationId); return true; });
      expect(delivered.filter((operationId) => operationId === completion.operationId)).toHaveLength(1);
      expect(outbox.list()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("retains malformed entries behind a path-free ambiguous sentinel without deleting them", async () => {
    const root = worktree();
    const outside = mkdtempSync(join(tmpdir(), "ingenium-coordination-outbox-record-"));
    try {
      const outbox = new CoordinationOutbox(root);
      const record = outbox.put({
        exactKey: "valid-record",
        kind: "snapshot",
        sessionHash: "d".repeat(64),
        failure: "unavailable",
      });
      const recordPath = join(outbox.directory, `${record.key}.json`);
      linkSync(recordPath, join(outbox.directory, `${"1".repeat(64)}.json`));
      symlinkSync(join(outside, "missing"), join(outbox.directory, `${"2".repeat(64)}.json`));
      writeFileSync(join(outbox.directory, `${"3".repeat(64)}.json`), `${"x".repeat(COORDINATION_OUTBOX_MAX_RECORD_BYTES + 1)}\n`, { mode: 0o600 });
      writeFileSync(join(outbox.directory, `${"4".repeat(64)}.json`), JSON.stringify({ ...record, key: "4".repeat(64), secret: "Bearer private" }), { mode: 0o600 });
      writeFileSync(join(outbox.directory, `.${"5".repeat(64)}.interrupted.tmp`), "partial", { mode: 0o600 });
      const wrongMode = join(outbox.directory, `${"6".repeat(64)}.json`);
      writeFileSync(wrongMode, `${JSON.stringify({ ...record, key: "6".repeat(64) })}\n`, { mode: 0o600 });
      chmodSync(wrongMode, 0o640);

      const entries = readdirSync(outbox.directory).sort();
      const listed = outbox.list();
      expect(listed).toEqual([expect.objectContaining({
        kind: "overflow", failure: "invalid_response", ambiguous: true, count: 7, mutation: null,
      })]);
      const serialized = JSON.stringify(listed);
      expect(serialized).not.toContain("private");
      for (const entry of entries) expect(serialized).not.toContain(entry);
      const delivered = vi.fn(async () => true);
      await outbox.replay(delivered);
      expect(delivered).not.toHaveBeenCalled();
      expect(readdirSync(outbox.directory).sort()).toEqual(entries);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects invalid and secret-bearing record fields before persistence", () => {
    const root = worktree();
    try {
      const outbox = new CoordinationOutbox(root);
      const base = { exactKey: "safe", kind: "snapshot" as const, sessionHash: "e".repeat(64), failure: "unavailable" as const };
      expect(() => outbox.put({ ...base, exactKey: "Bearer private", digest: "private" })).toThrow("Invalid coordination outbox record");
      expect(() => outbox.put({ ...base, exactKey: "x".repeat(1025) })).toThrow("Invalid coordination outbox record");
      expect(() => outbox.put({ ...base, sessionHash: "e".repeat(16) })).toThrow("Invalid coordination outbox record");
      expect(() => outbox.put({ ...base, sessionHash: "private-session" })).toThrow("Invalid coordination outbox record");
      expect(readdirSync(outbox.directory)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not replace malformed exact-key evidence", () => {
    const root = worktree();
    try {
      const outbox = new CoordinationOutbox(root);
      const input = {
        exactKey: "preserved-record",
        kind: "snapshot" as const,
        sessionHash: "e".repeat(64),
        failure: "unavailable" as const,
      };
      const stored = outbox.put(input);
      const path = join(outbox.directory, `${stored.key}.json`);
      const retained = readFileSync(path, "utf8");
      chmodSync(path, 0o640);

      expect(outbox.put(input)).toMatchObject({ kind: "overflow", ambiguous: true });
      expect(readFileSync(path, "utf8")).toBe(retained);
      expect(lstatSync(path).mode & 0o777).toBe(0o640);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("replays a stable operation once after restart and durably removes only confirmed delivery", async () => {
    const root = worktree();
    try {
      const first = new CoordinationOutbox(root, () => Date.parse("2026-08-31T00:00:00.000Z"));
      const stored = first.put({
        exactKey: "restart-snapshot",
        kind: "snapshot",
        sessionHash: "f".repeat(64),
        failure: "unavailable",
        revision: 7,
      });
      const restarted = new CoordinationOutbox(root);
      expect(restarted.list()[0]?.operationId).toBe(stored.operationId);
      await restarted.replay(async () => false);
      expect(restarted.list()).toHaveLength(1);
      const delivered: string[] = [];
      await restarted.replay(async (record) => { delivered.push(record.operationId); return true; });
      await restarted.replay(async (record) => { delivered.push(record.operationId); return true; });

      expect(delivered).toEqual([stored.operationId]);
      expect(new CoordinationOutbox(root).list()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses legacy 16-character session references from disk without rewriting them", () => {
    const root = worktree();
    try {
      const outbox = new CoordinationOutbox(root);
      const current = outbox.put({
        exactKey: "legacy-overflow",
        kind: "snapshot",
        sessionHash: "1".repeat(64),
        failure: "unavailable",
      });
      const path = join(outbox.directory, `${current.key}.json`);
      writeFileSync(path, `${JSON.stringify({
        ...current,
        kind: "overflow",
        sessionHash: "0".repeat(16),
      })}\n`);

      expect(new CoordinationOutbox(root).list()).toEqual([
        expect.objectContaining({ kind: "overflow", sessionHash: "0".repeat(16), ambiguous: true }),
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("coalesces bounded overflow instead of blocking when the record cap is reached", () => {
    const root = worktree();
    try {
      const outbox = new CoordinationOutbox(root);
      for (let index = 0; index < COORDINATION_OUTBOX_MAX_RECORDS + 20; index += 1) {
        outbox.put({
          exactKey: `record-${index}`,
          kind: "publication",
          sessionHash: "c".repeat(64),
          failure: "unavailable",
          digest: index.toString(16).padStart(64, "0"),
          ambiguous: false,
        });
      }
      const records = outbox.list();
      expect(records.length).toBeLessThanOrEqual(COORDINATION_OUTBOX_MAX_RECORDS);
      expect(records).toContainEqual(expect.objectContaining({
        kind: "overflow", sessionHash: "0".repeat(64), ambiguous: true, count: 21,
      }));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked protected directory", () => {
    const root = worktree();
    const outside = mkdtempSync(join(tmpdir(), "ingenium-coordination-outbox-outside-"));
    try {
      symlinkSync(outside, join(root, ".opencode", "protected-runtime-index"));
      expect(() => new CoordinationOutbox(root)).toThrow("Coordination outbox is unavailable");
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
