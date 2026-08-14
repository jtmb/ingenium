import { Router, type Request, type Response } from "express";
import { authorization, context, contextConversations, contextRag, getDb } from "ingenium-core";
import { requestAuthorizationPrincipal, requestContentActor, requireContentAccess, requireProject } from "../helpers.js";
import { executeSynthesisBroker } from "../opencode-client.js";

/**
 * Context routes retain the mutable entry compatibility surface and add the
 * canonical immutable conversation/checkpoint APIs. Conversation list/search
 * responses deliberately omit message content; retrieve endpoints are explicit.
 */
export const contextRouter = Router();

function sendConversationError(res: Response, error: unknown): void {
  if (!(error instanceof contextConversations.ContextConversationError)) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to process context conversation" } });
    return;
  }
  const statusByCode: Record<contextConversations.ContextConversationErrorCode, number> = {
    INVALID_CONTEXT_INPUT: 422,
    INVALID_CURSOR: 422,
    CONVERSATION_NOT_FOUND: 404,
    MESSAGE_NOT_FOUND: 404,
    CHECKPOINT_NOT_FOUND: 404,
    RAG_SOURCE_NOT_FOUND: 404,
    NO_MESSAGES: 409,
    REVISION_CONFLICT: 409,
    IDEMPOTENCY_KEY_REUSED: 409,
    CHECKPOINT_INTEGRITY_FAILED: 409,
    CONVERSATION_ARCHIVED: 409,
    CONVERSATION_ALREADY_ARCHIVED: 409,
    CONVERSATION_NOT_ARCHIVED: 409,
    MAINTENANCE_AUTHORIZATION_INVALID: 409,
  };
  const messageByCode: Record<contextConversations.ContextConversationErrorCode, string> = {
    INVALID_CONTEXT_INPUT: "Invalid immutable context request",
    INVALID_CURSOR: "Invalid pagination cursor",
    CONVERSATION_NOT_FOUND: "Context conversation not found",
    MESSAGE_NOT_FOUND: "Context message not found",
    CHECKPOINT_NOT_FOUND: "Context checkpoint not found",
    RAG_SOURCE_NOT_FOUND: "Referenced source not found",
    NO_MESSAGES: "A checkpoint requires at least one message",
    REVISION_CONFLICT: "Conversation changed since the requested revision",
    IDEMPOTENCY_KEY_REUSED: "Idempotency key was already used with a different request",
    CHECKPOINT_INTEGRITY_FAILED: "Checkpoint integrity validation failed",
    CONVERSATION_ARCHIVED: "Archived conversations cannot receive new messages or checkpoints",
    CONVERSATION_ALREADY_ARCHIVED: "Context conversation is already archived",
    CONVERSATION_NOT_ARCHIVED: "Context conversation is not archived",
    MAINTENANCE_AUTHORIZATION_INVALID: "Maintenance confirmation is invalid, expired, or already used",
  };
  res.status(statusByCode[error.code]).json({
    error: {
      code: error.code,
      message: messageByCode[error.code],
      ...(error.currentRevision === undefined ? {} : { currentRevision: error.currentRevision }),
    },
  });
}

function mutationInput(req: Request): Record<string, unknown> {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  const headerKey = req.get("Idempotency-Key");
  const bodyKey = body.idempotencyKey;
  if (headerKey !== undefined && bodyKey !== undefined && headerKey !== bodyKey) {
    throw new contextConversations.ContextConversationError("INVALID_CONTEXT_INPUT");
  }
  return { ...body, ...(headerKey === undefined ? {} : { idempotencyKey: headerKey }) };
}

function listOptions(req: Request): { limit?: number; cursor?: string } {
  const rawLimit = req.query.limit;
  return {
    ...(rawLimit === undefined ? {} : { limit: Number(rawLimit) }),
    ...(req.query.cursor === undefined ? {} : { cursor: req.query.cursor as string }),
  };
}

