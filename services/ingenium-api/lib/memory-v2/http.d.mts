export interface MemoryRequest {
  action: string; method: string; chatId?: string; operationId?: string; body?: Record<string, unknown>; query?: Record<string, number>;
}
export function memoryResponse(
  memory: import('./lifecycle.mjs').MemoryLifecycle,
  resolveScope: (request: MemoryRequest, permission: import('./lifecycle.mjs').MemoryPermission) => import('./lifecycle.mjs').MemoryScope | null,
  request: MemoryRequest,
): { status: number; headers: Record<string, string>; body: { data?: unknown; error?: { code: string; message: string } } };
