import { Router, type Request, type Response } from "express";
import { explicitMemory } from "ingenium-core";
import { requireProject } from "../helpers.js";

export const memoryRouter = Router();

const BODY_KEYS = {
  save: new Set(["operationId", "memoryId", "content", "tags", "visibility", "workspaceId"]),
  update: new Set(["operationId", "expectedVersion", "content", "tags", "visibility", "workspaceId"]),
  forget: new Set(["operationId", "expectedVersion", "visibility", "workspaceId"]),
} as const;

function sendMemoryError(res: Response, error: unknown): void {
  if (!(error instanceof explicitMemory.ExplicitMemoryError)) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Unable to process saved memory" } });
    return;
  }
  const statuses: Record<explicitMemory.ExplicitMemoryErrorCode, number> = {
    INVALID_MEMORY_INPUT: 422,
    MEMORY_SCOPE_NOT_FOUND: 404,
    MEMORY_NOT_FOUND: 404,
    MEMORY_CONFLICT: 409,
    VERSION_CONFLICT: 409,
    OPERATION_CONFLICT: 409,
  };
  const messages: Record<explicitMemory.ExplicitMemoryErrorCode, string> = {
    INVALID_MEMORY_INPUT: "Invalid saved-memory request",
    MEMORY_SCOPE_NOT_FOUND: "Saved memory scope not found",
    MEMORY_NOT_FOUND: "Saved memory not found",
    MEMORY_CONFLICT: "Saved memory identifier is already in use",
    VERSION_CONFLICT: "Saved memory changed since the requested version",
    OPERATION_CONFLICT: "Operation identifier was already used with a different request",
  };
  res.status(statuses[error.code]).json({
    error: {
      code: error.code,
      message: messages[error.code],
      ...(error.currentVersion === undefined ? {} : { currentVersion: error.currentVersion }),
    },
  });
}

function hasScope(req: Request, permission: "read" | "write" | "share"): boolean {
  const scopes = req.principal?.scopes ?? [];
  return scopes.some((scope) => scope === "*" || scope === "user:*" || scope === "memory:*"
    || scope === `memory:${permission}`
    || (permission === "read" && (scope === "memory:write" || scope === "memory:share")));
}

