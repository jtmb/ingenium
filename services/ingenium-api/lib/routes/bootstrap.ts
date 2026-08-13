import { Router } from "express";
import { bootstrap, BootstrapClaimInputSchema } from "ingenium-core";
import { AppError } from "../middleware/errors.js";

export const bootstrapRouter = Router();

bootstrapRouter.get("/status", (_req, res) => {
  res.json({ data: bootstrap.getBootstrapStatus() });
});

bootstrapRouter.post("/claim", async (req, res, next) => {
  try {
    if (req.principal?.type !== "compatibility") {
      throw new AppError("Bootstrap operator capability is required", "FORBIDDEN", 403);
    }
    const input = BootstrapClaimInputSchema.parse(req.body);
    const result = await bootstrap.claimBootstrap(input);
    res.status(201).location(`/api/v1/bootstrap/status`).json({ data: result });
  } catch (error) {
    if (error instanceof bootstrap.BootstrapAlreadyClaimedError) {
      next(new AppError("Bootstrap has already been claimed", "BOOTSTRAP_ALREADY_CLAIMED", 409));
      return;
    }
    next(error);
  }
});