function contextOwnerScope(req: Request): string | null | undefined {
  if (!req.authorizationPolicy) return undefined;
  const principal = requestAuthorizationPrincipal(req);
  return principal.type === "browser-user" || principal.type === "user-token" ? principal.id : null;
}

function maintenanceProvenance(req: Request): contextConversations.ContextMaintenanceProvenance {
  const principal = req.principal;
  return {
    actorType: principal?.type === "runtime-service" ? "system" : principal?.type ?? "compatibility",
    actorId: principal?.id ?? null,
    requestId: req.get("x-request-id") ?? null,
    correlationId: req.get("x-correlation-id") ?? null,
  };
}

function sendContextRagError(res: Response, error: unknown): void {
  if (!(error instanceof contextRag.ContextRagError)) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to process context RAG data" } });
    return;
  }
  const statusByCode: Record<contextRag.ContextRagErrorCode, number> = {
    INVALID_CONTEXT_RAG_INPUT: 422,
    UPLOAD_NOT_FOUND: 404,
    UPLOAD_NOT_PENDING: 409,
    UPLOAD_CHUNK_CONFLICT: 409,
    UPLOAD_INCOMPLETE: 409,
    UPLOAD_HASH_MISMATCH: 422,
    UPLOAD_SIZE_MISMATCH: 413,
    IDEMPOTENCY_KEY_REUSED: 409,
    CHECKPOINT_RAG_SOURCE_NOT_FOUND: 404,
    CONTENT_SCOPE_CONFLICT: 409,
    LEARNING_NO_INPUT: 409,
  };
  const messageByCode: Record<contextRag.ContextRagErrorCode, string> = {
    INVALID_CONTEXT_RAG_INPUT: "Invalid context RAG request",
    UPLOAD_NOT_FOUND: "Context upload was not found",
    UPLOAD_NOT_PENDING: "Context upload is not pending",
    UPLOAD_CHUNK_CONFLICT: "A different chunk already exists at this position",
    UPLOAD_INCOMPLETE: "All declared chunks are required before completion",
    UPLOAD_HASH_MISMATCH: "Uploaded content does not match its declared hash",
    UPLOAD_SIZE_MISMATCH: "Uploaded content exceeds the declared or allowed size",
    IDEMPOTENCY_KEY_REUSED: "Idempotency key was already used with a different request",
    CHECKPOINT_RAG_SOURCE_NOT_FOUND: "Checkpoint RAG source was not found",
    CONTENT_SCOPE_CONFLICT: "Matching content exists outside the authenticated content scope",
    LEARNING_NO_INPUT: "No current learning input is available",
  };
  res.status(statusByCode[error.code]).json({
    error: { code: error.code, message: messageByCode[error.code] },
  });
}

function contextRagUploadDto(result: contextRag.ContextRagUploadResult) {
  const { upload } = result;
  const source = contextRag.getContextRagSource(upload.project_id, upload.rag_source_id);
  if (!source) throw new Error("Context RAG source disappeared after ingestion");
  return {
    upload: {
      id: upload.id,
      contentHash: upload.content_hash,
      provenance: upload.provenance,
      sourceReference: upload.source_reference,
      createdAt: upload.created_at,
    },
    source,
    deduplicated: result.deduplicated,
  };
}

function contextRagSourceCreateDto(result: contextRag.ContextRagUploadResult) {
  const source = contextRag.getContextRagSource(result.upload.project_id, result.upload.rag_source_id);
  if (!source) throw new Error("Context RAG source disappeared after ingestion");
  return { ...source, deduplicated: result.deduplicated };
}

