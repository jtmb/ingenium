---
title: Backup and Restore
description: Database backup and restore procedures, automated backup scheduling, migration recovery for the Ingenium SQLite database.
---

# Backup and Restore Procedures

This document covers backup and restore procedures for the Ingenium SQLite database and associated data.

The system supports **automated backup scheduling** (hourly/daily with configurable retention) and **dual-database snapshots** (Ingenium core DB + OpenCode session DB) — both manual and scheduled — backed by signed v2 manifests and a dry-run-only restore-plan lifecycle. RESTORE-100 does not apply data to active databases; it prepares the validated handoff consumed only by the fixed RESTORE-101 executor.

## RESTORE-100 Contract

RESTORE-100 is operator-command-first and server-global. A supported bundle is a
fixed-name directory containing exactly `manifest.json`, `ingenium.db`, and
`opencode.db`. The v2 manifest is HMAC-SHA256 signed and binds each component's
filename, byte size, SHA-256, required-table list, schema fingerprint, and
SQLite `user_version`; it also records `restore_min_migration: 83` and a `key_id`.
The signing key is a persistent owner-only file, never part of a bundle or API
response. Legacy backup records remain preview-only and cannot be authorized or
confirmed.

Migration 083 stores immutable plan identities, append-only revisions and audit
events, one-time hash-only authorizations, tamper-evident stages, and bounded
idempotency receipts. The only successful terminal preparation state is
`ready_for_executor`. The source backup remains preserved and referenced; there
is no active DB replacement, WAL operation, executor process, rollback action, or
off-host/resource restore in this contract.

---

## Automated Backup System

A background scheduler (`backup-scheduler.ts`) creates consistent snapshots on a configurable schedule. Backups consist of a pair of SQLite Backup API snapshots (Ingenium + OpenCode DB) stored in the backup directory.

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `INGENIUM_BACKUPS_DIR` | `/app/.ingenium/backups` | Directory for backup snapshot files. Empty or whitespace-only values are treated as unset. |
| `INGENIUM_RESTORE_STAGING_DIR` | `/app/.ingenium/restore-staging` | Separate owner-only root for plan-addressed, tamper-evident staged copies. |
| `INGENIUM_BACKUP_DOWNLOAD_MAX_BYTES` | `268435456` | Maximum verified backup-component download buffered in memory. Oversize components are rejected. |
| `INGENIUM_RESTORE_HANDOFF_MAX_BYTES` | `268435456` | Maximum total verified staged bytes returned to the future in-process executor handoff. |

Schedule configuration is managed via:

- **MCP tools**: `ingenium_backup_schedule_get`, `ingenium_backup_schedule_set`
- **Dashboard**: `/backups` page schedule panel
- **Default**: Scheduling is disabled until enabled. Retention defaults to 24 hourly, 7 daily, and 10 manual snapshots.

### Schedule Types

| Type | Frequency | Typical Retention |
|------|-----------|-------------------|
| `scheduled_hourly` | Every hour | 24 snapshots |
| `scheduled_daily` | Once daily | 7 snapshots |
| `manual` | On demand | Configurable |
| `pre_restore` | Reserved for pre-restore safety snapshots | Configurable |

### Backup Storage

Each backup is atomically published as a fixed-name directory in `INGENIUM_BACKUPS_DIR`:

```text
.backups/
└── <uuid>/
    ├── manifest.json        # Canonical signed v2 manifest
    ├── ingenium.db          # Ingenium core DB snapshot
    └── opencode.db          # OpenCode session DB snapshot
```

A `backup_records` DB table stores metadata: manifest SHA-256, backup type, and status. The signed manifest fixes both component names, hashes, sizes, current schema fingerprints, required table metadata, and SQLite `user_version` for both snapshots.

The backup resolver normalizes the configured directory once for snapshot creation,
downloads, and restore previews. When `INGENIUM_BACKUPS_DIR` is unset, empty, or
whitespace-only, it uses the canonical directory beside the core database
(`/app/.ingenium/backups` in Docker). Manifest component filenames must resolve
to a direct child of that directory; paths outside it are rejected.

### Ownership and project context

Backups are server-owned resources. Their `project_id` is the sole active
global project (`is_global = 1`), not the project selected by an external
worktree or dashboard URL. Migration `061_global_backup_ownership.sql`
backfills legacy backup records and restore jobs; startup repeats the
idempotent backfill after ensuring the global project exists. Backup API
requests ignore the `project` query parameter for ownership, so an external
URL context cannot read or mutate a different backup namespace.

### Schedule Management via MCP

```typescript
// Get current schedule
const schedule = await ingenium_backup_schedule_get({ project: "global-default" });

// Set schedule — hourly enabled, 48-hour retention
await ingenium_backup_schedule_set({
  project: "global-default",
  hourly: { enabled: true, retention: 48 },
  daily: { enabled: true, retention: 14 },
});
```

