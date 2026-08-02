import { Router, type NextFunction, type Request, type Response } from "express";
import { coordination, projects, type ContextMetadata, type CoordinationClaim, type CoordinationSession } from "ingenium-core";
import { z } from "zod";

/** Project-scoped COORD-101 transport boundary. Authentication is owned by api-server middleware. */
export const coordinationRouter = Router();

const opaqueId = z.string();
const positiveInteger = z.number().int().positive();
const nonnegativeInteger = z.number().int().nonnegative();
const projectQuerySchema = z.object({ project: z.string() }).strict();
const identityFields = {
  worktree_id: opaqueId,
  session_id: opaqueId,
  incarnation: positiveInteger,
};
const queryIdentityFields = {
  worktree_id: opaqueId,
  session_id: opaqueId,
  incarnation: z.string().regex(/^[1-9][0-9]*$/).transform(Number),
};
const leaseFields = {
  ...identityFields,
  expected_revision: nonnegativeInteger,
  fence: positiveInteger,
  ownership_token: z.string(),
};
const idempotencyField = { idempotency_key: z.string().optional() };

const registerSchema = z.object({
  ...identityFields,
  ownership_token: z.string(),
  ttl_ms: positiveInteger,
  ...idempotencyField,
}).strict();
const recoverSchema = z.object({
  ...leaseFields,
  next_ownership_token: z.string(),
  ttl_ms: positiveInteger,
  ...idempotencyField,
}).strict();
const updateSchema = z.object({
  ...leaseFields,
  snapshot: z.record(z.unknown()),
  snapshot_revision: nonnegativeInteger,
  current_task_id: z.string().nullable(),
  current_task_revision: nonnegativeInteger.nullable(),
  context_conversation_id: z.string().nullable(),
  context_revision: nonnegativeInteger.nullable(),
  ...idempotencyField,
}).strict();
const heartbeatSchema = z.object({
  ...leaseFields,
  ttl_ms: positiveInteger,
  ...idempotencyField,
}).strict();
const claimSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("path"), path: z.string() }).strict(),
  z.object({ kind: z.literal("tree"), path: z.string() }).strict(),
  z.object({ kind: z.literal("reserved"), name: z.enum(["@build", "@repository"]) }).strict(),
]);
const claimBatchSchema = z.object({
  ...leaseFields,
  claims: z.array(z.object({
    claim: claimSchema,
    baseline_sha256: z.string().nullable().optional(),
  }).strict()),
  ...idempotencyField,
}).strict();
const releaseSchema = z.object({
  ...leaseFields,
  claim_ids: z.array(z.string()),
  ...idempotencyField,
}).strict();
const closeSchema = z.object({
  ...leaseFields,
  ...idempotencyField,
}).strict();
const takeoverSchema = z.object({
  ...identityFields,
  expected_revision: nonnegativeInteger,
  fence: positiveInteger,
  next_ownership_token: z.string(),
  ttl_ms: positiveInteger,
  ...idempotencyField,
}).strict();
const snapshotQuerySchema = z.object({
  project: z.string(),
  ...queryIdentityFields,
}).strict();

type IdentityBody = Pick<z.infer<typeof registerSchema>, "worktree_id" | "session_id" | "incarnation">;
type LeaseBody = Pick<z.infer<typeof heartbeatSchema>,
  "worktree_id" | "session_id" | "incarnation" | "expected_revision" | "fence" | "ownership_token" | "idempotency_key"
>;
type MutationBody = { idempotency_key?: string };

function invalidInput(): never {
  throw new coordination.CoordinationError("INVALID_COORDINATION_INPUT");
}

function parseBody<Schema extends z.ZodTypeAny>(schema: Schema, req: Request): z.infer<Schema> {
  const result = schema.safeParse(req.body);
  if (!result.success) invalidInput();
  return result.data;
}

function parseQuery<Schema extends z.ZodTypeAny>(schema: Schema, req: Request): z.infer<Schema> {
  const result = schema.safeParse(req.query);
  if (!result.success) invalidInput();
  return result.data;
}

function projectId(projectName: string): string {
  if (!projects.isValidProjectName(projectName)) invalidInput();
  const project = projects.getProject(projectName);
  if (!project) throw new coordination.CoordinationError("PROJECT_NOT_FOUND");
  return project.id;
}

