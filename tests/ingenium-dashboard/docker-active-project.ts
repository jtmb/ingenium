/** Read-only active-project resolution for the external Docker suite. */
export interface DockerProjectRequest {
  get(url: string): Promise<{
    status(): number;
    headers?(): Record<string, string>;
    json(): Promise<unknown>;
  }>;
}

type ProjectSummary = {
  name: string;
  is_global?: boolean | number;
  archived_at?: string | null;
};

const PROJECT_NAME = /^(?!\.{1,2}$)[^\s\\/\u0000-\u001f\u007f]{1,64}$/;

function retryAfterHeader(headers: Readonly<Record<string, string>>): string | null {
  return Object.entries(headers).find(([name]) => name.toLowerCase() === "retry-after")?.[1] ?? null;
}

function isActive(project: ProjectSummary): boolean {
  return !project.archived_at;
}

function parseProjects(payload: unknown): ProjectSummary[] {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) {
    throw new Error("Docker project preflight expected GET /api/v1/projects to return { data: Project[] }");
  }

  const projects = (payload as { data: unknown[] }).data;
  return projects.map((project, index) => {
    const name = project && typeof project === "object"
      ? (project as { name?: unknown }).name
      : undefined;
    if (typeof name !== "string" || !PROJECT_NAME.test(name)) {
      throw new Error(`Docker project preflight received an invalid project at data[${index}]`);
    }
    return project as ProjectSummary;
  });
}

/**
 * Resolve an existing active project without creating or changing any project.
 * An explicit target wins; otherwise Docker follows the dashboard's sole-active-
 * global contract rather than guessing from a developer worktree name.
 */
export function resolveDockerActiveProject(
  payload: unknown,
  configuredProject = process.env.INGENIUM_E2E_PROJECT,
): string {
  const projects = parseProjects(payload);
  const activeProjects = projects.filter(isActive);
  const requestedProject = configuredProject?.trim();

  if (requestedProject) {
    if (!PROJECT_NAME.test(requestedProject)) {
      throw new Error("INGENIUM_E2E_PROJECT must be a valid project name");
    }
    if (!activeProjects.some((project) => project.name === requestedProject)) {
      throw new Error(`Configured INGENIUM_E2E_PROJECT '${requestedProject}' is not an active project returned by GET /api/v1/projects`);
    }
    return requestedProject;
  }

  const globals = activeProjects.filter((project) => Boolean(project.is_global));
  if (globals.length !== 1) {
    throw new Error(`Docker suite requires INGENIUM_E2E_PROJECT or exactly one active global project; found ${globals.length}`);
  }
  return globals[0]!.name;
}

/** Resolve the project through the dashboard's same-origin API proxy. */
export async function getDockerActiveProject(request: DockerProjectRequest): Promise<string> {
  const response = await request.get("/api/v1/projects");
  if (response.status() === 429) {
    const retryAfter = retryAfterHeader(response.headers?.() ?? {})?.trim() || "missing";
    throw new Error(`Docker project read GET /api/v1/projects returned HTTP 429 (Retry-After: ${retryAfter})`);
  }
  if (response.status() !== 200) {
    throw new Error(`Docker project read GET /api/v1/projects returned HTTP ${response.status()}`);
  }
  return resolveDockerActiveProject(await response.json());
}
