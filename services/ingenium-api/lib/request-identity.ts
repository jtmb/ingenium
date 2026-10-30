import type { Request } from "express";
import {
  authenticateRequestWithoutActivity,
  type AttestedCoordinationIdentity,
  type RequestPrincipal,
} from "./middleware/auth.js";
import { AppError } from "./middleware/errors.js";
import { MCP_REPORT_AUDIENCE } from "./mcp-report-auth.js";

type DomainPrincipal = Extract<RequestPrincipal, { type: "user" | "service" }>;
export interface CurrentRequestIdentity {
  principal: DomainPrincipal;
  attestation?: Readonly<AttestedCoordinationIdentity>;
}

function supported(value: RequestPrincipal | undefined): value is DomainPrincipal {
  return value?.type === "user" || (value?.type === "service" && value.audience !== MCP_REPORT_AUDIENCE);
}

function identityKey(principal: DomainPrincipal): string {
  return JSON.stringify({
    type: principal.type, id: principal.id, tokenId: principal.tokenId,
    organizationId: principal.organizationId, projectId: principal.projectId,
    scopes: [...new Set(principal.scopes)].sort(),
    ...(principal.type === "user"
      ? { sessionId: principal.session?.id, securityEpoch: principal.session?.security_epoch }
      : { projectIds: principal.projectIds === undefined ? undefined : [...new Set(principal.projectIds)].sort(),
        audience: principal.audience, workspaceId: principal.workspaceId,
        launcherWorktree: principal.launcherWorktree, storageMappingHash: principal.storageMappingHash }),
  });
}

function attestationKey(value: Readonly<AttestedCoordinationIdentity> | undefined): string {
  return JSON.stringify(value ? [value.credentialId, value.workspaceId, value.storageMappingHash] : null);
}

/** Reuse the original authentication owner on every domain operation. The
 * original middleware admission must already exist and remain the same identity.
 * No grant cache, activity write, fallback credential or request mutation occurs.
 */
export function revalidateRequestIdentity(request: Request): CurrentRequestIdentity | null {
  const admitted = request.principal;
  if (!supported(admitted)) return null;
  const admittedKey = identityKey(admitted), admittedAttestation = attestationKey(request.attestedCoordinationIdentity);
  const candidate = Object.create(request) as Request;
  Object.defineProperties(candidate, {
    principal: { value: undefined, writable: true, configurable: true },
    attestedCoordinationIdentity: { value: undefined, writable: true, configurable: true },
  });
  try {
    authenticateRequestWithoutActivity(candidate);
  } catch (error) {
    if (error instanceof AppError && [401, 403, 404].includes(error.statusCode)) return null;
    throw error;
  }
  const current = candidate.principal;
  if (!supported(current) || identityKey(current) !== admittedKey
    || attestationKey(candidate.attestedCoordinationIdentity) !== admittedAttestation) return null;
  const principal: DomainPrincipal = current.type === "user"
    ? { ...current, scopes: Object.freeze([...current.scopes]),
      ...(current.session ? { session: Object.freeze({ ...current.session }) } : {}) }
    : { ...current, scopes: Object.freeze([...current.scopes]),
      ...(current.projectIds ? { projectIds: Object.freeze([...current.projectIds]) } : {}) };
  const attestation = candidate.attestedCoordinationIdentity;
  return Object.freeze({ principal: Object.freeze(principal),
    ...(attestation ? { attestation: Object.freeze({ ...attestation }) } : {}) });
}