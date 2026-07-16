---
title: Deployment Guide
description: Docker deployment guide — services, ports, volumes, health checks for the Ingenium system.
---

# Deployment Guide

> **Note:** This document is the canonical operations reference for deployment. The AGENTS.md file contains a summary only.

---

## Overview

Ingenium uses **single-container deployment** via Docker Compose. A single container runs **supervisord** managing four processes:

1. **API** (Express on :4097)
2. **Dashboard** (Next.js on :3000)
3. **opencode-web** (on :4098)
4. **ttyd-opencode** (on :4099)

---

## Quick Start

```bash
# Start all services (with build)
docker compose up --build

# Start without rebuild
docker compose up

# Stop all services
docker compose down

# View logs
docker compose logs -f

# Execute commands inside container
docker compose exec ingenium npm run test
docker compose exec ingenium npm run check
```

---

## Services

### 1. API (Express on :4097)

The sole DB authority. All CRUD operations flow through this service.

### 2. Dashboard (Next.js on :3000)

17 primary route-based pages plus the Settings overlay. Talks to the API layer only — zero direct DB access.

### 3. opencode-web (on :4098)

OpenCode web server. Binds **0.0.0.0** inside container via `--hostname 0.0.0.0` (supervisord.conf:45). The Docker Compose `ports` block publishes to HOST `127.0.0.1:4098` only — not exposed to LAN.

### 4. ttyd-opencode (on :4099)

OpenCode CLI terminal via ttyd. Provides the xterm.js terminal for the dashboard's CLI mode. Binds **0.0.0.0** inside container (no `--interface` flag; ttyd defaults to `0.0.0.0`). The Docker Compose `ports` block publishes to HOST `127.0.0.1:4099` only.

```bash
ttyd --port 4099 opencode attach http://localhost:4098 --dir /workspace
```

> 🔴 **`synthesis-engine` and `email-client` are NOT supervisord processes.** They are in-process scheduled tasks running inside the `ingenium-api` Express process. Do NOT add supervisord `[program:synthesis-engine]` or `[program:email-client]` blocks.

---

## Port Mappings

| Host Port | Service | Description |
|-----------|---------|-------------|
| `3000` | Dashboard | Next.js frontend (http://localhost:3000) |
| `4097` | API | Express REST gateway (sole DB authority) |
| `127.0.0.1:4098` | OpenCode Web | OpenCode web server — container binds **0.0.0.0** via `--hostname 0.0.0.0`; Compose publishes to `127.0.0.1:4098` (host loopback only) |
| `127.0.0.1:4099` | ttyd-opencode | OpenCode CLI terminal — container binds **0.0.0.0** (ttyd default); Compose publishes to `127.0.0.1:4099` (host loopback only) |

> 🔴 Dockerfile `EXPOSE` covers ports 3000, 4097, 4098, 4099.

---

## Volume Configurations

| Volume Name | Mount Path | Purpose |
|-------------|------------|---------|
| `ingenium-data` | `/app/.ingenium` | SQLite databases, learnings, tasks, projects, commands |
| `opencode-config` | `/home/appuser/.config` | OpenCode configuration (persists across rebuilds) |
| `opencode-data` | `/home/appuser/.local` | OpenCode user data, session state |

**Workspace bind-mount:** Your local `~/repos` is mounted at `/workspace` for file editing.

---

## Health Check

```yaml
healthcheck:
  test: ["CMD", "wget", "-qO-", "http://localhost:4097/api/v1/health"]
  interval: 30s
  timeout: 5s
  retries: 3
  start_period: 15s
```

---

## OpenCode Web/CLI Mode Switch

The dashboard `/opencode` page features a **dual-mode** interface:

- **Web mode** — Embeds `http://localhost:4098/` in a full-viewport iframe
- **CLI mode** — Embeds `http://localhost:4099/` in a full-viewport iframe
- **Glass tab**: Right-edge toggle (`backdrop-blur-sm`, `fixed right-0 top-1/2`). Expands on hover. Keyboard shortcut: `Ctrl+Shift+\``
- **Dual-iframe architecture**: Both iframes remain in the DOM. Inactive one hidden via `opacity: 0` / `visibility: hidden` / `pointer-events: none` (not `display:none`) to prevent xterm dimension zeroing
- **Mode persistence**: Saved in `localStorage` under `opencode-mode`

### Terminal Attachment (Direct)

```bash
opencode attach http://localhost:4098 --dir /workspace
```

All sessions (Web iframe, CLI ttyd, direct terminal) share the same backend process state.

---

## Dockerfile Notes

- **sudo**: Dockerfile installs `sudo` and grants `appuser` passwordless sudo access via `/etc/sudoers.d/appuser`
- **git**: Dockerfile installs `git` for OpenCode repository creation inside the container
- **Migrations**: The Dockerfile runtime stage does NOT copy `data/migrations/`. New migration `.sql` files must be manually placed (bind-mounted or copied) into the container for incremental DBs

---

## Application Health (In-Process Services)

The Status page reports `synthesis-engine` and `email-client` via:

```
GET /api/v1/services/applications/:name
```

This queries `synthesis.getSynthesisStatus()` and `ingenium-email`'s `getEngineStatus()` directly — NOT via supervisord. See `services/ingenium-api/lib/routes/services.ts` lines 216–289 for implementation.

---

## Typical Commands

```bash
# Build and start
docker compose up --build

# Start in background
docker compose up -d

# Tail logs
docker compose logs -f

# Restart a specific service
docker compose restart ingenium

# Execute tests inside container
docker compose exec ingenium npm test
docker compose exec ingenium npm run check

# Shell access
docker compose exec ingenium /bin/bash
```
