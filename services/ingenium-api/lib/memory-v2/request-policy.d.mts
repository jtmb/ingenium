import type { MemoryActor } from './adapters.mjs';
export function authorizeMemoryRequestOperation(input: {
  permission: string; expectedPrincipal: MemoryActor; identity: { principal: MemoryActor } | null; method: string;
  csrf: (principal: MemoryActor) => boolean;
  decide: (principal: MemoryActor, permission: 'read' | 'write') => boolean;
}): boolean;

export function mapRequestExecutionFailure(error: unknown, ErrorClass: new (code: string, status?: number) => Error): import('./lifecycle.mjs').MemoryError;
