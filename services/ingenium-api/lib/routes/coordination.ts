import { Router, type NextFunction, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { coordination, projects, type ContextMetadata, type CoordinationSession } from "ingenium-core";
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
  client_claim_key: z.string(),
  claims: z.array(z.object({
    claim: claimSchema,
    baseline_sha256: z.string().nullable().optional(),
    current_sha256: z.string().nullable().optional(),
    repository_sha256: z.string().nullable().optional(),
  }).strict()),
  operation: z.enum(["write", "edit", "create", "delete", "rename", "apply_patch", "repository", "build"]).optional(),
  ...idempotencyField,
}).strict();
const releaseSchema = z.object({
  ...leaseFields,
  client_claim_key: z.string(),
  ...idempotencyField,
}).strict();
const claimProofSchema = releaseSchema.extend({ accepted_epoch: positiveInteger }).strict();
const renewClaimSchema = claimProofSchema.extend({ ttl_ms: positiveInteger }).strict();
const markClaimSchema = claimProofSchema.extend({ state: z.enum(["dirty", "quarantined", "collision"]) }).strict();
const footprintEntrySchema = z.object({
  path: z.string().optional(),
  path_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  before_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  after_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
}).strict();
const completeMutationSchema = claimProofSchema.extend({
  operation_id: z.string().uuid(),
  operation: z.enum(["write", "edit", "create", "delete", "rename", "apply_patch", "repository", "build"]),
  footprint: z.array(footprintEntrySchema).max(coordination.COORDINATION_MAX_CLAIMS_PER_MUTATION * 2),
}).strict();
const quarantineClaimSchema = claimProofSchema.extend({ code: z.enum(["uncertain_apply", "dirty_baseline"]).optional() }).strict();
const recoverEpochSchema = z.object({
  ...leaseFields,
  quarantined_session_id: opaqueId,
  quarantined_incarnation: positiveInteger,
  quarantined_fence: positiveInteger,
  quarantined_actor_id: z.string().regex(/^actor-[0-9a-f]{64}$/),
  accepted_epoch: positiveInteger,
  recovery_footprint_hash: z.string().regex(/^[0-9a-f]{64}$/),
  ...idempotencyField,
}).strict();
const closeSchema = z.object({
  ...leaseFields,
  ...idempotencyField,
}).strict();
const publishHandoffSchema = z.object({
  ...leaseFields,
  operation: z.enum(["write", "edit"]),
  path: z.string(),
  baseline_sha256: z.string().nullable().optional(),
  ...idempotencyField,
}).strict();
const consumeHandoffsSchema = z.object({
  ...leaseFields,
  limit: positiveInteger.optional(),
  ...idempotencyField,
}).strict();
const acknowledgeHandoffsSchema = z.object({
  ...leaseFields,
  through_sequence: nonnegativeInteger,
  ...idempotencyField,
}).strict();
const takeoverSchema = z.object({
  ...leaseFields,
  next_ownership_token: z.string(),
  ttl_ms: positiveInteger,
  ...idempotencyField,
}).strict();
const encodedPath = z.array(z.string().regex(/^[A-Za-z0-9_-]+$/)).min(1).max(128);
const operationalEntrySchema = z.object({
  status: z.enum(["active", "working", "idle", "completed", "error"]),
  actions: z.array(z.object({
    kind: z.enum(["read", "search", "write", "edit", "execute"]),
    result: z.literal("succeeded"),
    pathSegments: encodedPath.nullable(),
    targetHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  }).strict()).max(coordination.COORDINATION_MEMORY_ACTION_LIMIT),
  checks: z.array(z.object({
    kind: z.enum(["test", "typecheck", "lint", "build", "format", "security", "other"]),
    result: z.enum(["passed", "failed"]),
    targetHash: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict()).max(coordination.COORDINATION_MEMORY_CHECK_LIMIT),
  todos: z.object({
    total: nonnegativeInteger,
    pending: nonnegativeInteger,
    inProgress: nonnegativeInteger,
    completed: nonnegativeInteger,
    cancelled: nonnegativeInteger,
    state: z.enum(["none", "pending", "in_progress", "complete", "cancelled", "mixed"]),
  }).strict(),
  currentTaskId: z.string().regex(/^task-[0-9a-f]{64}$/).nullable(),
  changedPaths: z.array(z.object({
    pathSegments: encodedPath,
    operation: z.enum(["write", "edit"]),
    additions: nonnegativeInteger,
    deletions: nonnegativeInteger,
    changeRevision: positiveInteger,
  }).strict()).max(32),
  nextWork: z.object({
    kind: z.enum(["none", "continue_task", "review_changes", "run_checks", "address_failure"]),
    referenceHash: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  }).strict(),
}).strict();
const publishMemorySchema = z.object({
  ...leaseFields,
  entry: operationalEntrySchema,
  ...idempotencyField,
}).strict();
const readMemorySchema = z.object({
  ...leaseFields,
  limit: positiveInteger.optional(),
  ...idempotencyField,
}).strict();
const acknowledgeMemorySchema = z.object({
  ...leaseFields,
  through_revision: nonnegativeInteger,
  ...idempotencyField,
}).strict();
const snapshotQuerySchema = z.object({
  project: z.string(),
  ...queryIdentityFields,
}).strict();
const COORDINATION_OWNERSHIP_HEADER = "x-ingenium-coordination-ownership";

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

function ownedStatus(projectId: string, body: LeaseBody) {
  const status = coordination.getCoordinationStatus(projectId, {
    ...identity(body),
    ownershipToken: body.ownership_token,
  });
  if (!status) throw new coordination.CoordinationError("SESSION_NOT_FOUND");
  return status;
}

function lease(_projectId: string, body: LeaseBody, req: Request) {
  return {
    ...identity(body),
    expectedRevision: body.expected_revision,
    fence: body.fence,
    ownershipToken: body.ownership_token,
    idempotencyKey: idempotencyKey(req, body),
  };
}

function opaqueTaskId(value: string | null): string | null {
  return value === null || /^task-[0-9a-f]{64}$/.test(value)
    ? value
    : `task-${createHash("sha256").update(value).digest("hex")}`;
}

function requireBoundWorktree(req: Request, worktreeId: string): void {
  const principal = req.principal;
  if (principal?.type !== "service" || !principal.workspaceId || !principal.storageMappingHash
    || coordination.coordinationWorktreeId(principal.workspaceId, principal.storageMappingHash) !== worktreeId) {
    throw new coordination.CoordinationError("SESSION_NOT_FOUND");
  }
}

function sessionDto(session: coordination.CoordinationSessionMutationResult) {
  return {
    actorId: session.actorId,
    revision: session.revision,
    fence: session.fence,
    state: session.state,
    heartbeatAt: session.heartbeatAt,
    expiresAt: session.expiresAt,
    snapshotRevision: session.snapshotRevision,
    currentTaskId: opaqueTaskId(session.currentTaskId),
    currentTaskRevision: session.currentTaskRevision,
    contextConversationId: session.contextConversationId,
    contextRevision: session.contextRevision,
    updatedAt: session.updatedAt,
  };
}

function statusSessionDto(session: CoordinationSession) {
  return {
    actorId: coordination.coordinationActorId(session.session_id, session.incarnation),
    worktreeId: session.worktree_id,
    incarnation: session.incarnation,
    revision: session.revision,
    fence: session.fence,
    state: session.state,
    heartbeatAt: session.heartbeat_at,
    expiresAt: session.expires_at,
    snapshotRevision: session.snapshot_revision,
    currentTaskId: opaqueTaskId(session.current_task_id),
    currentTaskRevision: session.current_task_revision,
    contextConversationId: session.context_conversation_id,
    contextRevision: session.context_revision,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}

function claimMutationDto(result: coordination.CoordinationClaimMutationResult) {
  return {
    session: sessionDto(result.session),
    acceptedEpoch: result.acceptedEpoch,
    manifestGeneration: result.manifestGeneration,
    ...(result.operationId ? { operationId: result.operationId } : {}),
  };
}

function retainedSessionDto(session: CoordinationSession) {
  return sessionDto({
    id: session.id,
    actorId: coordination.coordinationActorId(session.session_id, session.incarnation),
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
    updatedAt: session.updated_at,
  });
}

function handoffDto(event: coordination.CoordinationHandoffEvent) {
  return {
    sequence: event.sequence,
    eventId: event.eventId,
    operation: event.operation,
    path: event.path,
    baselineSha256: event.baselineSha256,
    sourceActorId: event.sourceActorId,
    sourceIncarnation: event.sourceIncarnation,
    sourceRevision: event.sourceRevision,
    currentTaskId: event.currentTaskId,
    currentTaskRevision: event.currentTaskRevision,
    contextConversationId: event.contextConversationId,
    contextRevision: event.contextRevision,
    timestamp: event.timestamp,
  };
}

function peerSnapshotDto(peer: coordination.CoordinationPeerSnapshot) {
  return {
    peerId: peer.peerId,
    incarnation: peer.incarnation,
    sessionRevision: peer.sessionRevision,
    snapshotRevision: peer.snapshotRevision,
    status: peer.status,
    todos: peer.todos,
    changedPaths: peer.changedPaths,
    currentTaskId: peer.currentTaskId,
    contextRevision: peer.contextRevision,
    updatedAt: peer.updatedAt,
  };
}

function sendCoordinationError(res: Response, error: unknown): boolean {
  if (!(error instanceof coordination.CoordinationError)) return false;
  const responseCode = error.code === "OWNERSHIP_TOKEN_MISMATCH" ? "SESSION_NOT_FOUND" : error.code;
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
    CLAIM_KEY_REUSED: 409,
    CLAIM_NOT_OWNED: 409,
    EPOCH_QUARANTINED: 409,
    BASELINE_MISMATCH: 409,
    FOOTPRINT_MISMATCH: 409,
    MANIFEST_GENERATION_CONFLICT: 409,
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
    CLAIM_KEY_REUSED: "Coordination claim key was already used",
    CLAIM_NOT_OWNED: "Coordination claim is not owned by this session",
    EPOCH_QUARANTINED: "Coordination worktree epoch is quarantined",
    BASELINE_MISMATCH: "Coordination baseline does not match the accepted state",
    FOOTPRINT_MISMATCH: "Managed mutation footprint did not match its claims",
    MANIFEST_GENERATION_CONFLICT: "Repository manifest generation changed",
    POINTER_REVISION_CONFLICT: "Referenced coordination pointer changed since the requested revision",
    COORDINATION_INTEGRITY_ERROR: "Coordination integrity verification failed",
  };
  res.status(statusByCode[responseCode]).json({
    error: {
      code: responseCode,
      message: messageByCode[responseCode],
      ...(responseCode === "REVISION_CONFLICT" && error.currentRevision !== undefined
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
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const memory = coordination.ensureCoordinationMemory(resolvedProjectId, body.worktree_id);
  coordination.registerCoordinationSession(resolvedProjectId, {
    ...identity(body),
    ownershipToken: body.ownership_token,
    ttlMs: body.ttl_ms,
    idempotencyKey: idempotencyKey(req, body),
    contextConversationId: memory.id,
    contextRevision: memory.revision,
  });
  const session = coordination.getCoordinationStatus(resolvedProjectId, {
    ...identity(body),
    ownershipToken: body.ownership_token,
  })?.session;
  if (!session) throw new coordination.CoordinationError("COORDINATION_INTEGRITY_ERROR");
  const window = coordination.readCoordinationMemoryUpdates(resolvedProjectId, {
    ...identity(body),
    expectedRevision: session.revision,
    fence: session.fence,
    ownershipToken: body.ownership_token,
    idempotencyKey: idempotencyKey(req, body),
  }).memory;
  res.status(201).json({ data: { session: retainedSessionDto(session), memory: window } });
}));

coordinationRouter.post("/recover", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(recoverSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const session = coordination.recoverCoordinationSession(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    nextOwnershipToken: body.next_ownership_token,
    ttlMs: body.ttl_ms,
  });
  res.json({ data: { session: sessionDto(session) } });
}));

coordinationRouter.patch("/update", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(updateSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const current = ownedStatus(resolvedProjectId, body).session;
  const session = coordination.updateCoordinationSnapshot(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    snapshot: body.snapshot as ContextMetadata,
    snapshotRevision: body.snapshot_revision,
    currentTaskId: body.current_task_id,
    currentTaskRevision: body.current_task_revision,
    contextConversationId: current.context_conversation_id,
    contextRevision: current.context_revision,
  });
  res.json({ data: { session: sessionDto(session) } });
}));

