# Backup and Restore Procedures

This document covers backup and restore procedures for the Ingenium SQLite database and associated data.

---

## Database Location

The primary SQLite database is stored at the path specified by `INGENIUM_CORE_DB_PATH` (default: `./.ingenium/data.db`).

In Docker, this is on the `ingenium-data` volume mounted at `/app/.ingenium/`.

---

## Backup Procedures

### Hot Backup (WAL Mode)

The database uses WAL journal mode, which allows hot backups while the application is running.

```bash
# 1. Trigger a checkpoint to minimize WAL size
sqlite3 .ingenium/data.db "PRAGMA wal_checkpoint(TRUNCATE);"

# 2. Copy the database files (both main file and WAL/SHM if present)
cp .ingenium/data.db .ingenium/data.db.backup-$(date +%Y%m%d-%H%M%S)

# 3. If WAL file exists, copy it too (for crash-consistent backup)
cp .ingenium/data.db-wal .ingenium/data.db-wal.backup 2>/dev/null || true
cp .ingenium/data.db-shm .ingenium/data.db-shm.backup 2>/dev/null || true
```

### Using SQLite Backup API (Recommended)

The `.backup` command creates a consistent snapshot even during writes:

```bash
sqlite3 .ingenium/data.db ".backup .ingenium/data.db.snapshot"
```

### Docker Backup

```bash
# Backup from running container
docker compose exec ingenium bash -c "sqlite3 /app/.ingenium/data.db '.backup /app/.ingenium/data.db.backup'"

# Copy backup to host
docker compose cp ingenium:/app/.ingenium/data.db.backup ./data.db.backup-$(date +%Y%m%d)

# Full volume backup (stops the container briefly)
docker compose down
docker run --rm -v ingenium_data:/data -v $(pwd):/backup alpine tar czf /backup/ingenium-data-$(date +%Y%m%d).tar.gz -C /data .
docker compose up -d
```

### Database File Structure

The `.ingenium/` directory contains:

```
.ingenium/
├── data.db            # Main SQLite database
├── data.db-wal        # Write-Ahead Log (may not exist after checkpoint)
├── data.db-shm        # Shared Memory file (may not exist after checkpoint)
├── attachments/       # File attachments from docs workspace
└── ...                # Other runtime data
```

---

## Restore Procedures

### Standard Restore

```bash
# 1. Stop the API service
docker compose stop ingenium

# 2. Restore from snapshot
cp data.db.snapshot .ingenium/data.db

# 3. Remove stale WAL/SHM files (they may contain conflicting state)
rm -f .ingenium/data.db-wal .ingenium/data.db-shm

# 4. Start the service
docker compose start ingenium
```

### Restore from Docker Backup

```bash
# 1. Copy backup into container
docker compose cp ./data.db.backup ingenium:/app/.ingenium/data.db

# 2. Restart to force re-read
docker compose restart ingenium
```

---

## Migration Recovery

### If a migration fails...

1. **Identify the failed migration** from the API logs
2. **Check for orphaned `_old` tables**:
   ```bash
   sqlite3 .ingenium/data.db ".tables" | grep "_old$"
   ```
3. **Check FTS integrity**:
   ```bash
   sqlite3 .ingenium/data.db "SELECT COUNT(*) FROM observations_fts;"
   sqlite3 .ingenium/data.db "SELECT COUNT(*) FROM observations;"
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
sqlite3 .ingenium/data.db "PRAGMA integrity_check;"

# 2. Check foreign key integrity
sqlite3 .ingenium/data.db "PRAGMA foreign_key_check;"

# 3. Verify key tables have data
sqlite3 .ingenium/data.db "SELECT COUNT(*) FROM projects;"
sqlite3 .ingenium/data.db "SELECT COUNT(*) FROM skills;"

# 4. Check the API responds
curl http://localhost:4097/api/v1/health
```

---

## 🔴 Best Practices

1. **Always back up before running migrations** — especially 015, 024, and 025 which involve table rebuilds
2. **Use `.backup` command** for consistent snapshots — never just `cp` a database while it's under write load without WAL checkpoint first
3. **Remove WAL/SHM files after restore** — stale WAL files can cause corruption when replayed against a different DB state
4. **Run `PRAGMA integrity_check` after any restore** to verify the database is healthy
5. **Keep at least 3 backup rotations** — daily snapshots for the last week, weekly for the last month