function idempotencyKey(req: Request, body: MutationBody): string {
  const headerKey = req.get("Idempotency-Key") ?? undefined;
  if (headerKey !== undefined && body.idempotency_key !== undefined && headerKey !== body.idempotency_key) {
    invalidInput();
  }
  const key = headerKey ?? body.idempotency_key;
  if (typeof key !== "string") invalidInput();
  return key;
}

function identity(body: IdentityBody) {
  return {
    worktreeId: body.worktree_id,
    sessionId: body.session_id,
    incarnation: body.incarnation,
  };
}

function lease(body: LeaseBody, req: Request) {
  return {
    ...identity(body),
    expectedRevision: body.expected_revision,
    fence: body.fence,
    ownershipToken: body.ownership_token,
    idempotencyKey: idempotencyKey(req, body),
  };
}

function sessionDto(session: coordination.CoordinationSessionMutationResult) {
  return {
    id: session.id,
    revision: session.revision,
    fence: session.fence,
    state: session.state,
    heartbeatAt: session.heartbeatAt,
    expiresAt: session.expiresAt,
    snapshotRevision: session.snapshotRevision,
    currentTaskId: session.currentTaskId,
    currentTaskRevision: session.currentTaskRevision,
    contextConversationId: session.contextConversationId,
    contextRevision: session.contextRevision,
    updatedAt: session.updatedAt,
  };
}

function statusSessionDto(session: CoordinationSession) {
  return {
    id: session.id,
    worktreeId: session.worktree_id,
    sessionId: session.session_id,
    incarnation: session.incarnation,
    revision: session.revision,
    fence: session.fence,
    state: session.state,
    heartbeatAt: session.heartbeat_at,
    expiresAt: session.expires_at,
    snapshotRevision: session.snapshot_revision,
    currentTaskId: session.current_task_id,
    currentTaskRevision: session.current_task_revision,
    contextConversationId: session.context_conversation_id,
    contextRevision: session.context_revision,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

function claimDto(claim: CoordinationClaim) {
  return {
    id: claim.id,
    kind: claim.kind,
    state: claim.state,
    createdAt: claim.created_at,
    updatedAt: claim.updated_at,
    releasedAt: claim.released_at,
  };
}

function sendCoordinationError(res: Response, error: unknown): boolean {
  if (!(error instanceof coordination.CoordinationError)) return false;
  const statusByCode: Record<coordination.CoordinationErrorCode, number> = {
    INVALID_COORDINATION_INPUT: 422,
    PROJECT_NOT_FOUND: 404,
    SESSION_NOT_FOUND: 404,
    CLAIM_NOT_FOUND: 404,
    POINTER_NOT_FOUND: 404,
    SESSION_IDENTITY_CONFLICT: 409,
    SESSION_CLOSED: 409,
    SESSION_NOT_ACTIVE: 409,
    SESSION_EXPIRED: 409,
    REVISION_CONFLICT: 409,
    FENCE_CONFLICT: 409,
    OWNERSHIP_TOKEN_MISMATCH: 409,
    IDEMPOTENCY_KEY_REUSED: 409,
    CLAIM_CONFLICT: 409,
    CLAIM_NOT_OWNED: 409,
    POINTER_REVISION_CONFLICT: 409,
    COORDINATION_INTEGRITY_ERROR: 500,
  };
  const messageByCode: Record<coordination.CoordinationErrorCode, string> = {
    INVALID_COORDINATION_INPUT: "Invalid coordination request",
    PROJECT_NOT_FOUND: "Project not found",
    SESSION_NOT_FOUND: "Coordination session not found",
    CLAIM_NOT_FOUND: "Coordination claim not found",
    POINTER_NOT_FOUND: "Referenced coordination pointer was not found",
    SESSION_IDENTITY_CONFLICT: "Coordination session identity already exists",
    SESSION_CLOSED: "Coordination session is closed",
    SESSION_NOT_ACTIVE: "Coordination session is not active",
    SESSION_EXPIRED: "Coordination session has expired",
    REVISION_CONFLICT: "Coordination session changed since the requested revision",
    FENCE_CONFLICT: "Coordination session fence does not match",
    OWNERSHIP_TOKEN_MISMATCH: "Coordination session ownership does not match",
    IDEMPOTENCY_KEY_REUSED: "Idempotency key was already used with a different request",
    CLAIM_CONFLICT: "Coordination claim conflicts with current state",
    CLAIM_NOT_OWNED: "Coordination claim is not owned by this session",
    POINTER_REVISION_CONFLICT: "Referenced coordination pointer changed since the requested revision",
    COORDINATION_INTEGRITY_ERROR: "Coordination integrity verification failed",
  };
  res.status(statusByCode[error.code]).json({
    error: {
      code: error.code,
      message: messageByCode[error.code],
      ...(error.code === "REVISION_CONFLICT" && error.currentRevision !== undefined
        ? { currentRevision: error.currentRevision }
        : {}),
    },
  });
  return true;
}

function route(action: (req: Request, res: Response) => void) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      action(req, res);
    } catch (error) {
      if (!sendCoordinationError(res, error)) next(error);
    }
  };
}