function requireContextSource(req: Request, res: Response, projectId: string, sourceId: string): boolean {
  const source = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT id, organization_id, project_id, visibility, owner_user_id FROM rag_sources WHERE id = ? AND project_id = ?",
  ).get(sourceId, projectId) as { id: string; organization_id: string; project_id: string; visibility: "organization" | "project" | "restricted"; owner_user_id: string | null } | undefined;
  if (!source) return false;
  return requireContentAccess(req, res, {
    resourceType: "rag_source", resourceId: source.id,
    organizationId: source.organization_id, projectId: source.project_id,
    visibility: source.visibility, ownerUserId: source.owner_user_id,
  });
}

function requireContextUpload(req: Request, res: Response, projectId: string, uploadId: string): boolean {
  const upload = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    "SELECT id, organization_id, project_id, visibility, owner_user_id FROM context_rag_upload_sessions WHERE id = ? AND project_id = ?",
  ).get(uploadId, projectId) as { id: string; organization_id: string; project_id: string; visibility: "organization" | "project" | "restricted"; owner_user_id: string | null } | undefined;
  if (!upload) {
    res.status(404).json({ error: { code: "UPLOAD_NOT_FOUND", message: "Context upload was not found" } });
    return false;
  }
  return requireContentAccess(req, res, {
    resourceType: "rag_source", resourceId: upload.id,
    organizationId: upload.organization_id, projectId: upload.project_id,
    visibility: upload.visibility, ownerUserId: upload.owner_user_id,
  });
}

function checkpointForProject(
  projectId: string,
  conversationId: string,
  checkpointId: string,
): contextConversations.ContextCheckpointDetail | null {
  return contextConversations.getContextCheckpoint(projectId, conversationId, checkpointId) ?? null;
}

contextRouter.post("/uploads", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const actor = requestContentActor(req, projectId);
    const result = contextRag.ingestContextRagDocument(projectId, {
      ...(req.body ?? {}), organizationId: actor?.organizationId,
      ownerUserId: actor?.ownerUserId, visibility: actor?.ownerUserId ? "restricted" : "project",
    });
    res.status(result.deduplicated ? 200 : 201).json({ data: contextRagUploadDto(result) });
  } catch (error) {
    sendContextRagError(res, error);
  }
});

// Source-oriented alias: retains the immutable upload lifecycle while exposing
// only the safe source DTO.
contextRouter.post("/sources", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const actor = requestContentActor(req, projectId);
    const result = contextRag.ingestContextRagDocument(projectId, {
      ...(req.body ?? {}), organizationId: actor?.organizationId,
      ownerUserId: actor?.ownerUserId, visibility: actor?.ownerUserId ? "restricted" : "project",
    });
    res.status(result.deduplicated ? 200 : 201).json({ data: contextRagSourceCreateDto(result) });
  } catch (error) {
    sendContextRagError(res, error);
  }
});

contextRouter.post("/uploads/chunked", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const body = mutationInput(req);
    const actor = requestContentActor(req, projectId);
    const result = contextRag.createContextRagUploadSession(projectId, {
      ...body, organizationId: actor?.organizationId,
      ownerUserId: actor?.ownerUserId, visibility: actor?.ownerUserId ? "restricted" : "project",
    });
    if (result.upload && result.source) {
      res.status(200).json({ data: { ...contextRagUploadDto({ upload: result.upload, source: result.source, deduplicated: true }), session: null } });
      return;
    }
    res.status(result.session?.status === "pending" ? 201 : 200).json({
      data: {
        session: result.session && {
          id: result.session.id,
          expectedHash: result.session.expected_hash,
          expectedBytes: result.session.expected_bytes,
          chunkCount: result.session.chunk_count,
          sourceReference: result.session.source_reference,
          status: result.session.status,
          createdAt: result.session.created_at,
          completedAt: result.session.completed_at,
        },
        deduplicated: result.deduplicated,
      },
    });
  } catch (error) {
    sendContextRagError(res, error);
  }
});

