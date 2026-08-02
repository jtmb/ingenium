import { McpServer, type RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  ProjectStateAttestor,
  type ProjectStateAttestation,
} from "./tool-state-gate.js";

export interface AuthoritativeToolStates {
  states: ReadonlyMap<string, boolean>;
  attestation: ProjectStateAttestation;
}

export interface ToolVisibilityApi {
  listToolStates(project: string): Promise<AuthoritativeToolStates>;
}

export interface ToolVisibilityHost {
  sendToolListChanged?(): Promise<void> | void;
}

interface ToolListResponse {
  tools?: Array<{ name?: unknown }>;
  [key: string]: unknown;
}

interface McpServerInternals {
  _requestHandlers: Map<string, (request: unknown, extra: unknown) => Promise<unknown>>;
}

export const TOOL_VISIBILITY_RECONCILE_INTERVAL_MS = 5_000;

/**
 * Keeps the MCP tools/list projection aligned with API-owned per-project state.
 * Unknown or unavailable state is intentionally treated as disabled.
 */
export class McpToolVisibilityController {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly visible = new Map<string, boolean>();
  private reconcileTimer: NodeJS.Timeout | null = null;
  private refreshPromise: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly host: ToolVisibilityHost,
    private readonly project: string | null,
    private readonly api: ToolVisibilityApi,
    private readonly reconcileIntervalMs = TOOL_VISIBILITY_RECONCILE_INTERVAL_MS,
    private readonly projectStateAttestor = new ProjectStateAttestor(),
  ) {}

  track(toolName: string, registration: RegisteredTool): void {
    this.tools.set(toolName, registration);
    this.visible.set(toolName, false);
  }

  /** Built-in names fail closed until a trusted reconciliation marks them visible. */
  isVisible(toolName: string): boolean {
    return !this.tools.has(toolName) || this.visible.get(toolName) === true;
  }

  /** Reconcile the initial projection before a transport can serve tools/list. */
  async prepare(): Promise<void> {
    await this.refresh(false);
  }

  async start(): Promise<void> {
    if (this.stopping || this.reconcileTimer) return;
    await this.refresh();
    if (this.stopping) return;

    const intervalMs = Number.isInteger(this.reconcileIntervalMs)
      && this.reconcileIntervalMs >= 50
      && this.reconcileIntervalMs <= 60_000
      ? this.reconcileIntervalMs
      : TOOL_VISIBILITY_RECONCILE_INTERVAL_MS;
    this.reconcileTimer = setInterval(() => {
      void this.refresh().catch(() => undefined);
    }, intervalMs);
    this.reconcileTimer.unref?.();
  }

  async refresh(notify = true): Promise<void> {
    if (this.stopping) return;
    if (this.refreshPromise) {
      await this.refreshPromise;
      if (this.stopping) return;
      // A state mutation can land while the active request is reading the API.
      // Complete an explicit refresh against a post-mutation snapshot instead
      // of returning the stale in-flight result.
      if (this.refreshPromise) {
        await this.refreshPromise;
        return;
      }
    }
    if (this.stopping) return;

    const refreshPromise = this.refreshInternal(notify).finally(() => {
      if (this.refreshPromise === refreshPromise) this.refreshPromise = null;
    });
    this.refreshPromise = refreshPromise;
    await refreshPromise;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    await this.refreshPromise?.catch(() => undefined);
  }

  private async refreshInternal(notify: boolean): Promise<void> {
    let states: ReadonlyMap<string, boolean> = new Map();
    if (this.project) {
      try {
        const response = await this.api.listToolStates(this.project);
        if (this.projectStateAttestor.attest(this.project, response.attestation)) {
          states = response.states;
        }
      } catch {
        // Fail closed when the API cannot authoritatively answer a state query.
      }
    }
    if (this.stopping) return;

    let changed = false;
    for (const toolName of this.tools.keys()) {
      const enabled = states.get(toolName) === true;
      if (enabled !== this.visible.get(toolName)) {
        this.visible.set(toolName, enabled);
        changed = true;
      }
    }

    if (changed && notify) await this.host.sendToolListChanged?.();
  }
}

/**
 * Keep disabled tools callable so their state gate can return TOOL_DISABLED,
 * while filtering them out of the SDK's tools/list projection.
 */
export function installToolVisibilityProjection(
  server: McpServer,
  visibility: Pick<McpToolVisibilityController, "isVisible">,
): void {
  const requestHandlers = (server.server as unknown as McpServerInternals)._requestHandlers;
  const listHandler = requestHandlers.get("tools/list");
  if (!listHandler) throw new Error("MCP tools/list handler is unavailable");

  server.server.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const result = await listHandler(request, extra) as ToolListResponse;
    if (!Array.isArray(result.tools)) return result as never;
    return {
      ...result,
      tools: result.tools.filter((tool) => (
        typeof tool.name !== "string" || visibility.isVisible(`ingenium_${tool.name}`)
      )),
    } as never;
  });
}
