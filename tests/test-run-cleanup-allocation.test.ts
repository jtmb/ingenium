import { linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { measureTestRunCleanup } from "./test-run-cleanup-allocation";

describe("fixture cleanup allocation", () => {
  it("does not count or traverse the linked dependency tree", () => {
    const root = mkdtempSync(join(tmpdir(), "cleanup-allocation-"));
    try {
      const target = join(root, "target"), dependencies = join(root, "dependencies");
      mkdirSync(target); mkdirSync(dependencies);
      writeFileSync(join(target, "owned"), "owned"); writeFileSync(join(dependencies, "protected"), "protected dependency");
      symlinkSync(dependencies, join(target, "node_modules"), "dir");
      const measured = measureTestRunCleanup([target]);
      expect(measured.uniqueLogicalBytes).toBe(5); expect(measured.followedSymlinks).toBe(false);
      expect(readFileSync(join(dependencies, "protected"), "utf8")).toBe("protected dependency");
    } finally { rmSync(root, { recursive: true }); }
  });

  it("counts a selected hard-link pair once and excludes an inode with an outside link from recovery", () => {
    const root = mkdtempSync(join(tmpdir(), "cleanup-allocation-"));
    try {
      const target = join(root, "target"); mkdirSync(target);
      const file = join(target, "first"); writeFileSync(file, "pair"); linkSync(file, join(target, "second"));
      const pair = measureTestRunCleanup([target]);
      expect(pair.uniqueLogicalBytes).toBe(4); expect(pair.sharedHardLinks).toEqual([]);
      expect(pair.reclaimableAllocatedBytes).toBe(Number(lstatSync(target, { bigint: true }).blocks + lstatSync(file, { bigint: true }).blocks) * 512);
      linkSync(file, join(root, "outside"));
      const shared = measureTestRunCleanup([target]);
      expect(shared.reclaimableAllocatedBytes).toBe(Number(lstatSync(target, { bigint: true }).blocks) * 512);
      expect(shared.sharedHardLinks).toEqual([{ paths: [file, join(target, "second")], selectedLinks: 2, totalLinks: 3 }]);
    } finally { rmSync(root, { recursive: true }); }
  });

  it("refuses a redirected root instead of measuring its target", () => {
    const root = mkdtempSync(join(tmpdir(), "cleanup-allocation-"));
    try {
      mkdirSync(join(root, "actual")); symlinkSync(join(root, "actual"), join(root, "alias"), "dir");
      expect(() => measureTestRunCleanup([join(root, "alias")])).toThrow(/canonical owned target/);
    } finally { rmSync(root, { recursive: true }); }
  });
});