contextRouter.post("/uploads/:uploadId/chunks", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!requireContextUpload(req, res, projectId, req.params.uploadId!)) return;
  try {
    const result = contextRag.appendContextRagUploadChunk(projectId, req.params.uploadId!, req.body ?? {});
    res.status(result.idempotent ? 200 : 201).json({
      data: { uploadId: result.session.id, ordinal: req.body?.ordinal, idempotent: result.idempotent },
    });
  } catch (error) {
    sendContextRagError(res, error);
  }
});

contextRouter.post("/uploads/:uploadId/complete", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!requireContextUpload(req, res, projectId, req.params.uploadId!)) return;
  try {
    const result = contextRag.completeContextRagUpload(projectId, req.params.uploadId!);
    res.json({ data: contextRagUploadDto(result) });
  } catch (error) {
    sendContextRagError(res, error);
  }
});

contextRouter.get("/uploads", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const page = contextRag.listContextRagUploads(projectId, Number(req.query.limit) || 20, Number(req.query.offset) || 0, contextOwnerScope(req));
  res.json({
    data: page.data.map(contextRagUploadDto),
    total: page.total,
    limit: page.limit,
    offset: page.offset,
  });
});

contextRouter.get("/sources", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const page = contextRag.listContextRagSources(projectId, Number(req.query.limit) || 20, Number(req.query.offset) || 0, contextOwnerScope(req));
  res.json(page);
});

function searchContextSources(req: Request, res: Response): void {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const result = contextRag.searchContextRag(
      projectId,
      typeof req.query.q === "string" ? req.query.q : "",
      req.query.limit === undefined ? 20 : Number(req.query.limit),
      contextOwnerScope(req),
    );
    res.json({ data: result.citations, total: result.citations.length });
  } catch (error) {
    sendContextRagError(res, error);
  }
}

function searchContextSourceMetadata(req: Request, res: Response): void {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const results = contextRag.searchContextRagResults(
      projectId,
      typeof req.query.q === "string" ? req.query.q : "",
      req.query.limit === undefined ? 20 : Number(req.query.limit),
      contextOwnerScope(req),
    );
    const seen = new Set<string>();
    const sources = results.flatMap((hit) => {
      if (seen.has(hit.source_id)) return [];
      seen.add(hit.source_id);
      const source = contextRag.getContextRagSource(projectId, hit.source_id);
      return source ? [source] : [];
    });
    res.json({ data: sources, total: sources.length });
  } catch (error) {
    sendContextRagError(res, error);
  }
}

contextRouter.get("/sources/search", searchContextSourceMetadata);

contextRouter.get("/sources/summary", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const page = contextRag.listContextRagSources(projectId, Number(req.query.limit) || 20, Number(req.query.offset) || 0, contextOwnerScope(req));
  res.json({
    ...page,
    data: page.data.map(({ id, title, provenance, createdAt }) => ({ id, title, provenance, createdAt })),
  });
});

contextRouter.get("/sources/:sourceId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const source = contextRag.getContextRagSource(projectId, req.params.sourceId!);
  if (!source || !requireContextSource(req, res, projectId, req.params.sourceId!)) {
    if (res.headersSent) return;
    res.status(404).json({ error: { code: "CONTEXT_SOURCE_NOT_FOUND", message: "Context source not found" } });
    return;
  }
  res.json({ data: source });
});

contextRouter.get("/rag/search", searchContextSources);