coordinationRouter.post("/heartbeat", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(heartbeatSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const session = coordination.heartbeatCoordinationSession(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    ttlMs: body.ttl_ms,
  });
  res.json({ data: { session: sessionDto(session) } });
}));

coordinationRouter.get("/snapshot", route((req, res) => {
  const query = parseQuery(snapshotQuerySchema, req);
  requireBoundWorktree(req, query.worktree_id);
  const ownershipToken = req.get(COORDINATION_OWNERSHIP_HEADER);
  if (!coordination.isCoordinationOwnershipToken(ownershipToken)) {
    throw new coordination.CoordinationError("SESSION_NOT_FOUND");
  }
  const status = coordination.getCoordinationStatus(projectId(query.project), {
    worktreeId: query.worktree_id,
    sessionId: query.session_id,
    incarnation: query.incarnation,
    ownershipToken,
  });
  if (!status) throw new coordination.CoordinationError("SESSION_NOT_FOUND");
  const claims = status.claims;
  res.json({
    data: {
      session: statusSessionDto(status.session),
      claims,
      claimCount: claims.length,
      claimsTruncated: status.claimsTruncated,
      peers: status.peers.map(peerSnapshotDto),
    },
  });
}));

coordinationRouter.post("/claims/batch", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(claimBatchSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.claimCoordinationBatch(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    clientClaimKey: body.client_claim_key,
    claims: body.claims.map(({ claim, baseline_sha256, current_sha256, repository_sha256 }) => ({
      claim,
      ...(baseline_sha256 === undefined ? {} : { baselineSha256: baseline_sha256 }),
      ...(current_sha256 === undefined ? {} : { currentSha256: current_sha256 }),
      ...(repository_sha256 === undefined ? {} : { repositorySha256: repository_sha256 }),
    })),
    operation: body.operation,
  });
  res.json({ data: claimMutationDto(result) });
}));

