/**
 * Project-scoped dynamic MCP child gateway.
 *
 * The parent MCP server owns discovery, registration, and forwarding. Child
 * definitions and secrets remain API-owned: this module receives only an
 * already-resolved runtime definition from the API and never reads the DB.
 */
import { z } from "zod";
import { api } from "./client.js";
import { logger } from "./logger.js";
import {
  ChildMcpRuntimeError,
  ChildMcpRuntimeManager,
  type ChildMcpTool,
  type ChildMcpToolCallResult,
  type ChildMcpRuntimeDefinition,
} from "./proxy.js";

const MAX_PROJECT_NAME_LENGTH = 64;
/**
 * Reconcile persisted definitions after the parent transport is connected.
 * This lets definition mutations take effect in the current MCP session without
 * making the API process responsible for child-process lifecycle management.
 */
export const CHILD_MCP_RECONCILE_INTERVAL_MS = 5_000;

export interface ChildMcpRuntimeDefinitionResponse extends ChildMcpRuntimeDefinition {
  scope: "project" | "global";
  /** Only the owner can persist an authoritative discovery snapshot. */
  owned: boolean;
  /** Changes only when runtime-relevant definition state is reconciled. */
  revision: string;
}

export interface ChildMcpDiscoveryReport {
  status: "ready" | "failed";
  diagnostic?: "unavailable" | "unauthorized" | "invalid_response" | "timeout";
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}

export interface ChildMcpGatewayApi {
  listRuntimeDefinitions(project: string): Promise<{
    definitions: ChildMcpRuntimeDefinitionResponse[];
    unavailableCount: number;
  }>;
  recordDiscovery(project: string, server: string, report: ChildMcpDiscoveryReport): Promise<boolean>;
  toolEnabled(project: string, toolName: string): Promise<"enabled" | "disabled" | "unavailable">;
}

export interface ChildMcpToolRegistration {
  remove(): void;
}

/** A narrow structural adapter lets gateway tests avoid a live stdio transport. */
export interface ChildMcpToolHost {
  registerTool(
    name: string,
    configuration: {
      description: string;
      inputSchema: Record<string, z.ZodTypeAny>;
    },
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): ChildMcpToolRegistration;
  sendToolListChanged?(): Promise<void>;
}

interface RegisteredChildTool {
  serverName: string;
  sourceToolName: string;
  signature: string;
  generation: symbol;
  registration: ChildMcpToolRegistration;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeDefinition(value: unknown): value is ChildMcpRuntimeDefinitionResponse {
  if (!isRecord(value)
    || typeof value.name !== "string"
    || typeof value.executable !== "string"
    || !Array.isArray(value.args)
    || !value.args.every((argument) => typeof argument === "string")
    || (value.scope !== "project" && value.scope !== "global")
    || typeof value.owned !== "boolean"
    || typeof value.revision !== "string"
    || !isRecord(value.environment)
  ) return false;
  return Object.entries(value.environment).every(([key, environmentValue]) => (
    /^[A-Z_][A-Z0-9_]{0,63}$/.test(key) && typeof environmentValue === "string"
  ));
}

/** API adapter that preserves only typed protocol outcomes at the runtime boundary. */
export const childMcpGatewayApi: ChildMcpGatewayApi = {
  async listRuntimeDefinitions(project) {
    const response = await api.getTrustedChildMcpRuntime(project);
    if (!response.ok || !isRecord(response.data)) throw new Error("CHILD_MCP_RUNTIME_UNAVAILABLE");
    const definitions = Array.isArray(response.data.definitions)
      ? response.data.definitions.filter(isRuntimeDefinition)
      : [];
    const unavailableCount = Array.isArray(response.data.unavailable) ? response.data.unavailable.length : 0;
    return { definitions, unavailableCount };
  },

  async recordDiscovery(project, server, report) {
    const response = await api.post(
      `/mcp-servers/${encodeURIComponent(server)}/discovery`,
      report,
      { project },
    );
    return response.ok;
  },

  async toolEnabled(project, toolName) {
    try {
      const response = await api.get(
        `/mcp-tools/${encodeURIComponent(toolName)}/state`,
        { project },
      );
      if (!response.ok || !isRecord(response.data) || typeof response.data.enabled !== "boolean") {
        return "unavailable";
      }
      return response.data.enabled ? "enabled" : "disabled";
    } catch {
      return "unavailable";
    }
  },
};

/** Mirrors the API/core project identity contract without importing either layer. */
export function resolveChildMcpProjectIdentity(value: unknown): string | null {
  if (typeof value !== "string"
    || value.length === 0
    || value.length > MAX_PROJECT_NAME_LENGTH
    || value !== value.trim()
    || value === "."
    || value === ".."
    || /[\\/\u0000-\u001f\u007f]/.test(value)
  ) return null;
  return value;
}

function canonicalToolName(server: string, tool: string): string {
  return `ingenium_${server}_${tool}`;
}

/**
 * McpServer.registerTool receives the local tool name. OpenCode prepends its
 * configured server key (`ingenium`) when exposing it to callers, so registering
 * the canonical catalog name here would expose `ingenium_ingenium_*`.
 */
function transportToolName(server: string, tool: string): string {
  return `${server}_${tool}`;
}

function toolSignature(tool: ChildMcpTool): string {
  return JSON.stringify({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  });
}

function toolsSignature(tools: ChildMcpTool[]): string {
  return JSON.stringify(
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  );
}

function safeError(code: string, message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
  };
}

