import { Router } from "express";
import { extraction, logger, worktreeBinding } from "ingenium-core";
import { requireProject } from "../helpers.js";
import { createBackgroundSynthesisBrokerExecutor, isOpenCodeError, verifyOpenCodeNativeMessage } from "../opencode-client.js";
import { createOpenCodeMessagesClient } from "../opencode-messages-client.js";

/**
 * Observation extraction — the thin HTTP trigger for the auto-observer pipeline.
 * The actual LLM-based extraction runs asynchronously so the caller gets an immediate 200.
 * Extraction reads OpenCode messages from the DB, classifies them as observations,
 * and stores them for the synthesis pipeline to consume.
 */
export const extractionRouter = Router();

// setImmediate fire-and-forget: extraction can take 5-30s depending on message volume.
// The caller doesn't need to block — status is observable via /api/v1/observations/stats.
extractionRouter.post("/run", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  if (req.body?.external !== undefined) {
    const principal = req.principal;
    const parsed = extraction.ExternalExtractionSchema.safeParse(req.body.external);
    if (!parsed.success || Object.keys(req.body).some((key) => key !== "external")) {
      res.status(422).json({ error: { code: "EXTERNAL_OBSERVATION_INVALID", message: "Invalid external observation request" } });
      return;
    }
    if (principal?.type !== "service" || principal.audience !== "mcp"
      || principal.projectId !== projectId || !principal.projectIds?.includes(projectId)
      || !principal.workspaceId || !principal.storageMappingHash
      || principal.launcherWorktree !== parsed.data.worktree || req.get("x-ingenium-ui") !== undefined) {
      res.status(403).json({ error: { code: "EXTERNAL_OBSERVATION_BINDING_REJECTED", message: "External session binding rejected" } });
      return;
    }
    try {
      const nativeBinding = await verifyOpenCodeNativeMessage({
        worktree: parsed.data.worktree,
        sessionId: parsed.data.sessionId,
        messageId: parsed.data.message?.id,
        role: "user",
        text: parsed.data.message?.text,
      });
      if (isOpenCodeError(nativeBinding)) {
        const unavailable = nativeBinding.error.code === "NETWORK_ERROR"
          || nativeBinding.error.code === "AUTH_NOT_CONFIGURED"
          || nativeBinding.error.code.startsWith("HTTP_5");
        res.status(unavailable ? 503 : 403).json({
          error: {
            code: unavailable ? "OPENCODE_UNAVAILABLE" : "EXTERNAL_OBSERVATION_BINDING_REJECTED",
            message: unavailable ? "OpenCode session binding is temporarily unavailable" : "External session binding rejected",
          },
        });
        return;
      }
      const worktreeId = worktreeBinding.worktreeBindingId(principal.workspaceId, principal.storageMappingHash);
      const data = await extraction.extractExternalObservation(projectId, worktreeId, parsed.data, undefined, { nativeOpenCode: true });
      res.json({ data });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      const status = code === "EXTERNAL_OBSERVATION_BINDING_REJECTED" ? 403
        : code === "EXTERNAL_OBSERVATION_SOURCE_CONFLICT" ? 409
          : code === "EXTERNAL_OBSERVATION_EXTRACTOR_UNAVAILABLE" ? 503 : 500;
      res.status(status).json({ error: { code: status === 500 ? "EXTERNAL_OBSERVATION_FAILED" : code,
        message: "External observation request failed" } });
    }
    return;
  }

  const projectName = extraction.getProjectNameById(projectId);
  if (!projectName) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Project not found" } });
    return;
  }

  // Default 500: balances thoroughness with latency — most sessions have <500 new messages
  const limit = parseInt(req.query.limit as string) || 500;

  setImmediate(async () => {
    try {
      const result = await extraction.runExtraction(projectId, projectName, {
        limit,
        llmExecutor: createBackgroundSynthesisBrokerExecutor(projectId),
        messagesClient: createOpenCodeMessagesClient(),
      });
      logger.info("extraction", `Completed: scanned=${result.scanned} candidates=${result.candidates} created=${result.created}`);
    } catch (err: any) {
      logger.error("extraction", `Extraction run failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
    }
  });

  res.json({
    data: { status: "started", message: "Extraction triggered. Results will be logged to the pipeline." },
  });
});
