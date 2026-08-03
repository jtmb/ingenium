import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const entrypoint = readFileSync(fileURLToPath(new URL("../../../scripts/docker-entrypoint.sh", import.meta.url)), "utf8");
const restoreLauncher = readFileSync(fileURLToPath(new URL("../../../scripts/run-restore-maintenance.sh", import.meta.url)), "utf8");

describe("RESTORE-100 signing-key entrypoint contract", () => {
  it("creates a single owner-only random key outside backups without following a final-path symlink", () => {
    expect(entrypoint).toContain('BACKUP_SIGNING_KEY_FILE="${INGENIUM_BACKUP_SIGNING_KEY_FILE:-/app/.ingenium/backup-signing-key}"');
    expect(entrypoint).toContain('dd if=/dev/urandom of="$backup_key_tmp" bs=32 count=1');
    expect(entrypoint).toContain('ln "$backup_key_tmp" "$BACKUP_SIGNING_KEY_FILE"');
    expect(entrypoint).toContain('backup_key_metadata="$(stat -c \'%a:%U:%G\' "$BACKUP_SIGNING_KEY_FILE")"');
    expect(entrypoint).toContain('"600:appuser:appuser"');
    expect(entrypoint).toContain('backup signing key must be outside backups');
    expect(entrypoint).toContain('backup signing key must be a regular non-symlink file');
    expect(entrypoint).toContain('CORE_DB_PATH="/app/.ingenium/data"');
    expect(entrypoint).toContain('ln "$core_db_tmp" "$CORE_DB_PATH"');
    expect(entrypoint).toContain('core database path must be a regular non-symlink file');
    expect(entrypoint).toContain('node --input-type=module -e \'import { getDb } from "ingenium-core"; getDb();\'');
    expect(entrypoint).toContain('ERROR: core database initialization failed');
    expect(entrypoint).toContain('for sidecar in "$CORE_DB_PATH-wal" "$CORE_DB_PATH-shm"; do');
    expect(entrypoint).toContain('core database sidecar must be a regular non-symlink file');
    expect(entrypoint).toContain('chmod 1770 /app/.ingenium');
    expect(entrypoint).toContain('PROJECTS_DIR="/app/.ingenium/projects"');
    expect(entrypoint).toContain('projects root must be a real non-symlink directory');
    expect(entrypoint).toContain('BACKUPS_DIR="/app/.ingenium/backups"');
    expect(entrypoint).toContain('backups root must be a real non-symlink directory');
    expect(entrypoint).toContain('RESTORE_STAGING_DIR="${INGENIUM_RESTORE_STAGING_DIR:-/app/.ingenium/restore-staging}"');
    expect(entrypoint).toContain('restore staging must be a real non-symlink directory');
    expect(restoreLauncher).toContain('INGENIUM_RESTORE_MAINTENANCE_MODE="execute"');
  });
});