coordinationRouter.post("/claims/release", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(releaseSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.releaseCoordinationClaims(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    clientClaimKey: body.client_claim_key,
  });
  res.json({ data: claimMutationDto(result) });
}));

coordinationRouter.post("/claims/verify", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(claimProofSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.verifyCoordinationClaims(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req), clientClaimKey: body.client_claim_key, acceptedEpoch: body.accepted_epoch,
  });
  res.json({ data: claimMutationDto(result) });
}));

coordinationRouter.post("/claims/renew", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(renewClaimSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.renewCoordinationClaims(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req), clientClaimKey: body.client_claim_key,
    acceptedEpoch: body.accepted_epoch, ttlMs: body.ttl_ms,
  });
  res.json({ data: claimMutationDto(result) });
}));

coordinationRouter.post("/claims/mark", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(markClaimSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.markCoordinationClaims(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req), clientClaimKey: body.client_claim_key, state: body.state,
  });
  res.json({ data: claimMutationDto(result) });
}));

coordinationRouter.post("/claims/quarantine", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(quarantineClaimSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.quarantineCoordinationClaims(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req), clientClaimKey: body.client_claim_key, acceptedEpoch: body.accepted_epoch,
  }, body.code);
  res.json({ data: claimMutationDto(result) });
}));

coordinationRouter.post("/claims/complete", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(completeMutationSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.completeManagedMutation(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req), clientClaimKey: body.client_claim_key,
    acceptedEpoch: body.accepted_epoch, operationId: body.operation_id, operation: body.operation,
    footprint: body.footprint.map((entry) => ({
      ...(entry.path === undefined ? {} : { path: entry.path }), pathSha256: entry.path_sha256,
      beforeSha256: entry.before_sha256, afterSha256: entry.after_sha256,
    })),
  });
  res.json({ data: claimMutationDto(result) });
}));

