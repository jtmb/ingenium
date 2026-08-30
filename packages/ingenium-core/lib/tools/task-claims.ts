/** COORD-100's declarative claim grammar; it is not a runtime write-enforcement mechanism. */

export type TaskClaim =
  | { kind: "path"; path: string }
  | { kind: "tree"; path: string }
  | { kind: "reserved"; name: "@build" | "@repository" };

export type TaskCoordinationState =
  | "unmanaged"
  | "managed-clean"
  | "managed-reserved"
  | "managed-quarantined";

export const TASK_MANAGED_GUARANTEE_VOCABULARY: Record<TaskCoordinationState, string> = {
  unmanaged: "Unmanaged compatibility mode; no manual or external write guarantee exists until an accepted session epoch.",
  "managed-clean": "Managed coordination is clean; no manual or external write guarantee exists until an accepted session epoch.",
  "managed-reserved": "Managed coordination is reserved; no manual or external write guarantee exists until an accepted session epoch.",
  "managed-quarantined": "Managed coordination is quarantined; no manual or external write guarantee exists until an accepted session epoch.",
};

export interface TaskClaimGuaranteeDescriptor {
  readonly managedAgents: true;
  readonly sameProject: true;
  readonly canonicalWorktree: true;
  readonly acceptedSessionEpoch: true;
  readonly supportedClaims: readonly TaskClaim["kind"][];
  readonly exclusions: readonly ["manual editor", "external process", "transcripts", "historical audit"];
  readonly runtimeEnforcement: false;
}

/** The complete COORD-100 guarantee boundary; later waves may add runtime enforcement. */
export const TASK_CLAIM_GUARANTEE: TaskClaimGuaranteeDescriptor = Object.freeze({
  managedAgents: true,
  sameProject: true,
  canonicalWorktree: true,
  acceptedSessionEpoch: true,
  supportedClaims: Object.freeze(["path", "tree", "reserved"] as const),
  exclusions: Object.freeze(["manual editor", "external process", "transcripts", "historical audit"] as const),
  runtimeEnforcement: false,
});

const CONTROL = /[\u0000-\u001f\u007f]/;
const GLOB = /[*?\[\]{}!]/;
const SECRET_LIKE = /(^|[-_.])(secret|secrets|token|tokens|password|passwd|credential|credentials|private|apikey|api[-_]?key|id_rsa|env)([-_.]|$)/i;
const SECRET_PATH_SEGMENTS = new Set([
  ".ssh", ".gnupg", ".aws", ".npmrc", ".pypirc", ".netrc", ".git-credentials",
]);
const CREDENTIAL_CONFIG_FILE = /(?:credential|secret|token|password|passwd|api[-_]?key).+\.(?:json|ya?ml|toml|ini|conf|config)$/i;
const PRIVATE_KEY_FILENAMES = new Set(["id_ed25519", "id_rsa", "id_ecdsa", "id_dsa"]);
const RESERVED_NAMES = new Set(["@build", "@repository"]);

function isPrivateKeyFile(segment: string): boolean {
  const normalized = segment.toLowerCase();
  return PRIVATE_KEY_FILENAMES.has(normalized)
    || normalized.endsWith(".key")
    || normalized.endsWith(".pem");
}

function isSafePath(path: unknown): path is string {
  if (typeof path !== "string" || path.length === 0 || path.length > 1024) return false;
  if (
    path !== path.trim()
    || path.startsWith("/")
    || path.startsWith("~")
    || /^[A-Za-z]:\//.test(path)
    || path.includes("\\")
    || CONTROL.test(path)
    || GLOB.test(path)
  ) return false;
  const segments = path.split("/");
  return !segments.some((segment) => (
    segment.length === 0
    || segment === "."
    || segment === ".."
    || segment === ".git"
    || segment.startsWith("@")
    || SECRET_PATH_SEGMENTS.has(segment.toLowerCase())
    || SECRET_LIKE.test(segment)
    || CREDENTIAL_CONFIG_FILE.test(segment)
    || isPrivateKeyFile(segment)
  ));
}

/** Parse an exact claim shape into its canonical form, or reject it. */
export function parseTaskClaim(value: unknown): TaskClaim | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const claim = value as Record<string, unknown>;
  if (claim.kind === "path" || claim.kind === "tree") {
    if (Object.keys(claim).length !== 2 || !isSafePath(claim.path)) return undefined;
    return { kind: claim.kind, path: claim.path };
  }
  if (claim.kind === "reserved") {
    if (Object.keys(claim).length !== 2 || typeof claim.name !== "string" || !RESERVED_NAMES.has(claim.name)) return undefined;
    return { kind: "reserved", name: claim.name as "@build" | "@repository" };
  }
  return undefined;
}

export function isValidTaskClaim(value: unknown): value is TaskClaim {
  return parseTaskClaim(value) !== undefined;
}

/** Canonicalize a batch through the discriminated grammar, retaining stable order. */
export function canonicalTaskClaimBatch(value: unknown): TaskClaim[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) return undefined;
  const claims = value.map(parseTaskClaim);
  if (claims.some((claim) => claim === undefined)) return undefined;
  const canonical = claims as TaskClaim[];
  const identities = canonical.map((claim) => (
    claim.kind === "reserved" ? `reserved:${claim.name}` : `${claim.kind}:${claim.path}`
  ));
  if (new Set(identities).size !== identities.length) return undefined;
  return canonical;
}

function isSameOrDescendant(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** Segment-aware overlap for canonical claims. Invalid claims never overlap. */
export function taskClaimsOverlap(left: unknown, right: unknown): boolean {
  const first = parseTaskClaim(left);
  const second = parseTaskClaim(right);
  if (!first || !second) return false;
  if (first.kind === "reserved" || second.kind === "reserved") {
    if (first.kind === "reserved" && first.name === "@repository") return true;
    if (second.kind === "reserved" && second.name === "@repository") return true;
    return first.kind === "reserved" && second.kind === "reserved"
      && first.name === "@build" && second.name === "@build";
  }
  if (first.kind === "path" && second.kind === "path") return first.path === second.path;
  if (first.kind === "path" && second.kind === "tree") return isSameOrDescendant(first.path, second.path);
  if (first.kind === "tree" && second.kind === "path") return isSameOrDescendant(second.path, first.path);
  return isSameOrDescendant(first.path, second.path) || isSameOrDescendant(second.path, first.path);
}

export function taskCoordinationState(
  managed: boolean,
  reservationState: "available" | "reserved" | "quarantined",
): TaskCoordinationState {
  if (!managed) return "unmanaged";
  if (reservationState === "reserved") return "managed-reserved";
  if (reservationState === "quarantined") return "managed-quarantined";
  return "managed-clean";
}
