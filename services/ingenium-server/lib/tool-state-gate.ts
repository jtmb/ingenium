import {
  ApiHttpError,
  ApiUnavailableError,
} from "./client.js";

export const TOOL_STATE_GATE_CODES = {
  project: "PROJECT_IDENTITY_REQUIRED",
  disabled: "TOOL_DISABLED",
  unavailable: "TOOL_STATE_UNAVAILABLE",
} as const;

export type ToolState = "enabled" | "disabled" | "unavailable";
export interface ToolAuthorizationPolicy {
  action: string;
  resource: string;
  permission: "read" | "write" | "admin" | "execute";
  target: "installation" | "organization" | "project" | "private";
  scopes: readonly string[];
  launcherBinding: "required" | "none";
}
export interface ToolAuthorizationState {
  state: ToolState;
  policy?: ToolAuthorizationPolicy;
}

export interface LauncherAuthorizationBinding {
  project: string;
  projectId: string;
  organizationId: string;
  workspaceId: string;
  launcherWorktree: string;
  scopes: readonly string[];
}

export interface ProjectStateAttestation {
  project: string;
  project_id: string;
}

export type McpErrorResult = {
  isError: true;
  content: [{ type: "text"; text: string }];
};

const MAX_MCP_API_ERROR_TEXT_BYTES = 512;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getToolAuthorizationPolicy(value: unknown): ToolAuthorizationPolicy | null {
  if (!isRecord(value)
    || typeof value.action !== "string" || value.action.length === 0
    || typeof value.resource !== "string" || value.resource.length === 0
    || !["read", "write", "admin", "execute"].includes(value.permission as string)
    || !["installation", "organization", "project", "private"].includes(value.target as string)
    || !Array.isArray(value.scopes) || value.scopes.length === 0 || !value.scopes.every((scope) => typeof scope === "string" && scope.length > 0)
    || (value.launcherBinding !== "required" && value.launcherBinding !== "none")) return null;
  return value as unknown as ToolAuthorizationPolicy;
}

/**
 * State endpoints must attest both the requested project name and the resolved
 * API project ID. This intentionally does not accept the pre-MCP-102 response
 * shape: a successful HTTP status without identity evidence is not authority.
 */
export function getProjectStateAttestation(
  response: unknown,
  project: string,
): ProjectStateAttestation | null {
  if (!isRecord(response)
    || response.project !== project
    || typeof response.project_id !== "string"
    || response.project_id.length === 0
    || response.project_id.length > 128
    || response.project_id !== response.project_id.trim()
    || /[\u0000-\u001f\u007f]/.test(response.project_id)) return null;
  return { project, project_id: response.project_id };
}

/**
 * Holds the server-session mapping from public project name to immutable API
 * ID. This prevents a later response from switching a trusted name to another
 * project's state while allowing explicitly scoped tools to use distinct
 * project names safely.
 */
export class ProjectStateAttestor {
  private readonly projectIds = new Map<string, string>();

  attest(project: string, response: unknown): boolean {
    const attestation = getProjectStateAttestation(response, project);
    if (!attestation) return false;

    const boundProjectId = this.projectIds.get(project);
    if (boundProjectId === undefined) {
      this.projectIds.set(project, attestation.project_id);
      return true;
    }
    return boundProjectId === attestation.project_id;
  }
}

export function toolStateError(code: string, message: string): McpErrorResult {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
  };
}

function apiHttpErrorResult(error: ApiHttpError): McpErrorResult {
  const text = JSON.stringify({
    error: {
      status: error.status,
      code: error.code,
      message: error.message,
    },
  });
  if (Buffer.byteLength(text, "utf8") <= MAX_MCP_API_ERROR_TEXT_BYTES) {
    return { isError: true, content: [{ type: "text", text }] };
  }
  return toolStateError("API_REQUEST_FAILED", "The API request failed.");
}

function apiUnavailableResult(): McpErrorResult {
  return toolStateError("API_UNAVAILABLE", "The API is unavailable.");
}

