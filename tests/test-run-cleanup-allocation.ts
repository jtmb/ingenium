import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

/** Measure only selected cleanup trees. Never follow dependency/browser symlinks. */
export function measureTestRunCleanup(paths: readonly string[]) {
  const groups = new Map<string, { paths: string[]; links: number; bytes: number; allocated: number; file: boolean }>();
  const roots = paths.map(path => {
    if (!isAbsolute(path) || realpathSync(path) !== resolve(path) || lstatSync(path).isSymbolicLink()) throw new Error("Cleanup allocation needs a canonical owned target");
    return resolve(path);
  });
  let entries = 0, metadataAllocatedBytes = 0;
  const walked = new Set<string>();
  function inspect(path: string) {
    if (walked.has(path)) return;
    walked.add(path);
    const info = lstatSync(path, { bigint: true });
    if (info.blocks < 0n) throw new Error("Cleanup allocation is unavailable");
    entries++;
    if (info.isDirectory() || info.isSymbolicLink()) {
      metadataAllocatedBytes += Number(info.blocks) * 512;
      if (info.isDirectory()) for (const name of readdirSync(path)) inspect(join(path, name));
      return;
    }
    if (!info.isFile()) throw new Error("Cleanup allocation encountered an unsupported entry");
    const key = `${info.dev}:${info.ino}`;
    const group = groups.get(key) ?? { paths: [], links: Number(info.nlink), bytes: Number(info.size), allocated: Number(info.blocks) * 512, file: true };
    group.paths.push(path); groups.set(key, group);
  }
  roots.forEach(inspect);
  const sharedHardLinks = [...groups.values()].filter(group => group.paths.length !== group.links)
    .map(group => ({ paths: group.paths, selectedLinks: group.paths.length, totalLinks: group.links }));
  return {
    paths: roots, entries,
    uniqueLogicalBytes: [...groups.values()].reduce((sum, group) => sum + group.bytes, 0),
    reclaimableAllocatedBytes: metadataAllocatedBytes + [...groups.values()].filter(group => group.paths.length === group.links).reduce((sum, group) => sum + group.allocated, 0),
    sharedHardLinks, followedSymlinks: false, windowsRecoveryAttributed: false,
  };
}