function epochRecoveryInput(
  resolvedProjectId: string,
  body: z.infer<typeof recoverEpochSchema>,
  req: Request,
): coordination.RecoverCoordinationEpochInput {
  return {
    ...lease(resolvedProjectId, body, req),
    quarantinedSessionId: body.quarantined_session_id,
    quarantinedIncarnation: body.quarantined_incarnation,
    quarantinedFence: body.quarantined_fence,
    quarantinedActorId: body.quarantined_actor_id,
    acceptedEpoch: body.accepted_epoch,
    recoveryFootprintHash: body.recovery_footprint_hash,
  };
}

coordinationRouter.post("/epoch/recovery-state", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(closeSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.getCoordinationEpochRecoveryState(resolvedProjectId, lease(resolvedProjectId, body, req));
  res.json({ data: result });
}));

coordinationRouter.post("/epoch/reconcile", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(recoverEpochSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.reconcileCoordinationEpoch(resolvedProjectId, epochRecoveryInput(resolvedProjectId, body, req));
  res.json({ data: claimMutationDto(result) });
}));

coordinationRouter.post("/epoch/recover", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(recoverEpochSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.recoverCoordinationEpoch(resolvedProjectId, epochRecoveryInput(resolvedProjectId, body, req));
  res.json({ data: claimMutationDto(result) });
}));

