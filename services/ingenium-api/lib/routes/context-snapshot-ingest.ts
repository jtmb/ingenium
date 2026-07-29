import express, { Router, type NextFunction, type Request, type Response } from "express";
import {
  CONTEXT_SNAPSHOT_MAX_BYTES,
  ImportContextConversationSnapshotInputSchema,
} from "ingenium-core/lib/schema";
import {
  ContextSnapshotImportError,
  importContextConversationSnapshot,
  type ContextConversationSnapshotImportResult,
} from "ingenium-core/lib/tools/context-snapshot-import";
import { getProject, isValidProjectName } from "ingenium-core/lib/tools/projects";

/**
 * This dedicated binary route is a bearer-authenticated MCP-to-API transport
 * for whole conversation snapshots, not a browser-facing context mutation
 * endpoint. Its octet-stream media type deliberately bypasses global JSON
 * parsing.
 */
export const CONTEXT_SNAPSHOT_INGEST_PATH = "/api/v1/context/conversations/import";
export const CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE = "application/octet-stream";
export const CONTEXT_SNAPSHOT_INGEST_TIMEOUT_MS = 15_000;

const ALLOWED_CONTENT_ENCODINGS = new Set(["identity", "gzip", "deflate", "br"]);

export const contextSnapshotIngestRouter = Router();

interface SnapshotBodyParserError {
  type?: unknown;
}

function sendSnapshotError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function isSnapshotContentType(req: Request): boolean {
  const contentType = req.get("Content-Type");
  return contentType?.toLowerCase() === CONTEXT_SNAPSHOT_INGEST_CONTENT_TYPE;
}

/**
 * The API-wide bearer check remains the primary server-to-server authentication
 * boundary. Dashboard requests are explicitly excluded here as defense in
 * depth; CSRF middleware rejects browser-originated requests without its valid
 * dashboard marker before this route is reached.
 */
function rejectDashboardSnapshotTransport(req: Request, res: Response, next: NextFunction): void {
  if (req.get("x-ingenium-ui") !== undefined) {
    sendSnapshotError(res, 404, "NOT_FOUND", "Not found.");
    return;
  }
  next();
}

/** Reject unknown/oversized wire sizes before body-parser allocates or inflates. */
function requireBoundedContentLength(req: Request, res: Response, next: NextFunction): void {
  if (!isSnapshotContentType(req)) {
    sendSnapshotError(res, 415, "UNSUPPORTED_MEDIA_TYPE", "Snapshot ingest requires its dedicated content type.");
    return;
  }

  const contentLength = req.get("Content-Length");
  if (contentLength === undefined) {
    sendSnapshotError(res, 411, "CONTENT_LENGTH_REQUIRED", "Snapshot ingest requires Content-Length.");
    return;
  }
  if (!/^(?:0|[1-9]\d*)$/.test(contentLength)) {
    sendSnapshotError(res, 400, "INVALID_CONTENT_LENGTH", "Snapshot ingest Content-Length is invalid.");
    return;
  }

  const declaredBytes = Number(contentLength);
  if (!Number.isSafeInteger(declaredBytes) || declaredBytes === 0) {
    sendSnapshotError(res, 400, "INVALID_CONTENT_LENGTH", "Snapshot ingest Content-Length is invalid.");
    return;
  }
  if (declaredBytes > CONTEXT_SNAPSHOT_MAX_BYTES) {
    sendSnapshotError(res, 413, "SNAPSHOT_PAYLOAD_TOO_LARGE", "Snapshot ingest exceeds the allowed size.");
    return;
  }

  const contentEncoding = req.get("Content-Encoding")?.toLowerCase();
  if (contentEncoding !== undefined && !ALLOWED_CONTENT_ENCODINGS.has(contentEncoding)) {
    sendSnapshotError(res, 415, "UNSUPPORTED_CONTENT_ENCODING", "Snapshot ingest content encoding is unsupported.");
    return;
  }
  next();
}

/** Bound slow uploads as well as the compressed and decompressed byte budgets. */
function enforceSnapshotRequestTimeout(req: Request, res: Response, next: NextFunction): void {
  const timeout = setTimeout(() => {
    if (res.headersSent || res.writableEnded) return;
    sendSnapshotError(res, 408, "SNAPSHOT_INGEST_TIMEOUT", "Snapshot ingest timed out.");
    req.destroy();
  }, CONTEXT_SNAPSHOT_INGEST_TIMEOUT_MS);
  const clear = () => clearTimeout(timeout);
  res.once("finish", clear);
  res.once("close", clear);
  next();
}

function resolveSnapshotProject(req: Request, res: Response): string | null {
  const projectName = req.query.project;
  if (typeof projectName !== "string" || !isValidProjectName(projectName)) {
    sendSnapshotError(res, 400, "INVALID_PROJECT", "A valid project is required for snapshot ingest.");
    return null;
  }
  const project = getProject(projectName);
  if (!project) {
    sendSnapshotError(res, 404, "PROJECT_NOT_FOUND", "Snapshot project was not found.");
    return null;
  }
  return project.id;
}

function parseSnapshotBody(body: unknown): unknown | null {
  if (!Buffer.isBuffer(body)) return null;
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return null;
  }
}