function body(req: Request, kind: keyof typeof BODY_KEYS): Record<string, unknown> {
  const value = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body as Record<string, unknown>
    : {};
  if (Object.keys(value).some((key) => !BODY_KEYS[kind].has(key))) {
    throw new explicitMemory.ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  const headerOperationId = req.get("Idempotency-Key");
  if (headerOperationId !== undefined && value.operationId !== undefined
    && headerOperationId !== value.operationId) {
    throw new explicitMemory.ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  return {
    ...value,
    ...(headerOperationId === undefined ? {} : { operationId: headerOperationId }),
  };
}

function requestedVisibility(req: Request, value: unknown): explicitMemory.ExplicitMemoryVisibility {
  const visibility = value ?? "private";
  if (visibility !== "private" && visibility !== "project") {
    throw new explicitMemory.ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  if (visibility === "project" && !hasScope(req, "share")) {
    throw new explicitMemory.ExplicitMemoryError("MEMORY_SCOPE_NOT_FOUND");
  }
  return visibility;
}

function requestedWorkspace(req: Request, input?: Record<string, unknown>): string {
  const candidate = input?.workspaceId ?? req.query.workspaceId;
  if (req.principal?.type === "service") {
    if (!req.principal.workspaceId || (candidate !== undefined && candidate !== req.principal.workspaceId)) {
      throw new explicitMemory.ExplicitMemoryError("MEMORY_SCOPE_NOT_FOUND");
    }
    return req.principal.workspaceId;
  }
  if (typeof candidate !== "string" || !candidate.trim() || candidate.length > 256) {
    throw new explicitMemory.ExplicitMemoryError("INVALID_MEMORY_INPUT");
  }
  return candidate;
}

function requireMemoryScope(
  req: Request,
  projectId: string,
  permission: "read" | "write",
  visibility: explicitMemory.ExplicitMemoryVisibility,
  input?: Record<string, unknown>,
): explicitMemory.ExplicitMemoryScope {
  if (!req.principal || !hasScope(req, permission)) {
    throw new explicitMemory.ExplicitMemoryError("MEMORY_SCOPE_NOT_FOUND");
  }
  const workspaceId = requestedWorkspace(req, input);
  if (req.principal.type === "user") {
    return explicitMemory.resolveExplicitMemoryScope({
      projectId,
      workspaceId,
      principal: { type: "user", userId: req.principal.id },
      allowProjectVisibility: visibility === "project" && hasScope(req, "share"),
    });
  }
  if (req.principal.type !== "service" || !req.principal.tokenId || !req.principal.storageMappingHash
    || !req.attestedCoordinationIdentity
    || req.attestedCoordinationIdentity.credentialId !== req.principal.tokenId
    || req.attestedCoordinationIdentity.workspaceId !== workspaceId
    || req.attestedCoordinationIdentity.storageMappingHash !== req.principal.storageMappingHash) {
    throw new explicitMemory.ExplicitMemoryError("MEMORY_SCOPE_NOT_FOUND");
  }
  return explicitMemory.resolveExplicitMemoryScope({
    projectId,
    workspaceId,
    principal: {
      type: "service",
      servicePrincipalId: req.principal.id,
      credentialId: req.principal.tokenId,
      storageMappingHash: req.principal.storageMappingHash,
    },
    allowProjectVisibility: visibility === "project" && hasScope(req, "share"),
  });
}

function budget(req: Request): { maxItems?: number; maxTokens?: number; offset?: number } {
  return {
    ...(req.query.limit === undefined ? {} : { maxItems: Number(req.query.limit) }),
    ...(req.query.tokenBudget === undefined ? {} : { maxTokens: Number(req.query.tokenBudget) }),
    ...(req.query.offset === undefined ? {} : { offset: Number(req.query.offset) }),
  };
}

memoryRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const input = body(req, "save");
    const visibility = requestedVisibility(req, input.visibility);
    const scope = requireMemoryScope(req, projectId, "write", visibility, input);
    const result = explicitMemory.saveExplicitMemory(scope, {
      operationId: input.operationId as string,
      ...(input.memoryId === undefined ? {} : { memoryId: input.memoryId as string }),
      content: input.content as string,
      ...(input.tags === undefined ? {} : { tags: input.tags as string[] }),
      visibility,
    });
    if (!result.idempotent && result.memory) {
      const query = new URLSearchParams({ project: String(req.query.project), workspaceId: scope.workspaceId });
      if (visibility === "project") query.set("visibility", visibility);
      res.location(`/api/v1/memory/${result.memory.id}?${query}`);
    }
    res.status(result.idempotent ? 200 : 201).json({ data: result });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

memoryRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const visibility = requestedVisibility(req, req.query.visibility);
    const scope = requireMemoryScope(req, projectId, "read", visibility);
    res.json({ data: explicitMemory.listExplicitMemories(scope, visibility, budget(req)) });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

memoryRouter.get("/search", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    if (typeof req.query.q !== "string" || !req.query.q.trim()) {
      throw new explicitMemory.ExplicitMemoryError("INVALID_MEMORY_INPUT");
    }
    const visibility = requestedVisibility(req, req.query.visibility);
    const scope = requireMemoryScope(req, projectId, "read", visibility);
    res.json({ data: explicitMemory.searchExplicitMemories(scope, req.query.q, visibility, budget(req)) });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

memoryRouter.get("/operations/:operationId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const scope = requireMemoryScope(req, projectId, "read", "private");
    res.json({ data: explicitMemory.getExplicitMemoryOperationStatus(scope, req.params.operationId!) });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

memoryRouter.get("/:memoryId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const visibility = requestedVisibility(req, req.query.visibility);
    const scope = requireMemoryScope(req, projectId, "read", visibility);
    const result = explicitMemory.readExplicitMemory(scope, req.params.memoryId!, visibility);
    if (!result) {
      res.status(404).json({ error: { code: "MEMORY_NOT_FOUND", message: "Saved memory not found" } });
      return;
    }
    res.json({ data: result });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

memoryRouter.patch("/:memoryId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const input = body(req, "update");
    const visibility = requestedVisibility(req, input.visibility);
    const scope = requireMemoryScope(req, projectId, "write", visibility, input);
    const result = explicitMemory.updateExplicitMemory(scope, req.params.memoryId!, {
      operationId: input.operationId as string,
      expectedVersion: input.expectedVersion as number,
      content: input.content as string,
      ...(input.tags === undefined ? {} : { tags: input.tags as string[] }),
    });
    res.json({ data: result });
  } catch (error) {
    sendMemoryError(res, error);
  }
});

memoryRouter.delete("/:memoryId", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  try {
    const input = body(req, "forget");
    const visibility = requestedVisibility(req, input.visibility);
    const scope = requireMemoryScope(req, projectId, "write", visibility, input);
    const result = explicitMemory.forgetExplicitMemory(scope, req.params.memoryId!, {
      operationId: input.operationId as string,
      expectedVersion: input.expectedVersion as number,
    });
    res.json({ data: result });
  } catch (error) {
    sendMemoryError(res, error);
  }
});
