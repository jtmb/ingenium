export const TOOL_STATE_GATE_CODES = {
  project: "PROJECT_IDENTITY_REQUIRED",
  disabled: "TOOL_DISABLED",
  unavailable: "TOOL_STATE_UNAVAILABLE",
} as const;

export type ToolState = "enabled" | "disabled" | "unavailable";

export interface ProjectStateAttestation {
  project: string;
  project_id: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

export function toolStateError(code: string, message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
  };
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
    const project = resolveProject(args);
    if (!project) return toolStateError(TOOL_STATE_GATE_CODES.project, missingProjectMessage);

    const state = await checkState(toolName, project);
    if (state === "enabled") return handler(args);
    return toolStateError(
      state === "disabled" ? TOOL_STATE_GATE_CODES.disabled : TOOL_STATE_GATE_CODES.unavailable,
      state === "disabled"
        ? "This tool is disabled for the project."
        : "The tool state could not be verified.",
    );
  };
}
