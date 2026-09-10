---
title: "Docker Ecosystem Management — Cleanup, Cache, Volumes, Logs"
impact: MEDIUM
impactDescription: "Prevents disk-full incidents and reclaims wasted space from stale Docker artifacts"
tags: [docker, cleanup, prune, volumes, build-cache, logs]
---

## Docker Ecosystem Management & Cleanup

### 1. Pre-flight Assessment (Always First)

Before any cleanup operation, run these commands to assess current state:

```bash
# Disk usage by mount point
df -h

# Docker disk usage breakdown
docker system df || true

# Build cache size (BuildKit or classic)
du -sh /var/lib/docker/buildkit/* 2>/dev/null | sort -hr | head -10 || true

# Dangling volumes (unmounted, anonymous only — safe to review)
docker volume ls -qf dangling=true 2>/dev/null || echo "(none or docker not installed)"

# Journal disk usage
journalctl --disk-usage 2>/dev/null || true
```

Review the output and identify where the space pressure is before proposing specific cleanups.

### 2. Build Cache Optimization

Each instruction in a Dockerfile translates to a layer in the final image. When a layer changes, that layer and all downstream layers must rebuild.

**Cache invalidation:** When a layer changes, that layer and all downstream layers rebuild.

**Best practices for faster builds:**
1. Order instructions so most frequently changing ones come last
2. Use `.dockerignore` to exclude unnecessary files
3. Leverage multi-stage builds to keep final images small
4. Consider `--pull=never` on base image layers for faster offline rebuilds

### 3. Docker System Prune

| Option | Default | Effect | Risk Level |
|--------|---------|--------|------------|
| (no flags) | — | Remove stopped containers, unused networks, dangling images, build cache | 🟢 Safe |
| `-a`, `--all` | | Also remove UNUSED images | 🟡 Moderate |
| `--volumes` | | Prune ANONYMOUS volumes not used by any container | 🟡 Moderate |
| `-f`, `--force` | | Skip interactive prompt | ⚠️ Requires prior user approval |

**Safe default workflow:**
```bash
docker container prune || true
docker image prune -a --dry-run 2>&1 | head -30 || true
read -p "Remove unused images? (y/N) " -n 1 -r
[[ $REPLY =~ ^[Yy]$ ]] && docker image prune -a || echo "skipped"
docker builder prune || true
docker system df
```

### 4. Volume Lifecycle Management

**Golden rule:** NEVER prune named volumes — they may contain persistent data.

**Finding unmounted anonymous volumes (safe to review):**
```bash
docker volume ls -qf dangling=true
```

**Safe to remove** if confirmed orphaned:
```bash
docker system prune --volumes || true
# Or manually:
docker volume inspect <volume-name>
docker volume rm dangling_volume_abc123 || true
```

### 5. Garbage Collection (`docker system gc`)

Removes intermediate container layers that have been committed to an image. Safe to run regularly:

```bash
docker system gc 2>/dev/null || true
```

Does NOT affect running containers, built images, or named volumes.

### 6. Log Size Management

Set log driver options to prevent log bloat:
```json
{
  "LogConfig": {
    "Type": "json-file",
    "Options": {
      "max-size": "10m",
      "max-file": "3"
    }
  }
}
```

This limits each log file to 10MB and keeps only 3 files.

### 7. Comprehensive Cleanup Script

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== DISK USAGE ==="
df -h || true

echo "=== DOCKER STORAGE BY TYPE ==="
docker system df 2>/dev/null || echo "(Docker not installed)" || true

echo "=== BUILD CACHE PREVIEW ==="
if command -v docker &>/dev/null; then
    docker builder prune --dry-run 2>&1 | head -50 || true
fi

echo "=== DANGLING VOLUMES ==="
if command -v docker &>/dev/null; then
    docker volume ls -qf dangling=true 2>/dev/null || echo "(none)"
fi

journalctl --disk-usage 2>/dev/null || true

read -p "Run full prune? (y/N) " -n 1 -r
[[ $REPLY =~ ^[Yy]$ ]] && {
    echo ""
    echo "Step 1: Remove stopped containers..."
    docker container prune || true
    echo "Step 2: Remove dangling images (preview first)..."
    docker image prune -a --dry-run 2>&1 | head -30 || true
    read -p "Continue with removal? (y/N) " -n 1 -r
    [[ $REPLY =~ ^[Yy]$ ]] && docker image prune -a || echo "(skipped)"
    echo "Step 3: Remove build cache..."
    docker builder prune || true
    echo "=== CLEANUP COMPLETE ==="
    df -h
}
```
