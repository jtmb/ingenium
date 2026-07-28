import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface ToolVisibilityApi {
  listToolStates(project: string): Promise<ReadonlyMap<string, boolean>>;
}

export interface ToolVisibilityHost {
  sendToolListChanged?(): Promise<void> | void;
}

export const TOOL_VISIBILITY_RECONCILE_INTERVAL_MS = 5_000;

/**
 * Keeps the MCP tools/list projection aligned with API-owned per-project state.
 * Unknown or unavailable state is intentionally treated as disabled.
 */
export class McpToolVisibilityController {
  private readonly tools = new Map<string, RegisteredTool>();
  private reconcileTimer: NodeJS.Timeout | null = null;
  private refreshPromise: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly host: ToolVisibilityHost,
    private readonly project: string | null,
    private readonly api: ToolVisibilityApi,
    private readonly reconcileIntervalMs = TOOL_VISIBILITY_RECONCILE_INTERVAL_MS,
  ) {}

  track(toolName: string, registration: RegisteredTool): void {
    this.tools.set(toolName, registration);
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

  async refresh(): Promise<void> {
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

    const refreshPromise = this.refreshInternal().finally(() => {
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

  private async refreshInternal(): Promise<void> {
    let states: ReadonlyMap<string, boolean> = new Map();
    if (this.project) {
      try {
        states = await this.api.listToolStates(this.project);
      } catch {
        // Fail closed when the API cannot authoritatively answer a state query.
      }
    }
    if (this.stopping) return;

    let changed = false;
    for (const [toolName, registration] of this.tools) {
      const enabled = states.get(toolName) === true;
      if (enabled && !registration.enabled) {
        registration.enable();
        changed = true;
      } else if (!enabled && registration.enabled) {
        registration.disable();
        changed = true;
      }
    }

    if (changed) await this.host.sendToolListChanged?.();
  }
}
