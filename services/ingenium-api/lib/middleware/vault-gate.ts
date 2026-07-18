import type { NextFunction, Request, Response } from "express";
import * as core from "ingenium-core";

type VaultService = {
  isSealed(): boolean;
};

const vault = (core as unknown as { vault?: VaultService }).vault;
const EXEMPT_PATHS = new Set(["/unseal", "/seal", "/status"]);

/** Reject vault operations until its encryption key has been unsealed. */
export function vaultGate(req: Request, res: Response, next: NextFunction): void {
  if (EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }

  if (!vault || vault.isSealed()) {
    res.status(503).json({ error: { code: "VAULT_SEALED", message: "Vault is sealed" } });
    return;
  }

  next();
}
