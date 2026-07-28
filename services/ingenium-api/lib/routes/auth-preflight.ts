import { Router } from "express";

/**
 * Authenticated capability probe for extension-managed onboarding. The global
 * auth middleware protects this route; its body intentionally confirms neither
 * token configuration nor credential details.
 */
export const authPreflightRouter = Router();

authPreflightRouter.get("/preflight", (_req, res) => {
  res.json({ data: { authenticated: true } });
});
