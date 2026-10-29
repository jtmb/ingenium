import { Router, type Request, type Response } from "express";
import { createCustomizeService, CustomizeError, type CustomizeAuthority, type CustomizeContext } from "./catalog-service.js";

export interface CustomizeRouterDependencies {
  resolveContext(req: Request, res: Response): Promise<CustomizeContext | null> | CustomizeContext | null;
  authority: CustomizeAuthority;
}

/**
 * The host supplies its authenticated project/capability resolver. Do not mount
 * without the coordinator's authorization-policy registration.
 */
export function createCustomizeRouter(dependencies: CustomizeRouterDependencies): Router {
  const router = Router();
  const service = createCustomizeService(dependencies.authority);
  router.get("/", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const context = await dependencies.resolveContext(req, res);
      if (!context) {
        if (!res.headersSent) res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Authentication is required." } });
        return;
      }
      const invalidQuery = ["kind", "visibility", "offset", "limit"].some(
        (key) => req.query[key] !== undefined && typeof req.query[key] !== "string",
      );
      if (invalidQuery) throw new CustomizeError("VALIDATION_ERROR", "Catalog query values must be strings.", 400);
      const result = await service.list(context, {
        kind: typeof req.query.kind === "string" ? req.query.kind : undefined,
        visibility: typeof req.query.visibility === "string" ? req.query.visibility : undefined,
        offset: req.query.offset === undefined ? 0 : Number(req.query.offset),
        limit: req.query.limit === undefined ? 50 : Number(req.query.limit),
      });
      res.json(result);
    } catch (error) {
      if (error instanceof CustomizeError) {
        res.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Catalog could not be loaded." } });
    }
  });
  return router;
}