## Database Location

The primary SQLite database is stored at the path specified by `INGENIUM_CORE_DB_PATH`.
The deployed canonical path is `/app/.ingenium/data` (no `.db` suffix); do not
create or restore a sibling `data.db` file.

In Docker, this is on the `ingenium-data` volume mounted at `/app/.ingenium/`.
The volume survives image rebuilds. Keep the Compose project name stable and do
not run `docker compose down -v`; a changed project name selects a different
prefixed named volume.

---

## Backup Management via Dashboard

Navigate to **`/backups`** in the dashboard to:

- View all backups in a table with type badges, size, and timestamps
- Create a new manual backup with a single click
- Download backup files for off-site storage
- Delete old backups
- Configure the automated schedule with hourly and daily toggles

### Safe deletion and retry behavior

Deleting a v2 backup first records a durable deletion reservation. While that
reservation exists, a new restore preview for the backup is rejected, preventing
preview from racing bundle removal. The backup record is removed only after the
bundle removal and final database step succeed.

If filesystem or database cleanup fails, the reservation and backup inventory
row remain. The backup therefore stays discoverable in the list and the same
delete action can be retried; do not treat a failed delete response as proof that
the backup no longer exists.

## Backup Procedures

### Creating a Backup via MCP

```typescript
// Manual backup
const result = await ingenium_backup_create({
  project: "global-default",
  type: "manual",
});

// List all backups (the server resolves canonical global ownership)
const backups = await ingenium_backup_list({ project: "global-default" });

// Get a specific backup
const backup = await ingenium_backup_get({ project: "global-default", backupId: "<uuid>" });
```

### Restore Preview, Authorization, and Confirmation

```typescript
const preview = await ingenium_backup_restore_preview({
  project: "global-default", backupId: "<uuid>", dryRun: true, idempotencyKey: "preview-20260803",
});

const authorization = await ingenium_backup_restore_authorize({
  project: "global-default", planId: preview.id, expectedRevision: preview.revision,
});

const ready = await ingenium_backup_restore_start({
  project: "global-default", planId: preview.id, expectedRevision: authorization.plan.revision,
  confirmationToken: authorization.confirmationToken, idempotencyKey: "confirm-20260803",
});
```

Confirmation consumes the one-time authorization and copies both components into
a read-only (`0444` files under an owner-only directory), plan-ID-addressed staging
directory using verified file descriptors. File permissions are **not** treated as
filesystem immutability: every confirmed/ready status check and future executor
handoff reopens the fixed files without following symlinks, then rechecks hashes,
sizes, SQLite integrity, and signed schema compatibility. A mismatch appends the
content-free `stage_integrity_failed` audit event and moves the plan to `failed`.
The future executor receives only bounded verified in-memory buffers through a
trusted in-process Core handoff; buffers contain no file descriptor or pathname
and must be released (zeroed) after use. Neither REST nor MCP serializes them.
The plan becomes `ready_for_executor` only after the staged hashes match the
component hashes bound into its plan hash. The API never replaces active database
files and exposes no executor route. The preflight validates the signed manifest,
component hashes, SQLite integrity, and exact current schema compatibility for
both snapshots.

Downloads are copied from a verified descriptor into a bounded in-memory buffer,
hashed again, and unlinked before the HTTP response begins. The response buffer is
wiped on finish, close, or error; no live file descriptor or `/proc/.../fd` path is
streamed to clients.

### Hot Backup (WAL Mode)

The database uses WAL journal mode, which allows hot backups while the application is running.

Use the SQLite Backup API or the dashboard/MCP backup workflow while the service
is running. Do not copy only the main database file while a WAL is active:
committed mail/settings may still be in the WAL. If an operator must make a
file-level backup, stop the service first, or preserve `data`, `data-wal`, and
`data-shm` as one set.

```bash
# Canonical deployed file; run inside the container
sqlite3 /app/.ingenium/data ".backup '/app/.ingenium/data.snapshot'"
```

### Using SQLite Backup API (Recommended)

The `.backup` command creates a consistent snapshot even during writes:

```bash
sqlite3 /app/.ingenium/data ".backup /app/.ingenium/data.snapshot"
```

### Docker Backup

```bash
# Backup from running container
docker compose exec ingenium bash -c "sqlite3 /app/.ingenium/data '.backup /app/.ingenium/data.snapshot'"

# Copy backup to host
docker compose cp ingenium:/app/.ingenium/data.snapshot ./data.snapshot-$(date +%Y%m%d)

# Full volume backup (stops the container briefly)
docker compose stop ingenium
docker run --rm -v ingenium_ingenium-data:/data -v "$(pwd)":/backup alpine tar czf /backup/ingenium-data-$(date +%Y%m%d).tar.gz -C /data .
docker compose start ingenium
```

