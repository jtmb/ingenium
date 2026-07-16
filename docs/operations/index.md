---
title: Operations
description: Deployment, maintenance, and recovery procedures for the Ingenium system.
---

# Operations

Deployment, maintenance, and recovery procedures for the Ingenium system.

---

## Documents

| Document | Description |
|----------|-------------|
| [Getting Started](getting-started.md) | Step-by-step setup guide for OpenCode |
| [Deployment](deployment.md) | Docker deployment guide: services, ports, volumes, health checks |
| [Backup & Restore](backup-restore.md) | Database backup and restore procedures, migration recovery |
| [Jobs](jobs.md) | Job queue and background task monitoring |
| [Logs](logs.md) | Structured logging and event viewer |
| [Status](status.md) | Service status page — process and application monitoring |

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

- [Database Migrations](../develop/database.md) — Migration file list, WAL safety, manual repair
