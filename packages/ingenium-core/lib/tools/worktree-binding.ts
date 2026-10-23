import { createHash } from "node:crypto";

const SHA256 = /^[0-9a-f]{64}$/;

export function worktreeBindingId(workspaceId: string, storageMappingHash: string): string {
  if (typeof workspaceId !== "string" || workspaceId.length === 0 || workspaceId.length > 256
    || typeof storageMappingHash !== "string" || !SHA256.test(storageMappingHash)
    || /[\u0000-\u001f\u007f]/.test(workspaceId)) {
    throw new Error("INVALID_WORKTREE_BINDING");
  }
  return `worktree-${createHash("sha256").update(workspaceId).update("\0").update(storageMappingHash).digest("hex")}`;
}