/** Verify the required MCP-102 project attestation without changing bindings. */
export function responseProjectMatches(response: unknown, project: string): boolean {
  return getProjectStateAttestation(response, project) !== null;
}

/** Fail closed before invoking a handler when its authoritative tool state is unavailable. */
export function stateGatedHandler(
  toolName: string,
  resolveProject: (args: any) => string | null,
  checkState: (toolName: string, project: string) => Promise<ToolState>,
  handler: (args: any) => Promise<any>,
  missingProjectMessage = "A valid explicit project identity is required.",
) {
  return async (args: any) => {
    try {
      const project = resolveProject(args);
      if (!project) return toolStateError(TOOL_STATE_GATE_CODES.project, missingProjectMessage);

      const state = await checkState(toolName, project);
      if (state === "enabled") return await handler(args);
      return toolStateError(
        state === "disabled" ? TOOL_STATE_GATE_CODES.disabled : TOOL_STATE_GATE_CODES.unavailable,
        state === "disabled"
          ? "This tool is disabled for the project."
          : "The tool state could not be verified.",
      );
    } catch (error) {
      if (error instanceof ApiHttpError) return apiHttpErrorResult(error);
      if (error instanceof ApiUnavailableError) return apiUnavailableResult();
      throw error;
    }
  };
}

export function policyStateGatedHandler(
  toolName: string,
  launcherProject: string | null,
  checkState: (toolName: string, project: string) => Promise<ToolAuthorizationState>,
  handler: (args: any) => Promise<any>,
) {
  return async (args: any) => {
    try {
      if (!launcherProject) return toolStateError(TOOL_STATE_GATE_CODES.project, "A valid launcher project identity is required.");
      const result = await checkState(toolName, launcherProject);
      if (result.state !== "enabled") return toolStateError(
        result.state === "disabled" ? TOOL_STATE_GATE_CODES.disabled : TOOL_STATE_GATE_CODES.unavailable,
        result.state === "disabled" ? "This tool is disabled for the project." : "The tool state could not be verified.",
      );
      if (!result.policy) return toolStateError(TOOL_STATE_GATE_CODES.unavailable, "The tool authorization policy could not be verified.");
      if (result.policy.launcherBinding === "required" && args?.project !== launcherProject) {
        return toolStateError(TOOL_STATE_GATE_CODES.project, "The requested project does not match the launcher binding.");
      }
      return await handler(result.policy.launcherBinding === "required" ? { ...args, project: launcherProject } : args);
    } catch (error) {
      if (error instanceof ApiHttpError) return apiHttpErrorResult(error);
      if (error instanceof ApiUnavailableError) return apiUnavailableResult();
      throw error;
    }
  };
}

export function bindingAllowsTool(binding: LauncherAuthorizationBinding, policy: ToolAuthorizationPolicy): boolean {
  return policy.scopes.some((scope) => binding.scopes.includes(scope)
    || binding.scopes.includes("*")
    || binding.scopes.includes(`${policy.resource}:*`)
    || binding.scopes.includes(`${policy.resource}:admin`)
    || (policy.permission === "read" && binding.scopes.includes(`${policy.resource}:write`))
    || (policy.permission === "execute" && binding.scopes.includes(`${policy.resource}:sync`)));
}

/** Bind filesystem-backed operations and their state check to the launcher project. */
export function launcherBoundStateGatedHandler(
  toolName: string,
  launcherProject: string | null,
  checkState: (toolName: string, project: string) => Promise<ToolState>,
  handler: (args: any) => Promise<any>,
) {
  const stateChecked = stateGatedHandler(
    toolName,
    () => launcherProject,
    checkState,
    (args) => handler({ ...args, project: launcherProject }),
    "A valid launcher project identity is required.",
  );
  return async (args: any) => {
    if (!launcherProject || args?.project !== launcherProject) {
      return toolStateError(TOOL_STATE_GATE_CODES.project, "The requested project does not match the launcher binding.");
    }
    return stateChecked(args);
  };
}