### Database File Structure

The `.ingenium/` directory contains:

```
.ingenium/
├── data               # Main SQLite database (canonical deployed filename)
├── data-wal           # Write-Ahead Log (may not exist after checkpoint)
├── data-shm           # Shared Memory file (may not exist after checkpoint)
├── attachments/       # File attachments from docs workspace
└── ...                # Other runtime data
```

---

## Restore Procedures

### Gateway Deployment Rollback

The local gateway has no password file, so a rebuild does not change persisted
Ingenium or OpenCode volumes. Before a deployment change, create a manual backup
from `/backups` (or `ingenium_backup_create`). If the new deployment is unhealthy:

```bash
# Stop the current container and return to the previously known-good checkout/image
docker compose down
# restore the previous image or checkout, then recreate the service
docker compose up --build -d
```

If data must also be reverted, use the restore preview/authorization workflow below; do not
replace active database files while the service is running. After restoring, restart
the container and verify API health and both local gateway roots.

### Standard Restore (not RESTORE-100)

Active database replacement is not available in RESTORE-100. Do not copy
snapshot files over the live database or remove WAL/SHM files as part of a
restore plan. Use preview → authorize → confirm above, then stop at
`ready_for_executor`; active apply belongs to RESTORE-101.

### Restore from Docker Backup (RESTORE-101)

Never copy bundle files over the live databases. After a plan reaches
`ready_for_executor`, issue the separate execution authorization and submit its
one-time token to the RESTORE-101 execute endpoint or MCP tool. It returns
`202` only after the fixed root-only Supervisor executor accepts the handoff;
an unavailable Supervisor produces a durable terminal `SUPERVISOR_FAILED`
outcome and a `503` response rather than a stranded queue. The request never
accepts a file path, command, or target override. The executor creates a safety
snapshot, performs the verified paired swap, or rolls back before normal
services restart. Preserve the source bundle throughout; container-start
recovery consumes signed journals before Supervisor can start database users.

---

## Migration Recovery

### If a migration fails...

1. **Identify the failed migration** from the API logs
2. **Check for orphaned `_old` tables**:
   ```bash
   sqlite3 /app/.ingenium/data ".tables" | grep "_old$"
   ```
3. **Check FTS integrity**:
   ```bash
   sqlite3 /app/.ingenium/data "SELECT COUNT(*) FROM observations_fts;"
   sqlite3 /app/.ingenium/data "SELECT COUNT(*) FROM observations;"
   ```

### Common Recovery Scenarios

| Symptom | Likely Cause | Solution |
|---------|-------------|----------|
| `SQLITE_LOCKED` errors | `checkpointAfterWrite()` inside `execTransaction()` | Move checkpoint outside transaction (see WAL Safety pattern) |
| `FOREIGN KEY constraint failed` during synthesis | Orphaned `observations_old` table with dangling FTS triggers | Drop `observations_old`, rebuild FTS |
| `SQLITE_CONSTRAINT_CHECK` in UI | Zod schema allows value that CHECK constraint rejects | Handle `SQLITE_CONSTRAINT` client-side or validate against same list |
| Missing skills in dashboard | `UNIQUE` constraint conflict (skills_unique_per_project) | Rebuild `skills` table with correct UNIQUE(project_id, name) |

### Full Manual Repair

See [database-migrations.md](../reference/database-migrations.md) for complete manual DB repair instructions, including:

- Repairing a failed 015 migration (recreating FTS triggers)
- Repairing a failed 024 migration (rebuilding skills table constraint)
- Verifying FK integrity with `PRAGMA foreign_key_check`

---

## Verification After Restore

```bash
# 1. Check database integrity
sqlite3 /app/.ingenium/data "PRAGMA integrity_check;"

# 2. Check foreign key integrity
sqlite3 /app/.ingenium/data "PRAGMA foreign_key_check;"

# 3. Verify key tables have data
sqlite3 /app/.ingenium/data "SELECT COUNT(*) FROM projects;"
sqlite3 /app/.ingenium/data "SELECT COUNT(*) FROM skills;"

# 4. Check the API responds
curl --config "${XDG_CONFIG_HOME:-$HOME/.config}/ingenium/api-curl.conf" \
  http://localhost:4097/api/v1/health
```

---

## 🔴 Best Practices

1. **Always back up before running migrations** — especially 015, 024, and 025 which involve table rebuilds
2. **Use `.backup` command** for consistent snapshots — never just `cp` a database while it's under write load without WAL checkpoint first
3. **Remove WAL/SHM files after restore** — stale WAL files can cause corruption when replayed against a different DB state
4. **Run `PRAGMA integrity_check` after any restore** to verify the database is healthy
5. **Keep at least 3 backup rotations** — daily snapshots for the last week, weekly for the last month
