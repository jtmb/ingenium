import { Router, type Request, type Response } from "express";
import { usage } from "ingenium-core";
import { requireProject } from "../helpers.js";
import { getOpenCodeUsageSourceInstance, getUsageSyncInterval, syncUsageFromOpenCode } from "../usage-sync.js";

const MAX_RANGE_MS = 366 * 86_400_000;

export const usageRouter = Router();

function sendUsageError(res: Response, error: unknown): void {
  if (!(error instanceof usage.UsageError)) {
    res.status(500).json({ error: { code: "USAGE_UNAVAILABLE", message: "Usage data is temporarily unavailable." } });
    return;
  }
  const statusByCode: Record<usage.UsageError["code"], number> = {
    INVALID_USAGE_INPUT: 422,
    INVALID_USAGE_QUERY: 422,
    INVALID_USAGE_THRESHOLD_INPUT: 422,
    PROJECT_NOT_FOUND: 404,
    MAPPING_OWNED_BY_OTHER_PROJECT: 409,
    USAGE_THRESHOLD_REVISION_CONFLICT: 409,
    USAGE_ATTENTION_ITEM_NOT_FOUND: 404,
    USAGE_ATTENTION_REVISION_CONFLICT: 409,
  };
  const messageByCode: Record<usage.UsageError["code"], string> = {
    INVALID_USAGE_INPUT: "Invalid usage metadata.",
    INVALID_USAGE_QUERY: "Usage filters, range, or pagination are invalid.",
    INVALID_USAGE_THRESHOLD_INPUT: "Usage advisory thresholds are invalid.",
    PROJECT_NOT_FOUND: "Project not found.",
    MAPPING_OWNED_BY_OTHER_PROJECT: "This OpenCode project is already mapped to another Ingenium project.",
    USAGE_THRESHOLD_REVISION_CONFLICT: "Usage advisory thresholds were changed by another request.",
    USAGE_ATTENTION_ITEM_NOT_FOUND: "Usage attention item not found.",
    USAGE_ATTENTION_REVISION_CONFLICT: "Usage attention item was changed by another request.",
  };
  res.status(statusByCode[error.code]).json({
    error: {
      code: error.code,
      message: messageByCode[error.code],
      ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
    },
  });
}

function queryStrings(value: unknown): string[] {
  if (value === undefined) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) return value;
  throw new usage.UsageError("INVALID_USAGE_QUERY");
}

function usageQuery(req: Request): usage.UsageQuery {
  const to = typeof req.query.to === "string" ? req.query.to : new Date().toISOString();
  const from = typeof req.query.from === "string"
    ? req.query.from
    : new Date(Date.parse(to) - 30 * 86_400_000).toISOString();
  const rangeStart = Date.parse(from);
  const rangeEnd = Date.parse(to);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart || rangeEnd - rangeStart > MAX_RANGE_MS) {
    throw new usage.UsageError("INVALID_USAGE_QUERY");
  }
  return {
    from,
    to,
    providerIds: queryStrings(req.query.provider),
    modelIds: queryStrings(req.query.model),
    agentIds: queryStrings(req.query.agent),
    statuses: queryStrings(req.query.status) as usage.UsageStatus[],
  };
}

function usageAdvisoryQuery(req: Request): usage.UsageAdvisoryEvaluationQuery {
  const { from, to } = req.query;
  if (from === undefined && to === undefined) return {};
  if (typeof from !== "string" || typeof to !== "string") throw new usage.UsageError("INVALID_USAGE_QUERY");
  const rangeStart = Date.parse(from);
  const rangeEnd = Date.parse(to);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart || rangeEnd - rangeStart > MAX_RANGE_MS) {
    throw new usage.UsageError("INVALID_USAGE_QUERY");
  }
  return { from, to };
}

function thresholdReplacement(req: Request): usage.ReplaceUsageAdvisoryThresholdsInput {
  const body = req.body;
  const keys = [
    "expected_revision",
    "request_count",
    "total_tokens",
    "reported_cost_amount",
    "cache_read_tokens",
    "cache_write_tokens",
  ];
  if (!body || typeof body !== "object" || Array.isArray(body)
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(body, key))
    || Object.keys(body).some((key) => !keys.includes(key))) {
    throw new usage.UsageError("INVALID_USAGE_THRESHOLD_INPUT");
  }
  return {
    expectedRevision: body.expected_revision,
    requestCount: body.request_count,
    totalTokens: body.total_tokens,
    reportedCostAmount: body.reported_cost_amount,
    cacheReadTokens: body.cache_read_tokens,
    cacheWriteTokens: body.cache_write_tokens,
  };
}

function integerQuery(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new usage.UsageError("INVALID_USAGE_QUERY");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new usage.UsageError("INVALID_USAGE_QUERY");
  }
  return parsed;
}

