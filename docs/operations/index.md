# Operations

Deployment, maintenance, and recovery procedures for the Ingenium system.

---

## Documents

| Document | Description |
|----------|-------------|
| [Deployment](./deployment.md) | Docker deployment guide: services, ports, volumes, health checks |
| [Backup & Restore](./backup-restore.md) | Database backup and restore procedures, migration recovery |

---

## Quick Reference

```bash
# Start all services
docker compose up --build

# View logs
docker compose logs -f

# Execute inside container
docker compose exec ingenium /bin/bash

# Backup database
docker compose exec ingenium bash -c "sqlite3 /app/.ingenium/data.db '.backup /app/.ingenium/data.db.backup'"
```

---

## Related Documents

- [Database Migrations](../reference/database-migrations.md) — Migration file list, WAL safety, manual repair
- [Deployment Details](./deployment.md) — Full deployment reference
