import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

const FIXTURE_BASENAME = /^ingenium-restore-fixture-[A-Za-z0-9_-]+$/;
const FIXTURE_MANIFEST = ".ingenium-restore-fixture.json";
const FIXTURE_NONCE = /^[a-f0-9]{64}$/;
const APPROVED_TEMP_ROOTS = ["/tmp", "/var/tmp"] as const;
const PRODUCTION_ROOTS = ["/app/.ingenium", "/home/ingenium-opencode/.local/share/opencode"] as const;

let authorizedFixtureRoot: string | null = null;

function refuse(): never {
  throw new Error("Unsafe restore maintenance fixture root");
}

function approvedRootFor(root: string): string {
  for (const candidate of APPROVED_TEMP_ROOTS) {
    let approved: string;
    try {
      approved = realpathSync(candidate);
    } catch {
      continue;
    }
    const pathFromApprovedRoot = relative(approved, root);
    if (pathFromApprovedRoot && pathFromApprovedRoot !== ".." && !pathFromApprovedRoot.startsWith("../") && !isAbsolute(pathFromApprovedRoot)) {
      return approved;
    }
  }
  return refuse();
}

export function validateRestoreMaintenanceFixtureRoot(
  requestedRoot: string,
  nonce: string,
  expectedUid = typeof process.getuid === "function" ? process.getuid() : -1,
): string {
  if (process.env.NODE_ENV !== "test" || expectedUid < 0 || !FIXTURE_NONCE.test(nonce)) refuse();
  if (!isAbsolute(requestedRoot) || requestedRoot !== resolve(requestedRoot)) refuse();
  if (PRODUCTION_ROOTS.some((root) => requestedRoot === root || requestedRoot.startsWith(`${root}/`))) refuse();

  const canonicalRoot = realpathSync(requestedRoot);
  if (canonicalRoot !== requestedRoot || !FIXTURE_BASENAME.test(basename(canonicalRoot))) refuse();
  const approvedRoot = approvedRootFor(canonicalRoot);
  const approved = lstatSync(approvedRoot);
  if (!approved.isDirectory() || approved.isSymbolicLink()) refuse();

  for (let current = canonicalRoot; current !== approvedRoot; current = dirname(current)) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== expectedUid || (stat.mode & 0o022) !== 0 || stat.dev !== approved.dev) {
      refuse();
    }
  }

  const manifestPath = resolve(canonicalRoot, FIXTURE_MANIFEST);
  const descriptor = openSync(manifestPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.uid !== expectedUid || (stat.mode & 0o777) !== 0o600 || stat.dev !== approved.dev || stat.nlink !== 1) refuse();
    const manifest = JSON.parse(readFileSync(descriptor, "utf8")) as Record<string, unknown>;
    if (Object.keys(manifest).sort().join(",") !== "nonce,version" || manifest.version !== 1 || manifest.nonce !== nonce) refuse();
  } finally {
    closeSync(descriptor);
  }
  return canonicalRoot;
}

export function authorizeRestoreMaintenanceFixture(requestedRoot: string, nonce: string): string {
  authorizedFixtureRoot = validateRestoreMaintenanceFixtureRoot(requestedRoot, nonce);
  return authorizedFixtureRoot;
}

export function clearRestoreMaintenanceFixtureAuthorization(): void {
  authorizedFixtureRoot = null;
}

export function isAuthorizedRestoreMaintenanceFixturePath(path: string): boolean {
  if (!authorizedFixtureRoot) return false;
  try {
    return realpathSync(path).startsWith(`${authorizedFixtureRoot}/`);
  } catch {
    return false;
  }
}
