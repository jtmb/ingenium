import { api, ApiHttpError, ApiUnavailableError } from "../client.js";
import { textResult } from "./result.js";

type MemoryVisibility = "private" | "project";

function params(
  project: string,
  workspaceId: string,
  visibility: MemoryVisibility = "private",
  options: { limit?: number; tokenBudget?: number; offset?: number } = {},
): Record<string, string> {
  return {
    project,
    workspaceId,
    visibility,
    ...(options.limit === undefined ? {} : { limit: String(options.limit) }),
    ...(options.tokenBudget === undefined ? {} : { tokenBudget: String(options.tokenBudget) }),
    ...(options.offset === undefined ? {} : { offset: String(options.offset) }),
  };
}

async function operationStatus(project: string, workspaceId: string, operationId: string) {
  const response = await api.get(`/memory/operations/${encodeURIComponent(operationId)}`, {
    project,
    workspaceId,
  });
  return response.data;
}

async function mutate(
  project: string,
  workspaceId: string,
  operationId: string,
  operation: () => Promise<{ data: unknown }>,
) {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof ApiUnavailableError) && !(error instanceof ApiHttpError && error.status >= 500)) throw error;
    try {
      const status = await operationStatus(project, workspaceId, operationId);
      if (status && typeof status === "object" && (status as { status?: unknown }).status === "committed") {
        return { data: { memory: null, receipt: (status as { receipt?: unknown }).receipt, idempotent: true, reconciled: true } };
      }
    } catch {
      // The mutation outcome remains unknown; it must not be replayed or reported as committed.
    }
    return { data: { status: "pending", operationId, nextAction: "memory_operation_status" } };
  }
}

export async function memorySave(
  project: string,
  workspaceId: string,
  operationId: string,
  content: string,
  tags?: string[],
  visibility: MemoryVisibility = "private",
  memoryId?: string,
) {
  const response = await mutate(project, workspaceId, operationId, () => api.post("/memory", {
    operationId,
    workspaceId,
    content,
    ...(tags === undefined ? {} : { tags }),
    ...(visibility === "private" ? {} : { visibility }),
    ...(memoryId === undefined ? {} : { memoryId }),
  }, { project }));
  return textResult(response.data);
}

export async function memoryRead(
  project: string,
  workspaceId: string,
  memoryId: string,
  visibility: MemoryVisibility = "private",
) {
  const response = await api.get(`/memory/${encodeURIComponent(memoryId)}`, params(project, workspaceId, visibility));
  return textResult(response.data);
}

export async function memoryList(
  project: string,
  workspaceId: string,
  visibility: MemoryVisibility = "private",
  options: { limit?: number; tokenBudget?: number; offset?: number } = {},
) {
  const response = await api.get("/memory", params(project, workspaceId, visibility, options));
  return textResult(response.data);
}

export async function memorySearch(
  project: string,
  workspaceId: string,
  query: string,
  visibility: MemoryVisibility = "private",
  options: { limit?: number; tokenBudget?: number; offset?: number } = {},
) {
  const response = await api.get("/memory/search", { ...params(project, workspaceId, visibility, options), q: query });
  return textResult(response.data);
}

export async function memoryUpdate(
  project: string,
  workspaceId: string,
  memoryId: string,
  operationId: string,
  expectedVersion: number,
  content: string,
  tags?: string[],
  visibility: MemoryVisibility = "private",
) {
  const response = await mutate(project, workspaceId, operationId, () => api.patch(
    `/memory/${encodeURIComponent(memoryId)}`,
    {
      operationId,
      workspaceId,
      expectedVersion,
      content,
      ...(tags === undefined ? {} : { tags }),
      ...(visibility === "private" ? {} : { visibility }),
    },
    { project },
  ));
  return textResult(response.data);
}

export async function memoryForget(
  project: string,
  workspaceId: string,
  memoryId: string,
  operationId: string,
  expectedVersion: number,
  visibility: MemoryVisibility = "private",
) {
  const response = await mutate(project, workspaceId, operationId, () => api.del(
    `/memory/${encodeURIComponent(memoryId)}`,
    { project },
    {
      operationId,
      workspaceId,
      expectedVersion,
      ...(visibility === "private" ? {} : { visibility }),
    },
  ));
  return textResult(response.data);
}

export async function memoryOperationStatus(project: string, workspaceId: string, operationId: string) {
  return textResult(await operationStatus(project, workspaceId, operationId));
}
