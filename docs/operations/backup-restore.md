---
title: Backup and Restore
description: Database backup and restore procedures, automated backup scheduling, migration recovery for the Ingenium SQLite database.
---

# Backup and Restore Procedures

This document covers backup and restore procedures for the Ingenium SQLite database and associated data.

The system supports **automated backup scheduling** (hourly/daily with configurable retention) and **dual-database snapshots** (Ingenium core DB + OpenCode session DB) — both manual and scheduled — backed by SHA-256 manifest verification and a restore-job lifecycle.

---

## Automated Backup System

A background scheduler (`backup-scheduler.ts`) creates consistent snapshots on a configurable schedule. Backups consist of a pair of SQLite Backup API snapshots (Ingenium + OpenCode DB) stored in the backup directory.

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `INGENIUM_BACKUPS_DIR` | `/app/.ingenium/backups` | Directory for backup snapshot files. Empty or whitespace-only values are treated as unset. |

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

Each backup creates two files in `INGENIUM_BACKUPS_DIR`:

```text
.backups/
├── <uuid>.db               # Ingenium core DB snapshot
└── <uuid>.opencode.db       # OpenCode session DB snapshot
```

A `backup_records` DB table stores metadata: SHA-256 hashes, backup type, component manifest, and status. The manifest JSON includes `schema_version`, `ingenium` component (filename, sha256, size_bytes), and `opencode` component.

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
const backup = await ingenium_backup_get({ project: "global-default", backup_id: "<uuid>" });
```

### Restore Preview & Confirmation

```typescript
// Preview what would be restored
const preview = await ingenium_backup_restore_preview({ backup_id: "<uuid>" });

// Confirm a validated restore job (requires explicit confirmation)
const job = await ingenium_backup_restore_start({
  project: "global-default",
  backup_id: "<uuid>",
  confirm: true,
});

// Check restore status
const status = await ingenium_backup_restore_status({ job_id: "<job-uuid>" });
```

The API currently records a confirmed restore job and returns
`restartRequired: true`; it does **not** replace either active database. Applying
a confirmed snapshot remains an operator-controlled maintenance action outside
the API contract. The supported restore workflow is therefore limited to
preflight, explicit confirmation, job-status tracking, and an operator-led
isolated maintenance restore. It does not claim or apply unsupported
destructive restoration of arbitrary project data. The restore preflight validates:
1. Backup record exists in DB
2. Component files exist on disk with matching SHA-256
3. Ingenium snapshot passes `PRAGMA integrity_check`
4. Snapshot has migration 047 schema (`backup_records` table exists)

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

If data must also be reverted, use the restore preview/job workflow below; do not
replace active database files while the service is running. After restoring, restart
the container and verify API health and both local gateway roots.

### Standard Restore

```bash
# 1. Stop the API service
docker compose stop ingenium

# 2. Restore from snapshot
cp data.snapshot /app/.ingenium/data

# 3. Remove stale WAL/SHM files (they may contain conflicting state)
rm -f /app/.ingenium/data-wal /app/.ingenium/data-shm

# 4. Start the service
docker compose start ingenium
```

### Restore from Docker Backup

```bash
# 1. Copy backup into container
docker compose cp ./data.snapshot ingenium:/app/.ingenium/data

# 2. Restart to force re-read
docker compose restart ingenium
```

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
