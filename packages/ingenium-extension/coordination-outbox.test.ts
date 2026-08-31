import {
  chmodSync,
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
import { describe, expect, it } from "vitest";
import {
  COORDINATION_OUTBOX_MAX_RECORD_BYTES,
  COORDINATION_OUTBOX_MAX_RECORDS,
  CoordinationOutbox,
} from "./coordination-outbox.js";

function worktree(): string {
  const root = mkdtempSync(join(tmpdir(), "ingenium-coordination-outbox-"));
  mkdirSync(join(root, ".opencode"), { mode: 0o700 });
  return root;
}

describe("protected coordination outbox", () => {
  it("atomically coalesces exact snapshot keys without retaining sensitive input", () => {
    const root = worktree();
    try {
      const outbox = new CoordinationOutbox(root, () => Date.parse("2026-08-31T00:00:00.000Z"));
      const sensitive = "src/private-token.ts Bearer raw-command todo text";
      const first = outbox.put({
        exactKey: sensitive,
        kind: "snapshot",
        sessionHash: "a".repeat(16),
        failure: "unavailable",
        revision: 1,
      });
      const second = outbox.put({
        exactKey: sensitive,
        kind: "snapshot",
        sessionHash: "a".repeat(16),
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
      outbox.put({ exactKey: "snapshot", kind: "snapshot", sessionHash: "b".repeat(16), failure: "unavailable" });
      const completion = outbox.put({
        exactKey: "completion",
        kind: "completion",
        sessionHash: "b".repeat(16),
        failure: "conflict",
        ambiguous: true,
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

  it("ignores symlink, hardlink, oversized, unknown-key, and interrupted temporary records", () => {
    const root = worktree();
    const outside = mkdtempSync(join(tmpdir(), "ingenium-coordination-outbox-record-"));
    try {
      const outbox = new CoordinationOutbox(root);
      const record = outbox.put({
        exactKey: "valid-record",
        kind: "snapshot",
        sessionHash: "d".repeat(16),
        failure: "unavailable",
      });
      const recordPath = join(outbox.directory, `${record.key}.json`);
      linkSync(recordPath, join(outbox.directory, `${"1".repeat(64)}.json`));
      symlinkSync(join(outside, "missing"), join(outbox.directory, `${"2".repeat(64)}.json`));
      writeFileSync(join(outbox.directory, `${"3".repeat(64)}.json`), `${"x".repeat(COORDINATION_OUTBOX_MAX_RECORD_BYTES + 1)}\n`, { mode: 0o600 });
      writeFileSync(join(outbox.directory, `${"4".repeat(64)}.json`), JSON.stringify({ ...record, key: "4".repeat(64), secret: "Bearer private" }), { mode: 0o600 });
      writeFileSync(join(outbox.directory, `.${"5".repeat(64)}.interrupted.tmp`), "partial", { mode: 0o600 });

      expect(outbox.list()).toEqual([]);
      expect(JSON.stringify(outbox.list())).not.toContain("private");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects invalid and secret-bearing record fields before persistence", () => {
    const root = worktree();
    try {
      const outbox = new CoordinationOutbox(root);
      const base = { exactKey: "safe", kind: "snapshot" as const, sessionHash: "e".repeat(16), failure: "unavailable" as const };
      expect(() => outbox.put({ ...base, exactKey: "Bearer private", digest: "private" })).toThrow("Invalid coordination outbox record");
      expect(() => outbox.put({ ...base, exactKey: "x".repeat(1025) })).toThrow("Invalid coordination outbox record");
      expect(() => outbox.put({ ...base, sessionHash: "private-session" })).toThrow("Invalid coordination outbox record");
      expect(readdirSync(outbox.directory)).toEqual([]);
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
        sessionHash: "f".repeat(16),
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

  it("coalesces bounded overflow instead of blocking when the record cap is reached", () => {
    const root = worktree();
    try {
      const outbox = new CoordinationOutbox(root);
      for (let index = 0; index < COORDINATION_OUTBOX_MAX_RECORDS + 20; index += 1) {
        outbox.put({
          exactKey: `record-${index}`,
          kind: "publication",
          sessionHash: "c".repeat(16),
          failure: "unavailable",
          digest: index.toString(16).padStart(64, "0"),
        });
      }
      const records = outbox.list();
      expect(records.length).toBeLessThanOrEqual(COORDINATION_OUTBOX_MAX_RECORDS);
      expect(records).toContainEqual(expect.objectContaining({ kind: "overflow", ambiguous: true, count: 21 }));
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