coordinationRouter.post("/close", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(closeSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const session = coordination.closeCoordinationSession(resolvedProjectId, lease(resolvedProjectId, body, req));
  res.json({ data: { session: sessionDto(session) } });
}));

coordinationRouter.post("/takeover", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(takeoverSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.authorizedTakeoverCoordinationSession(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    nextOwnershipToken: body.next_ownership_token,
    ttlMs: body.ttl_ms,
  });
  res.json({ data: { session: sessionDto(result), takeoverEvidenceId: result.takeoverEvidenceId } });
}));

coordinationRouter.post("/handoffs/publish", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(publishHandoffSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.publishCoordinationHandoff(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    operation: body.operation,
    path: body.path,
    baselineSha256: body.baseline_sha256,
  });
  res.status(201).json({ data: { session: sessionDto(result.session), event: handoffDto(result.event) } });
}));

coordinationRouter.post("/memory/publish", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(publishMemorySchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.publishCoordinationMemory(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    entry: body.entry,
  });
  res.status(201).json({ data: { session: sessionDto(result.session), memory: result.memory } });
}));

coordinationRouter.post("/memory/read", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(readMemorySchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.readCoordinationMemoryUpdates(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    limit: body.limit,
  });
  res.json({ data: { session: sessionDto(result.session), memory: result.memory } });
}));

coordinationRouter.post("/memory/ack", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(acknowledgeMemorySchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const session = coordination.acknowledgeCoordinationMemory(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    throughRevision: body.through_revision,
  });
  res.json({ data: { session: sessionDto(session) } });
}));

coordinationRouter.post("/handoffs/consume", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(consumeHandoffsSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.consumeCoordinationHandoffs(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    limit: body.limit,
  });
  res.json({ data: { session: sessionDto(result.session), events: result.events.map(handoffDto) } });
}));

coordinationRouter.post("/handoffs/read", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(consumeHandoffsSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const result = coordination.readCoordinationHandoffs(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    limit: body.limit,
  });
  res.json({
    data: {
      session: sessionDto(result.session),
      events: result.events.map(handoffDto),
      throughSequence: result.throughSequence,
      acknowledgementRequired: result.acknowledgementRequired,
    },
  });
}));

coordinationRouter.post("/handoffs/ack", route((req, res) => {
  const query = parseQuery(projectQuerySchema, req);
  const body = parseBody(acknowledgeHandoffsSchema, req);
  requireBoundWorktree(req, body.worktree_id);
  const resolvedProjectId = projectId(query.project);
  const session = coordination.acknowledgeCoordinationHandoffs(resolvedProjectId, {
    ...lease(resolvedProjectId, body, req),
    throughSequence: body.through_sequence,
  });
  res.json({ data: { session: sessionDto(session) } });
}));