function sendImportError(res: Response, error: ContextSnapshotImportError): void {
  const contract: Record<ContextSnapshotImportError["code"], { status: number; code: string; message: string }> = {
    INVALID_CONTEXT_SNAPSHOT: {
      status: 422,
      code: "INVALID_CONTEXT_SNAPSHOT",
      message: "Snapshot ingest payload is invalid.",
    },
    SNAPSHOT_HASH_MISMATCH: {
      status: 422,
      code: "INVALID_CONTEXT_SNAPSHOT",
      message: "Snapshot ingest payload is invalid.",
    },
    PROJECT_NOT_FOUND: {
      status: 404,
      code: "PROJECT_NOT_FOUND",
      message: "Snapshot project was not found.",
    },
    CONVERSATION_NOT_FOUND: {
      status: 404,
      code: "SNAPSHOT_TARGET_NOT_FOUND",
      message: "Snapshot target was not found.",
    },
    CONVERSATION_ARCHIVED: {
      status: 409,
      code: "CONVERSATION_ARCHIVED",
      message: "Snapshot target cannot accept additional entries.",
    },
    SOURCE_KEY_REUSED: {
      status: 409,
      code: "SOURCE_KEY_REUSED",
      message: "Snapshot source conflicts with an existing import.",
    },
    SNAPSHOT_SHORTER: {
      status: 409,
      code: "SNAPSHOT_SHORTER",
      message: "Snapshot cannot remove previously imported entries.",
    },
    SNAPSHOT_DIVERGED: {
      status: 409,
      code: "SNAPSHOT_DIVERGED",
      message: "Snapshot does not match its imported prefix.",
    },
    SNAPSHOT_MAPPING_INTEGRITY_FAILED: {
      status: 409,
      code: "SNAPSHOT_MAPPING_CONFLICT",
      message: "Snapshot import state cannot be extended.",
    },
  };
  const response = contract[error.code];
  sendSnapshotError(res, response.status, response.code, response.message);
}

function snapshotResponse(result: ContextConversationSnapshotImportResult) {
  const total = result.revision;
  return {
    conversation: {
      id: result.conversation.id,
      revision: result.revision,
      message_count: result.conversation.message_count,
      checkpoint_count: result.conversation.checkpoint_count,
      latest_message_id: result.conversation.latest_message_id,
    },
    id: result.conversation.id,
    revision: result.revision,
    total,
    appended: result.appended,
    skipped: total - result.appended,
    snapshotHash: result.snapshotHash,
    created: result.created,
    adopted: result.adopted,
    idempotent: result.idempotent,
  };
}

contextSnapshotIngestRouter.post(
  "/",
  rejectDashboardSnapshotTransport,
  requireBoundedContentLength,
  enforceSnapshotRequestTimeout,
  // This raw parser is the sole body parser for snapshot octet-streams.
  express.raw({ type: () => true, limit: CONTEXT_SNAPSHOT_MAX_BYTES, inflate: true }),
  (req, res) => {
    const projectId = resolveSnapshotProject(req, res);
    if (!projectId) return;

    const body = parseSnapshotBody(req.body);
    if (body === null) {
      sendSnapshotError(res, 400, "MALFORMED_SNAPSHOT", "Snapshot ingest body must be valid UTF-8 JSON.");
      return;
    }

    const parsed = ImportContextConversationSnapshotInputSchema.safeParse(body);
    if (!parsed.success) {
      sendSnapshotError(res, 422, "INVALID_CONTEXT_SNAPSHOT", "Snapshot ingest payload is invalid.");
      return;
    }

    try {
      // This is intentionally one transactional core invocation per complete
      // snapshot; API code never iterates or appends individual messages.
      const result = importContextConversationSnapshot(projectId, parsed.data);
      res.status(result.created ? 201 : 200).json({ data: snapshotResponse(result) });
    } catch (error) {
      if (error instanceof ContextSnapshotImportError) {
        sendImportError(res, error);
        return;
      }
      // Do not log raw snapshot errors: source IDs, titles, and message bodies
      // are sensitive and the client only receives a stable failure contract.
      sendSnapshotError(res, 500, "SNAPSHOT_INGEST_FAILED", "Snapshot ingest failed.");
    }
  },
);

/** Body-parser errors are normalized locally so no raw body detail reaches logs or responses. */
contextSnapshotIngestRouter.use(
  (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    const type = (error as SnapshotBodyParserError | undefined)?.type;
    if (type === "entity.too.large") {
      sendSnapshotError(res, 413, "SNAPSHOT_PAYLOAD_TOO_LARGE", "Snapshot ingest exceeds the allowed size.");
      return;
    }
    if (type === "encoding.unsupported") {
      sendSnapshotError(res, 415, "UNSUPPORTED_CONTENT_ENCODING", "Snapshot ingest content encoding is unsupported.");
      return;
    }
    if (type === "request.aborted" || type === "request.size.invalid") {
      sendSnapshotError(res, 400, "MALFORMED_SNAPSHOT", "Snapshot ingest request is invalid.");
      return;
    }
    sendSnapshotError(res, 500, "SNAPSHOT_INGEST_FAILED", "Snapshot ingest failed.");
  },
);