coordinationRouter.post("/register", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(registerSchema, req);
  const session = coordination.registerCoordinationSession(projectId(query.project), {
    ...identity(body),
    ownershipToken: body.ownership_token,
    ttlMs: body.ttl_ms,
    idempotencyKey: idempotencyKey(req, body),
  });
  res.status(201).json({ data: { session: sessionDto(session) } });
}));

coordinationRouter.post("/recover", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(recoverSchema, req);
  const session = coordination.recoverCoordinationSession(projectId(query.project), {
    ...lease(body, req),
    nextOwnershipToken: body.next_ownership_token,
    ttlMs: body.ttl_ms,
  });
  res.json({ data: { session: sessionDto(session) } });
}));

coordinationRouter.patch("/update", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(updateSchema, req);
  const session = coordination.updateCoordinationSnapshot(projectId(query.project), {
    ...lease(body, req),
    snapshot: body.snapshot as ContextMetadata,
    snapshotRevision: body.snapshot_revision,
    currentTaskId: body.current_task_id,
    currentTaskRevision: body.current_task_revision,
    contextConversationId: body.context_conversation_id,
    contextRevision: body.context_revision,
  });
  res.json({ data: { session: sessionDto(session) } });
}));

coordinationRouter.post("/heartbeat", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(heartbeatSchema, req);
  const session = coordination.heartbeatCoordinationSession(projectId(query.project), {
    ...lease(body, req),
    ttlMs: body.ttl_ms,
  });
  res.json({ data: { session: sessionDto(session) } });
}));

coordinationRouter.get("/snapshot", route((req, res) => {
  const query = parseQuery(snapshotQuerySchema, req);
  const status = coordination.getCoordinationStatus(projectId(query.project), {
    worktreeId: query.worktree_id,
    sessionId: query.session_id,
    incarnation: query.incarnation,
  });
  if (!status) throw new coordination.CoordinationError("SESSION_NOT_FOUND");
  const claims = status.claims.map(claimDto);
  res.json({
    data: {
      session: statusSessionDto(status.session),
      claims,
      claimCount: claims.length,
      claimsTruncated: status.claimsTruncated,
    },
  });
}));

coordinationRouter.post("/claims/batch", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(claimBatchSchema, req);
  const result = coordination.claimCoordinationBatch(projectId(query.project), {
    ...lease(body, req),
    claims: body.claims.map(({ claim, baseline_sha256 }) => ({
      claim,
      ...(baseline_sha256 === undefined ? {} : { baselineSha256: baseline_sha256 }),
    })),
  });
  res.json({ data: { session: sessionDto(result.session), claimIds: result.claimIds } });
}));

coordinationRouter.post("/claims/release", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(releaseSchema, req);
  const result = coordination.releaseCoordinationClaims(projectId(query.project), {
    ...lease(body, req),
    claimIds: body.claim_ids,
  });
  res.json({ data: { session: sessionDto(result.session), claimIds: result.claimIds } });
}));

coordinationRouter.post("/close", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(closeSchema, req);
  const session = coordination.closeCoordinationSession(projectId(query.project), lease(body, req));
  res.json({ data: { session: sessionDto(session) } });
}));

coordinationRouter.post("/takeover", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(takeoverSchema, req);
  const result = coordination.authorizedTakeoverCoordinationSession(projectId(query.project), {
    ...identity(body),
    expectedRevision: body.expected_revision,
    fence: body.fence,
    nextOwnershipToken: body.next_ownership_token,
    ttlMs: body.ttl_ms,
    idempotencyKey: idempotencyKey(req, body),
  });
  res.json({ data: { session: sessionDto(result), takeoverEvidenceId: result.takeoverEvidenceId } });
}));
