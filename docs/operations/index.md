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
| [Context Checkpoint Maintenance](context-maintenance.md) | Safe immutable-context preview, authorization, archive, audit, and restore-as-new procedure |
| [Jobs](jobs.md) | Job queue and background task monitoring |
| [Logs](logs.md) | Structured logging and event viewer |
| [Status](status.md) | Service status page — process and application monitoring |
| [WSL2 Network](wsl2-network.md) | Windows/WSL localhost networking and recovery |

---

## Quick Reference

```bash
# Compatibility — keep the project name stable across rebuilds/restarts
export IMAGE_REVISION="$(git rev-parse HEAD)"
docker compose --profile compatibility -p ingenium up --build -d

# View logs (Docker)
docker compose --profile compatibility logs -f

# Execute inside container (Docker)
docker compose --profile compatibility exec ingenium /bin/bash

# Backup database (Docker)
docker compose --profile compatibility -p ingenium exec ingenium bash -c "sqlite3 /app/.ingenium/data '.backup /app/.ingenium/data.snapshot'"
```

---

## Related Documents

- [Database Migrations](../develop/database.md) — Migration file list, WAL safety, manual repair