contextRouter.post("/rag/ask", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const question = req.body?.question;
    const result = contextRag.searchContextRag(projectId, question, 10, contextOwnerScope(req));
    if (result.results.length === 0) {
      res.json({ data: { answer: "I don't have enough context to answer that question.", citations: [] } });
      return;
    }
    const prompt = result.results.map((entry, index) => {
      const title = entry.source_name || `Source ${entry.source_id.slice(0, 8)}`;
      const heading = entry.heading_path ? ` [Section: ${entry.heading_path}]` : "";
      return `[${index + 1}] (${title}${heading}): ${entry.content.slice(0, 8_000)}`;
    }).join("\n\n");
    const broker = await executeSynthesisBroker({
      projectId,
      system: "Answer only from the supplied context. Cite sources using [1], [2].",
      user: `Context:\n${prompt}\n\nQuestion: ${question}\n\nAnswer with citations like [1], [2].`,
      timeoutMs: 30_000,
    });
    if (!broker.ok) {
      res.status(502).json({ error: { code: "LLM_FAILED", message: "Unable to generate an answer right now. Please try again." } });
      return;
    }
    res.json({ data: { answer: broker.content, citations: result.citations } });
  } catch (error) {
    if (error instanceof contextRag.ContextRagError) {
      sendContextRagError(res, error);
      return;
    }
    res.status(500).json({ error: { code: "ASK_FAILED", message: "Context Q&A request failed" } });
  }
});

contextRouter.get("/learning/current", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const learning = contextRag.getCurrentLearningContext(projectId, Number(req.query.limit) || 20, contextOwnerScope(req));
  res.json({ data: learning });
});

contextRouter.post("/learning/ingest", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const result = contextRag.ingestCurrentLearningContext(projectId, req.body ?? {}, contextOwnerScope(req));
    if (result.noOp) {
      res.json({ data: { noOp: true, reason: result.reason, learning: result.learning } });
      return;
    }
    res.status(result.result!.deduplicated ? 200 : 201).json({
      data: { noOp: false, learning: result.learning, ...contextRagUploadDto(result.result!) },
    });
  } catch (error) {
    sendContextRagError(res, error);
  }
});

contextRouter.post("/conversations", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const actor = requestContentActor(req, projectId);
    const input = mutationInput(req);
    const conversation = contextConversations.createContextConversation(projectId, {
      ...input,
      organizationId: actor?.organizationId,
      ownerUserId: actor?.ownerUserId,
      visibility: input.visibility ?? (actor?.ownerUserId ? "private" : "project"),
    });
    res.status(201).json({ data: conversation });
  } catch (error) {
    sendConversationError(res, error);
  }
});

contextRouter.param("conversationId", (req, res, next, conversationId) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const conversation = contextConversations.getContextConversation(projectId, conversationId);
  if (!conversation) {
    res.status(404).json({ error: { code: "CONVERSATION_NOT_FOUND", message: "Context conversation not found" } });
    return;
  }
  if (!requireContentAccess(req, res, {
    resourceType: "context_conversation",
    resourceId: conversation.id,
    organizationId: conversation.organization_id,
    projectId: conversation.project_id,
    visibility: conversation.visibility,
    ownerUserId: conversation.owner_user_id,
  })) return;
  next();
});

// Preview is content-free and side-effect free. It never supplies an implicit
// retention policy: stale candidates require the caller's explicit cutoff.
contextRouter.post("/conversations/maintenance/preview", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const principal = requestAuthorizationPrincipal(req);
    const data = contextConversations.previewContextMaintenance(projectId, req.body ?? {}).filter((candidate) => {
      const conversation = contextConversations.getContextConversation(projectId, candidate.conversationId);
      return conversation && authorization.requireContentPermission(principal, {
        resourceType: "context_conversation", resourceId: conversation.id,
        organizationId: conversation.organization_id, projectId: conversation.project_id,
        visibility: conversation.visibility, ownerUserId: conversation.owner_user_id,
      }, req.authorizationPolicy?.permission ?? "read").allowed;
    });
    res.json({ data });
  } catch (error) {
    sendConversationError(res, error);
  }
});

contextRouter.get("/conversations", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const principal = requestAuthorizationPrincipal(req);
    const page = contextConversations.listContextConversations(projectId, listOptions(req));
    page.data = page.data.filter((conversation) => authorization.requireContentPermission(principal, {
      resourceType: "context_conversation", resourceId: conversation.id,
      organizationId: conversation.organization_id, projectId: conversation.project_id,
      visibility: conversation.visibility, ownerUserId: conversation.owner_user_id,
    }, req.authorizationPolicy?.permission ?? "read").allowed);
    res.json({ data: page });
  } catch (error) {
    sendConversationError(res, error);
  }
});