function eventDto(event: usage.UsageEvent) {
  return {
    id: event.id,
    sourceInstance: event.sourceInstance,
    sourcePartId: event.sourcePartId,
    sourceSessionId: event.sourceSessionId,
    sourceMessageId: event.sourceMessageId,
    sourceProjectId: event.sourceProjectId,
    providerId: event.providerId,
    modelId: event.modelId,
    agentId: event.agentId,
    status: event.status,
    occurredAt: event.occurredAt,
    tokens: {
      total: event.totalTokens,
      input: event.inputTokens,
      output: event.outputTokens,
      reasoning: event.reasoningTokens,
    },
    cache: { read: event.cacheReadTokens, write: event.cacheWriteTokens },
    cost: { amount: event.costAmount, availability: event.costStatus },
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

function mappingDto(mapping: usage.UsageProjectMapping) {
  return {
    sourceInstance: mapping.sourceInstance,
    opencodeProjectId: mapping.sourceProjectId,
    status: mapping.status,
    firstSeenAt: mapping.firstSeenAt,
    lastSeenAt: mapping.lastSeenAt,
  };
}

function thresholdsDto(thresholds: usage.UsageAdvisoryThresholds) {
  return {
    requestCount: thresholds.requestCount,
    totalTokens: thresholds.totalTokens,
    reportedCostAmount: thresholds.reportedCostAmount,
    cacheReadTokens: thresholds.cacheReadTokens,
    cacheWriteTokens: thresholds.cacheWriteTokens,
    revision: thresholds.revision,
    createdAt: thresholds.createdAt,
    updatedAt: thresholds.updatedAt,
  };
}

function advisoryEvaluationDto(evaluation: usage.UsageAdvisoryEvaluation) {
  return {
    range: evaluation.range,
    generatedAt: evaluation.generatedAt,
    thresholds: thresholdsDto(evaluation.thresholds),
    metrics: evaluation.metrics,
  };
}

function attentionDto(item: usage.UsageAttentionItem) {
  return {
    id: item.id,
    condition: item.condition,
    metric: item.metric,
    status: item.status,
    evaluationState: item.evaluationState,
    severity: item.severity,
    messageCode: item.messageCode,
    observed: item.observed,
    threshold: item.threshold,
    availability: item.availability,
    freshness: item.freshness,
    range: item.range,
    thresholdRevision: item.thresholdRevision,
    openedAt: item.openedAt,
    acknowledgedAt: item.acknowledgedAt,
    resolvedAt: item.resolvedAt,
    reopenedAt: item.reopenedAt,
    reopenCount: item.reopenCount,
    lastEvaluatedAt: item.lastEvaluatedAt,
    revision: item.revision,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function attentionListOptions(req: Request): { includeResolved: boolean; limit: number; cursor?: string } {
  const includeResolved = req.query.include_resolved;
  if (includeResolved !== undefined && includeResolved !== "true" && includeResolved !== "false") {
    throw new usage.UsageError("INVALID_USAGE_QUERY");
  }
  if (req.query.cursor !== undefined && typeof req.query.cursor !== "string") {
    throw new usage.UsageError("INVALID_USAGE_QUERY");
  }
  return {
    includeResolved: includeResolved === "true",
    limit: integerQuery(req.query.limit, 50, usage.USAGE_ATTENTION_PAGE_MAX),
    cursor: req.query.cursor as string | undefined,
  };
}

function requireAttentionEvaluateRequest(req: Request): void {
  // express.json() normalizes an absent body to `{}` in some configurations.
  // Accept only that transport artifact when the request has no payload bytes.
  const bodyAbsent = req.body === undefined || (
    req.body !== null
    && typeof req.body === "object"
    && !Array.isArray(req.body)
    && Object.keys(req.body).length === 0
    && (req.get("content-length") === undefined || req.get("content-length") === "0")
  );
  if (!bodyAbsent || Object.keys(req.query).some((key) => key !== "project")) {
    throw new usage.UsageError("INVALID_USAGE_QUERY");
  }
}

function attentionAcknowledgement(req: Request): number {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).length !== 1
    || !Object.prototype.hasOwnProperty.call(body, "expected_revision")) {
    throw new usage.UsageError("INVALID_USAGE_INPUT");
  }
  return body.expected_revision;
}

function csvCell(value: string | number | null): string {
  const text = value === null ? "" : String(value);
  const spreadsheetSafe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${spreadsheetSafe.replace(/"/g, '""')}"`;
}

usageRouter.get("/summary", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    res.json({ data: usage.getUsageSummary(projectId, usageQuery(req)) });
  } catch (error) {
    sendUsageError(res, error);
  }
});

usageRouter.get("/thresholds", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    res.json({ data: thresholdsDto(usage.getUsageAdvisoryThresholds(projectId)) });
  } catch (error) {
    sendUsageError(res, error);
  }
});

// PUT replaces all five fields; PATCH is intentionally not exposed to avoid merge ambiguity.
usageRouter.put("/thresholds", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const thresholds = usage.replaceUsageAdvisoryThresholds(projectId, thresholdReplacement(req));
    res.json({ data: thresholdsDto(thresholds) });
  } catch (error) {
    sendUsageError(res, error);
  }
});

usageRouter.get("/thresholds/evaluate", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    res.json({ data: advisoryEvaluationDto(usage.evaluateUsageAdvisoryThresholds(projectId, usageAdvisoryQuery(req))) });
  } catch (error) {
    sendUsageError(res, error);
  }
});

usageRouter.get("/attention", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const page = usage.listUsageAttentionItems(projectId, attentionListOptions(req));
    res.json({
      data: page.data.map(attentionDto),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, total: page.total },
    });
  } catch (error) {
    sendUsageError(res, error);
  }
});

usageRouter.post("/attention/evaluate", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    requireAttentionEvaluateRequest(req);
    const reconciliation = usage.reconcileUsageAttention(projectId, {
      syncIntervalMs: getUsageSyncInterval(),
    });
    res.json({
      data: {
        evaluatedAt: reconciliation.evaluatedAt,
        items: reconciliation.items.map(attentionDto),
      },
    });
  } catch (error) {
    sendUsageError(res, error);
  }
});

usageRouter.post("/attention/:id/acknowledge", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const item = usage.acknowledgeUsageAttentionItem(projectId, req.params.id, attentionAcknowledgement(req));
    res.json({ data: attentionDto(item) });
  } catch (error) {
    sendUsageError(res, error);
  }
});

usageRouter.get("/breakdown", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    res.json({ data: usage.getUsageBreakdown(projectId, usageQuery(req)) });
  } catch (error) {
    sendUsageError(res, error);
  }
});

usageRouter.get("/events", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const page = usage.listUsageEvents(projectId, usageQuery(req), {
      limit: integerQuery(req.query.limit, 50, usage.USAGE_EVENT_PAGE_MAX),
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
    });
    res.json({
      data: page.data.map(eventDto),
      pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore, total: page.total },
    });
  } catch (error) {
    sendUsageError(res, error);
  }
});

usageRouter.get("/export", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const page = usage.getUsageExportPage(projectId, usageQuery(req), {
      limit: integerQuery(req.query.limit, usage.USAGE_EXPORT_PAGE_MAX, usage.USAGE_EXPORT_PAGE_MAX),
      cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
    });
    const header = [
      "id", "occurred_at", "provider_id", "model_id", "agent_id", "status", "cost_amount", "cost_availability",
      "total_tokens", "input_tokens", "output_tokens", "reasoning_tokens", "cache_read_tokens", "cache_write_tokens",
      "source_instance", "source_part_id", "source_session_id", "source_message_id", "source_project_id",
    ];
    const rows = page.data.map((event) => [
      event.id, event.occurredAt, event.providerId, event.modelId, event.agentId, event.status, event.costAmount, event.costStatus,
      event.totalTokens, event.inputTokens, event.outputTokens, event.reasoningTokens, event.cacheReadTokens, event.cacheWriteTokens,
      event.sourceInstance, event.sourcePartId, event.sourceSessionId, event.sourceMessageId, event.sourceProjectId,
    ].map(csvCell).join(","));
    res.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=ingenium-usage.csv",
      "Cache-Control": "no-store",
      "X-Export-Truncated": String(page.hasMore),
      ...(page.nextCursor ? { "X-Export-Next-Cursor": page.nextCursor } : {}),
    });
    res.send(`${header.join(",")}\n${rows.join("\n")}\n`);
  } catch (error) {
    sendUsageError(res, error);
  }
});

usageRouter.get("/mappings", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    res.json({ data: usage.listOpenCodeProjectMappings(projectId).map(mappingDto) });
  } catch (error) {
    sendUsageError(res, error);
  }
});

usageRouter.put("/mappings", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const opencodeProjectId = req.body?.opencodeProjectId;
    if (typeof opencodeProjectId !== "string") throw new usage.UsageError("INVALID_USAGE_INPUT");
    const mapping = usage.mapOpenCodeProject(
      getOpenCodeUsageSourceInstance(),
      opencodeProjectId,
      projectId,
    );
    res.status(201).json({ data: mappingDto(mapping) });
  } catch (error) {
    sendUsageError(res, error);
  }
});

usageRouter.post("/sync", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const result = await syncUsageFromOpenCode({ projectId });
  if (result.alreadyRunning) {
    res.status(202).json({ data: { status: "already_running" } });
    return;
  }
  if (result.unavailable) {
    res.status(503).json({ error: { code: "OPENCODE_UNAVAILABLE", message: "Usage sync is temporarily unavailable." } });
    return;
  }
  const projectResult = result.projects.find((candidate) => candidate.projectId === projectId) ?? {
    projectId,
    sessionsSelected: 0,
    sessionsProcessed: 0,
    eventsUpserted: 0,
    errorCode: null,
  };
  res.json({ data: { ...projectResult, sessionsQuarantined: result.sessionsQuarantined } });
});
