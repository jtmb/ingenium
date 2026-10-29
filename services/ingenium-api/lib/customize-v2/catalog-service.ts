export interface CustomizeContext { actorId: string; projectId: string }
export interface CatalogEntry {
  id: string; kind: "plugin" | "skill"; name: string; description?: string;
  category?: string; enabled?: boolean | number; archived?: boolean;
  revision?: number; actions?: string[];
}
export interface CustomizeCommand {
  kind: "plugin" | "skill"; id: string; action: string; operationId: string;
  expectedRevision?: number; visibility?: string;
}
export interface CustomizeAuthority {
  authorize(context: CustomizeContext, action: string, kind: string, visibility: string, resourceId?: string): boolean | Promise<boolean>;
  scopes(context: CustomizeContext): string[] | Promise<string[]>;
  installed(context: CustomizeContext, kind: string, visibility: string): CatalogEntry[] | Promise<CatalogEntry[]>;
  discover(context: CustomizeContext, kind: string, visibility: string): CatalogEntry[] | Promise<CatalogEntry[]>;
  resource(context: CustomizeContext, kind: string, id: string, visibility: string): CatalogEntry | null | Promise<CatalogEntry | null>;
  mutate(context: CustomizeContext, command: CustomizeCommand): Promise<{ operationId: string; outcome: string }>;
}
export class CustomizeError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const actions = new Set(["install", "update", "remove", "connect", "disconnect", "archive", "restore", "activate"]);

/**
 * Adapters remain inside the authenticated API and delegate writes to existing
 * transactional resource owners. Catalog manifests never supply executable URLs.
 */
export function createCustomizeService(authority: CustomizeAuthority) {
  async function authorize(context: CustomizeContext, action: string, kind: string, visibility: string, resourceId?: string) {
    if (!context?.projectId || !context?.actorId) {
      throw new CustomizeError("UNAUTHORIZED", "An authenticated project context is required.", 401);
    }
    if (!(await authority.authorize(context, action, kind, visibility, resourceId))) {
      throw new CustomizeError("FORBIDDEN", "This action is unavailable in the selected scope.", 403);
    }
  }

  return {
    async list(context: CustomizeContext, options: { kind?: string; visibility?: string; offset?: number; limit?: number } = {}) {
      const kind = options.kind ?? "plugin";
      const visibility = options.visibility ?? "project";
      await authorize(context, "read", kind, visibility);
      const offset = Number(options.offset ?? 0);
      const limit = Number(options.limit ?? 50);
      if (!["plugin", "skill"].includes(kind) ||
          !["project", "public", "personal", "system"].includes(visibility) ||
          !Number.isInteger(offset) || offset < 0 ||
          !Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new CustomizeError("VALIDATION_ERROR", "Invalid catalog query.", 400);
      }
      const available = await authority.scopes(context);
      if (!available.includes(visibility)) {
        throw new CustomizeError("SCOPE_UNAVAILABLE", "This catalog scope is not configured.", 409);
      }
      const installed = await authority.installed(context, kind, visibility);
      const discovered = visibility === "project"
        ? installed
        : await authority.discover(context, kind, visibility);
      const seen = new Set<string>();
      for (const entry of discovered) {
        if (entry.kind !== kind || !entry.id || seen.has(entry.id)) {
          throw new CustomizeError("INVALID_CATALOG", "The catalog contains inconsistent resource identities.", 502);
        }
        seen.add(entry.id);
      }
      const readable = await Promise.all(discovered.map(async (entry) => ({
        entry, allowed: await authority.authorize(context, "read", kind, visibility, entry.id),
      })));
      const catalog = readable.filter((result) => result.allowed).map((result) => result.entry);
      // Membership comes only from the selected project's persisted owner.
      const rows = await Promise.all(catalog.map(async (entry) => {
        const permissions = await Promise.all((entry.actions ?? []).filter((action) => actions.has(action)).map(async (action) => ({
          action, allowed: await authority.authorize(context, action, kind, visibility, entry.id),
        })));
        const permitted = new Set(permissions.filter((permission) => permission.allowed).map((permission) => permission.action));
        const persisted = installed.find((row) => row.id === entry.id && row.kind === entry.kind);
        return {
          id: entry.id,
          kind,
          name: entry.name,
          description: entry.description ?? "",
          category: entry.category ?? "Local",
          visibility,
          installed: Boolean(persisted),
          enabled: persisted ? Boolean(persisted.enabled) : false,
          archived: persisted ? Boolean(persisted.archived) : false,
          revision: persisted?.revision ?? null,
          actions: (entry.actions ?? []).filter((action) => permitted.has(action)),
        };
      }));
      return {
        data: rows.slice(offset, offset + limit),
        scope: { kind: "project", projectId: context.projectId },
        scopes: available,
        pagination: { offset, limit, total: rows.length, hasMore: offset + limit < rows.length },
      };
    },

    async mutate(context: CustomizeContext, command: CustomizeCommand) {
      if (!command || !actions.has(command.action) || !["plugin", "skill"].includes(command.kind) ||
          typeof command.id !== "string" || !command.id ||
          typeof command.operationId !== "string" || !command.operationId ||
          !["project", "public", "personal", "system"].includes(command.visibility ?? "project")) {
        throw new CustomizeError("VALIDATION_ERROR", "A valid resource, action and operation ID are required.", 400);
      }
      await authorize(context, command.action, command.kind, command.visibility ?? "project", command.id);
      const entry = await authority.resource(context, command.kind, command.id, command.visibility ?? "project");
      if (!entry) throw new CustomizeError("NOT_FOUND", "Resource not found.", 404);
      if (!entry.actions?.includes(command.action)) {
        throw new CustomizeError("ACTION_UNAVAILABLE", "The resource does not support this action.", 409);
      }
      // Authoritative owners enforce revision/idempotency and retain first failures.
      // A transport failure is not a rollback and must never be automatically replayed.
      const receipt = await authority.mutate(context, command);
      if (!receipt || receipt.operationId !== command.operationId ||
          !["succeeded", "failed", "unknown"].includes(receipt.outcome)) {
        throw new CustomizeError("OUTCOME_UNKNOWN", "Refresh operation status before retrying.", 502);
      }
      return receipt;
    },
  };
}