contextRouter.get("/conversations/:conversationId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const conversation = contextConversations.getContextConversation(projectId, req.params.conversationId!);
  if (!conversation) {
    res.status(404).json({ error: { code: "CONVERSATION_NOT_FOUND", message: "Context conversation not found" } });
    return;
  }
  res.json({ data: conversation });
});

// Authorization issues a short-lived, one-time confirmation capability. The
// raw token is returned only here and is never written to audit history.
contextRouter.post("/conversations/:conversationId/maintenance/authorize", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const authorization = contextConversations.authorizeContextMaintenanceAction(
      projectId,
      req.params.conversationId!,
      req.body ?? {},
      maintenanceProvenance(req),
    );
    res.status(201).json({ data: authorization });
  } catch (error) {
    sendConversationError(res, error);
  }
});

contextRouter.get("/conversations/:conversationId/maintenance/audit", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    res.json({ data: contextConversations.listContextCheckpointAuditEvents(projectId, {
      conversationId: req.params.conversationId!,
      limit,
    }) });
  } catch (error) {
    sendConversationError(res, error);
  }
});

contextRouter.post("/conversations/:conversationId/archive", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    res.json({ data: contextConversations.archiveContextConversation(projectId, req.params.conversationId!, req.body ?? {}) });
  } catch (error) {
    sendConversationError(res, error);
  }
});

contextRouter.post("/conversations/:conversationId/unarchive", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    res.json({ data: contextConversations.unarchiveContextConversation(projectId, req.params.conversationId!, req.body ?? {}) });
  } catch (error) {
    sendConversationError(res, error);
  }
});

contextRouter.post("/conversations/:conversationId/messages", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const result = contextConversations.appendContextMessage(projectId, req.params.conversationId!, mutationInput(req));
    res.status(201).json({
      data: {
        message: contextConversations.toContextMessageSummary(result.message),
        revision: result.revision,
        idempotent: result.idempotent,
      },
    });
  } catch (error) {
    sendConversationError(res, error);
  }
});

contextRouter.get("/conversations/:conversationId/messages", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    res.json({ data: contextConversations.listContextMessages(projectId, req.params.conversationId!, listOptions(req)) });
  } catch (error) {
    sendConversationError(res, error);
  }
});

contextRouter.get("/conversations/:conversationId/messages/search", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const query = req.query.q;
    const limit = req.query.limit === undefined ? undefined : Number(req.query.limit);
    res.json({ data: contextConversations.searchContextMessages(projectId, req.params.conversationId!, query as string, limit) });
  } catch (error) {
    sendConversationError(res, error);
  }
});

contextRouter.post("/conversations/:conversationId/messages/batch", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    res.json({ data: contextConversations.retrieveContextMessages(projectId, req.params.conversationId!, req.body?.messageIds) });
  } catch (error) {
    sendConversationError(res, error);
  }
});

// Retrieval is intentionally separate from list/search because it exposes content.
contextRouter.get("/conversations/:conversationId/messages/:messageId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const message = contextConversations.getContextMessage(projectId, req.params.conversationId!, req.params.messageId!);
  if (!message) {
    res.status(404).json({ error: { code: "MESSAGE_NOT_FOUND", message: "Context message not found" } });
    return;
  }
  res.json({ data: message });
});

contextRouter.post("/conversations/:conversationId/checkpoints", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const result = contextConversations.createContextCheckpoint(projectId, req.params.conversationId!, mutationInput(req));
    res.status(201).json({ data: result });
  } catch (error) {
    sendConversationError(res, error);
  }
});

contextRouter.get("/conversations/:conversationId/checkpoints", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    res.json({ data: contextConversations.listContextCheckpoints(projectId, req.params.conversationId!, listOptions(req)) });
  } catch (error) {
    sendConversationError(res, error);
  }
});