function runtimeErrorResponse(error: unknown) {
  const code = error instanceof ChildMcpRuntimeError ? error.code : "CHILD_MCP_UNAVAILABLE";
  const messages: Record<string, string> = {
    CHILD_MCP_CONFIG_INVALID: "The child MCP configuration is invalid.",
    CHILD_MCP_NOT_FOUND: "The child MCP server is unavailable.",
    CHILD_MCP_NOT_READY: "The child MCP server is not ready.",
    CHILD_MCP_UNKNOWN_TOOL: "The child MCP tool is unavailable.",
    CHILD_MCP_INVALID_ARGUMENTS: "Child MCP tool arguments are invalid.",
    CHILD_MCP_STARTUP_TIMEOUT: "The child MCP server did not start in time.",
    CHILD_MCP_REQUEST_TIMEOUT: "The child MCP server did not respond in time.",
    CHILD_MCP_SHUTDOWN_TIMEOUT: "The child MCP server did not stop in time.",
    CHILD_MCP_UNAVAILABLE: "The child MCP server is unavailable.",
    CHILD_MCP_INVALID_RESPONSE: "The child MCP server returned an invalid response.",
  };
  return safeError(code, messages[code] ?? "The child MCP server is unavailable.");
}

function fingerprint(definition: ChildMcpRuntimeDefinitionResponse): string {
  return JSON.stringify({
    name: definition.name,
    executable: definition.executable,
    args: definition.args,
    environment: definition.environment,
    scope: definition.scope,
    owned: definition.owned,
    revision: definition.revision,
  });
}

/**
 * Registers one local transport tool per discovered source tool while retaining
 * a canonical catalog name for state checks. A refresh reconciles removed tools
 * and definitions and emits tools/list_changed after the MCP transport connects.
 */
export class ChildMcpGateway {
  private readonly manager: ChildMcpRuntimeManager;
  private readonly definitions = new Map<string, string>();
  private readonly discovery = new Map<string, string>();
  private readonly tools = new Map<string, RegisteredChildTool>();
  private reconcileTimer: NodeJS.Timeout | null = null;
  private refreshPromise: Promise<void> | null = null;
  private stopping = false;

  constructor(
    private readonly host: ChildMcpToolHost,
    private readonly project: string | null,
    private readonly apiClient: ChildMcpGatewayApi = childMcpGatewayApi,
    manager?: ChildMcpRuntimeManager,
    private readonly reconcileIntervalMs = CHILD_MCP_RECONCILE_INTERVAL_MS,
  ) {
    this.manager = manager ?? new ChildMcpRuntimeManager();
  }

  /** Start bounded post-connect reconciliation; this never requires a parent restart. */
  async start(): Promise<void> {
    if (this.stopping) return;
    if (!this.reconcileTimer) {
      const intervalMs = Number.isInteger(this.reconcileIntervalMs)
        && this.reconcileIntervalMs >= 50
        && this.reconcileIntervalMs <= 60_000
        ? this.reconcileIntervalMs
        : CHILD_MCP_RECONCILE_INTERVAL_MS;
      this.reconcileTimer = setInterval(() => {
        void this.refresh().catch(() => {
          logger.warn({ boundary: "child-mcp-reconcile" }, "Child MCP reconciliation failed unexpectedly");
        });
      }, intervalMs);
      this.reconcileTimer.unref?.();
    }
    await this.refresh();
  }

