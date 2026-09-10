---
title: "WSL Docker Cleanup — Prune Images, Containers, Build Cache"
impact: MEDIUM
impactDescription: "Reclaims Docker disk space safely without risking important containers or volumes"
tags: [wsl, docker, cleanup, prune]
---

## WSL Docker Cleanup

All commands assume Docker is installed. Use `|| true` to tolerate missing Docker.

| Command | Description | Risk | Est. Space |
|---------|-------------|------|------------|
| `docker system df` | Assessment — show Docker disk usage breakdown | 🟢 Safe | 0 MB |
| `docker container prune` | Remove all stopped containers | 🟢 Safe | Varies |
| `docker image prune -a` | Remove all unused images | 🟡 Moderate | Varies |
| `docker builder prune` | Remove build cache | 🟢 Safe | 0.5-10 GB |
| `docker system prune -a --volumes` | Aggressive — removes ALL unused | 🔴 Destructive | 5-50 GB |

### Recommended Safe Workflow

```bash
# Step 1: Containers (always safe)
docker container prune

# Step 2: Unused images (confirm first)
docker image prune -a

# Step 3: Build cache (safe, no container impact)
docker builder prune

# Step 4: Show freed space
docker system df
```

Before aggressive pruning (`-a --volumes`), always show what would be removed:
```bash
docker system df --verbose | head -50
```