// Historical retrieval is constrained to source IDs frozen into this checkpoint.
// It deliberately bypasses global RAG fallback and only returns citations/snippets.
contextRouter.get("/conversations/:conversationId/checkpoints/:checkpointId/rag/search", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const checkpoint = checkpointForProject(projectId, req.params.conversationId!, req.params.checkpointId!);
  if (!checkpoint) {
    res.status(404).json({ error: { code: "CHECKPOINT_NOT_FOUND", message: "Context checkpoint not found" } });
    return;
  }
  try {
    const result = contextRag.searchContextCheckpointRag(
      projectId,
      checkpoint.checkpoint.id,
      typeof req.query.q === "string" ? req.query.q : "",
      req.query.limit === undefined ? 20 : Number(req.query.limit),
    );
    res.json({ data: result.citations, total: result.citations.length });
  } catch (error) {
    sendContextRagError(res, error);
  }
});

contextRouter.post("/conversations/:conversationId/checkpoints/:checkpointId/restore", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const result = contextConversations.restoreContextCheckpoint(
      projectId,
      req.params.conversationId!,
      req.params.checkpointId!,
      mutationInput(req),
    );
    res.status(result.idempotent ? 200 : 201).json({ data: result });
  } catch (error) {
    sendConversationError(res, error);
  }
});

contextRouter.get("/conversations/:conversationId/checkpoints/:checkpointId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const checkpoint = contextConversations.getContextCheckpoint(projectId, req.params.conversationId!, req.params.checkpointId!);
  if (!checkpoint) {
    res.status(404).json({ error: { code: "CHECKPOINT_NOT_FOUND", message: "Context checkpoint not found" } });
    return;
  }
  res.json({ data: checkpoint });
});

contextRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const page = context.listContext(projectId, Number(req.query.limit) || 20, Number(req.query.offset) || 0);
  res.json(page);
});

contextRouter.get("/search", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const query = req.query.q as string;
  if (!query) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "query (q) is required" } });
    return;
  }
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const results = context.searchContext(projectId, query, limit);
  res.json({ data: results, total: results.length });
});

contextRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const { content, tags, priority, sessionId, source, metadata } = req.body ?? {};
    const entry = context.createContext(projectId, { content, tags, priority, sessionId, source, metadata });
    res.status(201).json({ data: entry });
  } catch (error) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: error instanceof Error ? error.message : "Invalid context entry" } });
  }
});

contextRouter.post("/batch", (req, res) => {
  const projectId = requireProject(req, res); if (!projectId) return;
  const ids = req.body?.ids;
  if (!Array.isArray(ids)) { res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "ids must be an array" } }); return; }
  res.json({ data: context.getContextBatch(projectId, ids) });
});

contextRouter.get("/:id", (req, res) => {
  const projectId = requireProject(req, res); if (!projectId) return;
  const entry = context.getContext(projectId, Number(req.params.id));
  if (!entry) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Context entry not found" } }); return; }
  res.json({ data: entry });
});

contextRouter.patch("/:id", (req, res) => {
  const projectId = requireProject(req, res); if (!projectId) return;
  try {
    const entry = context.updateContext(projectId, Number(req.params.id), req.body ?? {});
    if (!entry) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Context entry not found" } }); return; }
    res.json({ data: entry });
  } catch (error) { res.status(422).json({ error: { code: "VALIDATION_ERROR", message: error instanceof Error ? error.message : "Invalid context entry" } }); }
});

contextRouter.delete("/:id", (req, res) => {
  const projectId = requireProject(req, res); if (!projectId) return;
  if (!context.deleteContext(projectId, Number(req.params.id))) { res.status(404).json({ error: { code: "NOT_FOUND", message: "Context entry not found" } }); return; }
  res.status(204).send();
});