  /**
   * Serialize reconciliation so an interval tick can never race a manual
   * refresh or shutdown. Callers share the same bounded lifecycle operation.
   */
  async refresh(): Promise<void> {
    if (this.stopping) return;
    if (this.refreshPromise) {
      await this.refreshPromise;
      if (this.stopping) return;
      // A mutation can land while the in-flight reconciliation is reading the
      // API. Do not let a caller that explicitly requested refresh observe
      // that stale snapshot; run one fresh pass after the active pass settles.
      // If another waiter already started that pass, wait for it instead of
      // starting a duplicate reconciliation.
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

  private async refreshInternal(): Promise<void> {
    if (!this.project) {
      logger.warn({ boundary: "child-mcp-project" }, "Child MCP discovery skipped because project identity is unavailable");
      return;
    }

    let result: Awaited<ReturnType<ChildMcpGatewayApi["listRuntimeDefinitions"]>>;
    try {
      result = await this.apiClient.listRuntimeDefinitions(this.project);
    } catch {
      // The API owns the authoritative definition and tool state. Keep the
      // transport projection fail-closed when that authority is unavailable;
      // a stale dynamic registration must not remain callable or visible in
      // tools/list during an outage.
      const changed = this.removeAllTools();
      if (changed) await this.notifyToolsChanged();
      logger.warn({ boundary: "child-mcp-discovery" }, "Child MCP discovery refresh is unavailable");
      return;
    }
    if (this.stopping) return;

    let changed = false;
    const desired = new Map(result.definitions.map((definition) => [definition.name, definition]));
    for (const serverName of this.definitions.keys()) {
      if (desired.has(serverName)) continue;
      changed = await this.removeServer(serverName) || changed;
    }

    for (const definition of desired.values()) {
      if (this.stopping) return;
      const definitionChanged = this.definitions.get(definition.name) !== fingerprint(definition);
      if (definitionChanged && this.definitions.has(definition.name)) {
        changed = await this.removeServer(definition.name) || changed;
      }

      try {
        if (definitionChanged) {
          this.manager.registerServer(definition);
          this.definitions.set(definition.name, fingerprint(definition));
          this.discovery.delete(definition.name);
          await this.manager.startServer(definition.name);
        } else {
          const status = this.manager.getStatus(definition.name);
          // Child runtime failures are terminal until a definition mutation or
          // explicit reconnect. Periodic reconciliation must not become an
          // unbounded restart loop.
          if (status.state !== "ready" && status.state !== "degraded") {
            changed = this.removeTools(definition.name) || changed;
            continue;
          }
        }
        const tools = await this.manager.listTools(definition.name);
        // Persist the discovery snapshot before exposing a new tool. This makes
        // the core catalog the collision authority and prevents a dynamically
        // discovered child tool from replacing a built-in registration.
        const currentDiscovery = toolsSignature(tools);
        if (definition.owned
          && (definitionChanged || this.discovery.get(definition.name) !== currentDiscovery)
          && !await this.recordReadyDiscovery(definition, tools)) {
          throw new ChildMcpRuntimeError("CHILD_MCP_INVALID_RESPONSE");
        }
        this.discovery.set(definition.name, currentDiscovery);
        changed = await this.syncTools(definition, tools) || changed;
      } catch (error) {
        changed = this.removeTools(definition.name) || changed;
        this.discovery.delete(definition.name);
        if (definition.owned) await this.recordFailedDiscovery(definition, error);
        logger.warn(
          { child: definition.name, boundary: "child-mcp-discovery", code: error instanceof ChildMcpRuntimeError ? error.code : "CHILD_MCP_UNAVAILABLE" },
          "Child MCP discovery failed",
        );
      }
    }

    if (result.unavailableCount > 0) {
      logger.warn({ boundary: "child-mcp-credentials", unavailable: result.unavailableCount }, "Child MCP definitions are unavailable until credentials can be resolved");
    }
    if (changed) await this.notifyToolsChanged();
  }

  async shutdown(): Promise<void> {
    this.stopping = true;
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    await this.refreshPromise?.catch(() => undefined);
    const changed = this.removeAllTools();
    if (changed) await this.notifyToolsChanged();
    await this.manager.stopAll();
  }

  private async removeServer(serverName: string): Promise<boolean> {
    this.removeTools(serverName);
    this.definitions.delete(serverName);
    this.discovery.delete(serverName);
    try {
      await this.manager.unregisterServer(serverName);
    } catch (error) {
      logger.warn(
        { child: serverName, boundary: "child-mcp-unregister", code: error instanceof ChildMcpRuntimeError ? error.code : "CHILD_MCP_UNAVAILABLE" },
        "Child MCP runtime removal did not complete cleanly",
      );
    }
    return true;
  }

  private async syncTools(definition: ChildMcpRuntimeDefinitionResponse, discovered: ChildMcpTool[]): Promise<boolean> {
    let changed = false;
    const visible: ChildMcpTool[] = [];
    for (const tool of discovered) {
      const state = await this.apiClient.toolEnabled(this.project!, canonicalToolName(definition.name, tool.name));
      if (state === "enabled") visible.push(tool);
    }
    const desired = new Map(visible.map((tool) => [canonicalToolName(definition.name, tool.name), tool]));
    for (const [name, tool] of this.tools) {
      const next = desired.get(name);
      if (tool.serverName === definition.name && (!next || tool.signature !== toolSignature(next))) {
        tool.registration.remove();
        this.tools.delete(name);
        changed = true;
      }
    }

    for (const tool of visible) {
      const name = canonicalToolName(definition.name, tool.name);
      if (this.tools.has(name)) continue;
      const generation = Symbol(name);
      const registration = this.host.registerTool(
        transportToolName(definition.name, tool.name),
        {
          description: tool.description,
          inputSchema: {
            project: z.string().min(1).max(MAX_PROJECT_NAME_LENGTH),
            arguments: z.record(z.unknown()).default({}),
          },
        },
        async (args) => this.forward(definition.name, tool.name, name, generation, args),
      );
      this.tools.set(name, {
        serverName: definition.name,
        sourceToolName: tool.name,
        signature: toolSignature(tool),
        generation,
        registration,
      });
      changed = true;
    }
    return changed;
  }

  private removeTools(serverName: string): boolean {
    let changed = false;
    for (const [name, tool] of this.tools) {
      if (tool.serverName !== serverName) continue;
      tool.registration.remove();
      this.tools.delete(name);
      changed = true;
    }
    return changed;
  }

  private removeAllTools(): boolean {
    let changed = false;
    for (const tool of this.tools.values()) {
      tool.registration.remove();
      changed = true;
    }
    this.tools.clear();
    return changed;
  }

  private async forward(
    serverName: string,
    sourceToolName: string,
    canonicalName: string,
    generation: symbol,
    args: Record<string, unknown>,
  ): Promise<ChildMcpToolCallResult | ReturnType<typeof safeError>> {
    if (!this.project || args.project !== this.project) {
      return safeError("PROJECT_IDENTITY_REQUIRED", "A valid explicit project identity is required for this child MCP tool.");
    }
    const state = await this.apiClient.toolEnabled(this.project, canonicalName);
    if (state === "disabled") {
      return safeError("TOOL_DISABLED", "This child MCP tool is disabled for the project.");
    }
    if (state !== "enabled") {
      return safeError("TOOL_STATE_UNAVAILABLE", "The child MCP tool state could not be verified.");
    }
    // A caller may retain an old tools/call payload while reconciliation is
    // removing a disabled, disconnected, or deleted registration. The MCP
    // host will reject the removed name, but this guard also protects direct
    // handler references used by transports and tests from forwarding through
    // a stale closure.
    const registration = this.tools.get(canonicalName);
    if (!registration
      || registration.serverName !== serverName
      || registration.sourceToolName !== sourceToolName
      || registration.generation !== generation) {
      return safeError("CHILD_MCP_UNAVAILABLE", "The child MCP server is unavailable.");
    }
    try {
      return await this.manager.callTool(serverName, sourceToolName, args.arguments ?? {});
    } catch (error) {
      return runtimeErrorResponse(error);
    }
  }

  private async recordReadyDiscovery(
    definition: ChildMcpRuntimeDefinitionResponse,
    tools: ChildMcpTool[],
  ): Promise<boolean> {
    const saved = await this.apiClient.recordDiscovery(this.project!, definition.name, {
      status: "ready",
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      })),
    });
    if (!saved) logger.warn({ child: definition.name, boundary: "child-mcp-catalog" }, "Child MCP discovery metadata was not persisted");
    return saved;
  }

  private async recordFailedDiscovery(
    definition: ChildMcpRuntimeDefinitionResponse,
    error: unknown,
  ): Promise<void> {
    const diagnostic = error instanceof ChildMcpRuntimeError && error.code.includes("TIMEOUT")
      ? "timeout"
      : error instanceof ChildMcpRuntimeError && error.code === "CHILD_MCP_INVALID_RESPONSE"
        ? "invalid_response"
        : "unavailable";
    const saved = await this.apiClient.recordDiscovery(this.project!, definition.name, {
      status: "failed",
      diagnostic,
    });
    if (!saved) logger.warn({ child: definition.name, boundary: "child-mcp-catalog" }, "Child MCP failure metadata was not persisted");
  }

  private async notifyToolsChanged(): Promise<void> {
    try {
      await this.host.sendToolListChanged?.();
    } catch {
      logger.warn({ boundary: "child-mcp-list-changed" }, "Unable to notify the MCP host about child tool changes");
    }
  }
}
