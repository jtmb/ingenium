import { Router, type NextFunction, type Request, type Response } from "express";
import { authentication, authorization } from "ingenium-core";
import { CloudflareConnectorUnavailableError } from "../cloudflare-connector.js";
import {
  connectCloudflareTunnel,
  disconnectCloudflareTunnel,
  getCloudflareTunnelStatus,
  saveCloudflareTunnelConfig,
  validateCloudflareTunnelConfig,
} from "../cloudflare-tunnel-service.js";
import { AppError } from "../middleware/errors.js";

export const cloudflareRouter = Router();

function requireBrowserInstallationAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.principal?.type !== "user" || !req.principal.session || !authorization.isInstallationAdmin(req.principal.id)) {
    throw new AppError("A browser installation administrator is required", "FORBIDDEN", 403);
  }
  if (req.method !== "GET" && !authentication.hasRecentStepUp(req.principal.session)) {
    throw new AppError("Recent step-up authentication is required", "STEP_UP_REQUIRED", 403);
  }
  next();
}

function emptyRequestBody(req: Request): boolean {
  return req.body === undefined || (req.body && typeof req.body === "object" && !Array.isArray(req.body) && Object.keys(req.body).length === 0);
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function handleUnavailable(error: unknown, res: Response): void {
  if (error instanceof CloudflareConnectorUnavailableError) {
    sendError(res, 503, "CLOUDFLARE_CONNECTOR_UNAVAILABLE", "The fixed Cloudflare connector runtime is not installed or its supervisor is unavailable");
    return;
  }
  const code = error instanceof Error ? error.message : "";
  if (code === "CLOUDFLARE_TOKEN_INVALID") {
    sendError(res, 422, "VALIDATION_ERROR", "Tunnel tokens must be 32-4096 URL-safe characters with optional base64 padding");
    return;
  }
  if (code === "VAULT_REQUIRED") {
    sendError(res, 409, code, "Unseal and initialize the vault before changing the tunnel token");
    return;
  }
  if (code === "CLOUDFLARE_CONFIG_INVALID") {
    sendError(res, 409, code, "Repair the saved Cloudflare configuration before connecting");
    return;
  }
  if (code === "CLOUDFLARE_CONFIG_DISABLED") {
    sendError(res, 409, code, "Enable the desired Cloudflare connector configuration before connecting");
    return;
  }
  if (code === "CLOUDFLARE_AUTH_NOT_READY") {
    sendError(res, 409, code, "Configure a tunnel token in an unsealed vault before connecting");
    return;
  }
  if (code === "CLOUDFLARE_ROUTES_UNAVAILABLE") {
    sendError(res, 409, code, "The operator-managed trusted Cloudflare ingress inventory is unavailable");
    return;
  }
  sendError(res, 503, "CLOUDFLARE_STATUS_UNAVAILABLE", "Cloudflare tunnel status is temporarily unavailable");
}

cloudflareRouter.use(requireBrowserInstallationAdmin);

cloudflareRouter.get("/", async (_req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  try {
    res.json({ data: await getCloudflareTunnelStatus() });
  } catch (error) {
    handleUnavailable(error, res);
  }
});

cloudflareRouter.put("/", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some((key) => key !== "config" && key !== "token")
    || !Object.hasOwn(body, "config")) {
    sendError(res, 422, "VALIDATION_ERROR", "Request must contain only config and an optional token operation");
    return;
  }
  const validation = validateCloudflareTunnelConfig(body.config);
  if (!validation.ok) {
    sendError(res, 422, "VALIDATION_ERROR", validation.error);
    return;
  }
  const token = body.token ?? { action: "preserve" };
  if (!token || typeof token !== "object" || Array.isArray(token)
    || Object.keys(token).some((key) => key !== "action" && key !== "value")
    || !["preserve", "replace", "clear"].includes(token.action)
    || (token.action === "replace" && typeof token.value !== "string")
    || (token.action !== "replace" && token.value !== undefined)) {
    sendError(res, 422, "VALIDATION_ERROR", "token action must be preserve, replace, or clear");
    return;
  }

  try {
    await saveCloudflareTunnelConfig(validation.config, token);
    res.json({ data: await getCloudflareTunnelStatus() });
  } catch (error) {
    handleUnavailable(error, res);
  }
});

cloudflareRouter.post("/validate", async (req, res): Promise<void> => {
  if (!emptyRequestBody(req)) {
    sendError(res, 422, "VALIDATION_ERROR", "Cloudflare validation does not accept runtime arguments");
    return;
  }
  try {
    res.json({ data: await getCloudflareTunnelStatus() });
  } catch (error) {
    handleUnavailable(error, res);
  }
});

cloudflareRouter.post("/connect", async (req, res): Promise<void> => {
  if (!emptyRequestBody(req)) {
    sendError(res, 422, "VALIDATION_ERROR", "Cloudflare connector control does not accept runtime arguments");
    return;
  }
  try {
    res.json({ data: await connectCloudflareTunnel() });
  } catch (error) {
    handleUnavailable(error, res);
  }
});

cloudflareRouter.post("/disconnect", async (req, res): Promise<void> => {
  if (!emptyRequestBody(req)) {
    sendError(res, 422, "VALIDATION_ERROR", "Cloudflare connector control does not accept runtime arguments");
    return;
  }
  try {
    res.json({ data: await disconnectCloudflareTunnel() });
  } catch (error) {
    handleUnavailable(error, res);
  }
});
