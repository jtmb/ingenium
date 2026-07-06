---
name: docker
description: "Docker ecosystem management — build cache optimization, garbage collection, volume lifecycle, log management. Best practices from docs.docker.com."
---

# Docker Ecosystem Management & Cleanup

## When to Use
Invoke this skill when the user needs help with:
- "optimize docker builds" 
- "check .dockerignore patterns"
- "analyze build cache size"
- "remove unused images safely"
- "cleanup old containers"
- "prune Docker system"
- "garbage collection explanation"
- "volume management best practices"

## 🔴 HARD RULEs (from `.agents/skills/wsl-cleanup/SKILL.md`)
These rules override everything else. They are not optional.

### 🔴 NEVER Touch `$HOME/repos` or `/mnt`
**The `$HOME/repos` directory and all subdirectories are off-limits.** No cleanup, no listing, no analysis, no operations of any kind inside `$HOME/repos`. **The `/mnt` directory (Windows drive mounts) is also off-limits.** These are the only exclusions — everything else in `$HOME` may be fair game with proper confirmation.

Before running ANY command that operates on paths, verify the path does not start with `$HOME/repos`, `/mnt`, or a resolved equivalent.

### 🔴 Assess Before Acting
**Show disk usage before any destructive operation.** Always run `df -h` as the first step so both you and the user know what space is available and where the pressure is.

### 🔴 Confirm Before Destruction
**Always confirm with the user before running any destructive command.** A destructive command is any command that removes, prunes, purges, or deletes data — including `docker system prune`, `apt autoremove --purge`, `rm -rf`, `journalctl --vacuum-*`, and `ollama rm`. Show the expected impact (estimated space, what will be removed) and wait for explicit approval.

### 🔴 Shell Safety Patterns
**Every multi-command shell statement must follow `set -euo pipefail` safety patterns.** Reference `.agents/skills/shell-scripts/SKILL.md` for details:
- Use `|| true` tolerance for commands that may fail (Docker not installed, no journals, etc.)
- Quote all variable expansions: `"$HOME"` not `$HOME`
- Use `[[ ]]` for conditionals
- Use `trap` for cleanup if running a multi-step script
- Never background processes with `&`

### 🔴 No Force Flags Without Confirmation
**Never use `--force` or equivalent flags without explicit user confirmation.** This includes `docker system prune --force`, and similar. Show the user the exact command with `-f` and explain why it's needed before asking permission.

## 1. Pre-flight Assessment (Always First)

Before any cleanup operation, run these commands to assess current state:

```bash
# Disk usage by mount point
df -h

# Docker disk usage breakdown
docker system df || true

# Build cache size (BuildKit or classic)
du -sh /var/lib/docker/buildkit/* 2>/dev/null | sort -hr | head -10 || true
du -sh /var/lib/docker/ 2>/dev/null || true

# Dangling volumes (unmounted, anonymous only — safe to review)
docker volume ls -qf dangling=true 2>/dev/null || echo "(none or docker not installed)"

# Journal disk usage
journalctl --disk-usage 2>/dev/null || true
```

**Review the output and identify where the space pressure is before proposing specific cleanups.** Present the findings to the user and suggest a plan.

## 2. Build Cache Optimization (docs.docker.com reference)

### How it works
Each instruction in a Dockerfile translates to a layer in your final image. You can think of image layers as a stack, with each layer adding more content on top:

- **FROM** → base image layer
- **RUN** → execution result layer  
- **COPY/ADD** → file contents layer
- **WORKDIR**, **ENV**, etc. → metadata layers

When you build the same Docker image multiple times, understanding how the build cache works is key to making builds run fast:

```dockerfile
FROM ubuntu:latest                     # Layer 1
RUN apt-get update && install-tools    # Layer 2 (rebuilds if apt version changes)
COPY main.c Makefile /src/            # Layer 3 (rebuilds if any source file changes)
WORKDIR /src/                         # Layer 4
RUN make build                        # Layer 5 (rebuilds if make, gcc, or main.c changes)
```

**Cache invalidation:** When a layer changes, that layer and **all downstream layers** must rebuild:

- Modify `main.c` → COPY layer rebuilds + RUN "make build" rebuilds
- Change FROM instruction → entire stack rebuilds from scratch

### Best practices for faster builds:

1. **Order instructions so most frequently changing ones come last.** Put code changes (COPY of source files) at the end, so toolchain and system layers can be cached across many builds.

2. **Use `.dockerignore` to exclude unnecessary files from build context.** This reduces layer size and prevents accidental cache invalidation:
   ```
   node_modules/
   vendor/
   target/
   build/
   dist/
   __pycache__/
   .git/
   *.md (docs)
   .env* (secrets)
   docker-compose*.yml (dev only)
   ```

3. **Leverage multi-stage builds** to keep final images small and reduce layer count:
   ```dockerfile
   # Build stage — includes all dependencies, caches, source files
   FROM golang:1.21 AS builder
   WORKDIR /app
   COPY . .
   RUN go build -o myapp

   # Final stage — only the binary and runtime dependencies
   FROM alpine:latest
   COPY --from=builder /app/myapp /usr/local/bin/
   ```

4. **Consider `--pull=never` on base image layers** for faster rebuilds when offline (if you control the build environment).

## 3. Docker System Prune Mastery

### Command reference: `docker system prune [OPTIONS]`

Removes all unused containers, networks, images (both dangling and unused), and optionally volumes.

| Option | Default | Effect | Risk Level |
|--------|---------|--------|------------|
| (no flags) | — | Remove stopped containers, unused networks, dangling images, build cache | 🟢 Safe |
| `-a`, `--all` |  | Also remove UNUSED images (not just dangling ones) | 🟡 Moderate |
| `--volumes` |  | Prune ANONYMOUS volumes not used by any container | 🟡 Moderate |
| `-f`, `--force` |  | Skip interactive prompt for confirmation | ⚠️ Requires prior user approval per HARD RULE |

**Important:** By default, **named volumes are never touched**, even with `--volumes`. Only anonymous (dangling) volumes without a mount point are considered for removal.

### Examples and expected output:

```console
$ docker system prune

WARNING! This will remove:
        - all stopped containers
        - all networks not used by at least one container
        - all dangling images
        - unused build cache
Are you sure you want to continue? [y/N] y

Deleted Containers:
f44f9b81948b3919590d5f79a680d8378f1139b41952e219830a33027c80c867
Total reclaimed space: 1.84kB
```

With `-a --volumes`:
```console
$ docker system prune -a --volumes

WARNING! This will remove:
        - all stopped containers
        - all networks not used by at least one container  
        - all anonymous volumes not used by at least one container
        - all images without at least one container associated to them
        - all build cache
Are you sure you want to continue? [y/N] y

Deleted Images:
untagged: hello-world@sha256:f3b3b28a45160805bb16542c9531888519430e9e6d6ffc09d72261b0d26ff74f
deleted: sha256:1815c82652c03bfd8644afda26fb184f2ed891d921b20a0703b46768f9755c57
Total reclaimed space: 13.5 MB
```

### Filtering with `--filter`

The filtering flag uses "key=value" format. Multiple filters are combined:
- Different keys → AND logic (must satisfy all conditions)
- Same key → OR logic (matches any value)

Supported filter keys:
- **until** — only remove items created before given timestamp (Unix timestamp, date string, or duration like `24h`)
- **label** — match containers/images/networks/volumes with specified labels (`label=key`, `label=key=value`, or anti-match `label!=key`)

```bash
# Remove images older than 7 days
docker system prune --filter "until=7d"

# Remove images without the build.artifact label
docker image prune -a --filter "label!=build.artifact=true"
```

### Safe default workflow:

```bash
# Step 1: Containers (always safe)
docker container prune || true

# Step 2: Preview unused images before deciding
docker image prune -a --dry-run 2>&1 | head -30 || true

# Step 3: If appropriate, confirm and remove
read -p "Remove unused images? (y/N) " -n 1 -r
[[ $REPLY =~ ^[Yy]$ ]] && docker image prune -a || echo "skipped"

# Step 4: Build cache (safe, no impact on images or containers)
docker builder prune || true

# Step 5: Show freed space
docker system df
```

## 4. Volume Lifecycle Management

### Golden rule: **NEVER prune named volumes** — they may contain persistent data you need to preserve across reboots, CI runs, or development sessions.

### Finding unmounted anonymous volumes (safe to review):
```bash
docker volume ls -qf dangling=true
```

These have no mount point and are typically:
- Leftover from failed container removals
- Temporary build volumes that were never properly cleaned up
- Anonymous volumes created with `docker run --rm ...` but not associated with any running container

**Safe to remove** if you confirm they're truly orphaned. Use either:
```bash
# Via prune (affects only dangling anonymous volumes)
docker system prune --volumes || true

# Or manually review and remove specific ones
docker volume inspect <volume-name>  # check mount point, labels, size
docker volume rm dangling_volume_abc123 || true
```

### Volume retention policies:

| Context | Recommendation | Rationale |
|---------|----------------|-----------|
| Development (personal) | Remove volumes weekly if they contain build artifacts | Save space; artifacts will be re-created |
| Production environment | Never automate volume removal without explicit policy and confirmation | Data loss is catastrophic |
| CI/CD pipelines | Consider removing named volumes between job runs | Requires careful state management to avoid data leakage |
| Docker Compose projects | Use `volumes: []` with `--rm` or external volume driver for persistence | Explicit about what persists across container restarts |

### Before any volume operation, always review first:
```bash
docker volume ls --format "table {{.Name}}\t{{.Driver}}\t{{.Mountpoint}}" 2>/dev/null || true
```

This shows which volumes are mounted vs unmounted (empty Mountpoint = dangling).

## 5. Garbage Collection (`docker system gc`)

### What it does:
Removes **intermediate container layers** that have been committed to an image. These layers are NOT removed by `prune` — they're baked into the image itself and only persist because the garbage collector hasn't run yet.

When you commit changes from a running container:
```bash
docker commit <container> my-image:new-tag
```
Docker creates new layers for the commit, but also leaves behind intermediate layers (the "dangling" images you see with `docker image ls -f dangling=true`). These are what `gc` cleans up.

### When to use:

- **After rebuilding images many times** — e.g., nightly CI builds that create thousands of intermediate layers
- **Before a major cleanup operation** — run gc + prune together for thorough cleaning
- **Regular maintenance on long-running systems** — gc runs automatically in daemon background, but manual invocation ensures it completes

### Safe to run regularly:
```bash
docker system gc 2>/dev/null || true
```

**Does NOT affect:**
- Running containers (they won't restart)
- Images you've built (their committed layers stay intact)
- Named volumes or data

The garbage collector also runs automatically in the background when the Docker daemon is idle, but manual invocation ensures it completes even if the system was under heavy load.

### Difference between `gc` and `prune`:
| Command | What removes | Example output |
|---------|--------------|----------------|
| `docker system gc` | Intermediate layers (dangling) | `deleted: sha256:a1b2c3...` |
| `docker system prune -a` | Unused containers, networks, images, build cache | Same format |

In practice, you'll often see output like:
```console
$ docker system gc
Total reclaimed space: 4.78kB

$ docker system prune -a --volumes
Deleted Images:
deleted: sha256:d1e2f3...
untagged: my-image:latest
Total reclaimed space: 13.5 MB
```

## 6. Log Size Management

### On Docker Swarm (multi-node):
Set default log driver options in swarm config to prevent log bloat:
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

This limits each log file to 10MB and keeps only 3 files (rotates automatically). Total per container: ~40MB.

### On single-node Docker:
Docker daemon config flags (deprecated but still functional for legacy systems):
- `--log-max-size=10m` — limit per log file  
- `--max-log-size=10m` — deprecated alias, same thing

**Note:** These flags are ignored by default on modern Docker installations. Log rotation is now handled entirely at the container level (via the logging driver), not daemon-level.

### External rotation strategies:

Consider using external tools when logs approach limits:
- **rsyslog/journald** — tail and rotate logs outside Docker
- **fluentd/fluent-bit** — send to centralized log aggregation
- **jq + crontab** — simple script that parses JSON logs and deletes old entries
- **Docker Scout/LogRhythm** — enterprise monitoring solutions

Example external rotation:
```bash
# Every hour, check container logs for bloat
find /var/lib/docker/containers/* -name "json-file" -size +100M -exec sh -c 'echo "Large log: {}"; docker inspect $(dirname "{}") | jq -r ".[0].Name"' \; 2>/dev/null || true
```

## 7. Comprehensive Cleanup Script (with guardrails)

A production-safe cleanup script that the AI can walk users through step by step:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Pre-flight assessment
echo "=== DISK USAGE ==="
df -h || true
echo ""

# Docker breakdown
echo "=== DOCKER STORAGE BY TYPE ==="
docker system df 2>/dev/null || echo "(Docker not installed)" || true
echo ""

# Build cache analysis (show what would be freed)
echo "=== BUILD CACHE PREVIEW ==="
if command -v docker &>/dev/null; then
    docker builder prune --dry-run 2>&1 | head -50 || true
else
    echo "(Docker not available for cache analysis)"
fi
echo ""

# Volume preview (dangling only — safe to review)
echo "=== DANGLING VOLUMES ==="
if command -v docker &>/dev/null; then
    docker volume ls -qf dangling=true 2>/dev/null || echo "(none or docker not installed)"
else
    echo "(Docker not available for volume check)"
fi
echo ""

# Journal disk usage (system logs)
journalctl --disk-usage 2>/dev/null || true

# Ask user for confirmation before aggressive cleanup
read -p "Run full prune? (y/N) " -n 1 -r
[[ $REPLY =~ ^[Yy]$ ]] && {
    echo ""
    
    # Step-by-step with user visibility — no force flags yet
    echo "Step 1: Remove stopped containers..."
    docker container prune || true
    
    echo "Step 2: Remove dangling images (preview first)..."
    docker image prune -a --dry-run 2>&1 | head -30 || true
    read -p "Continue with removal? (y/N) " -n 1 -r
    [[ $REPLY =~ ^[Yy]$ ]] && docker image prune -a || echo "(skipped by user)"
    
    echo "Step 3: Remove build cache..."
    docker builder prune || true
    
    echo ""
    echo "=== CLEANUP COMPLETE ==="
    df -h
}

```

## 8. Best Practices Summary (from docs.docker.com)

1. **Use `.dockerignore`** — match gitignore conventions, exclude secrets and large directories from build context
2. **Monitor cache size regularly** — `du -sh /var/lib/docker/buildkit/` or `/var/lib/docker/` for classic Docker
3. **Automate with cron** — weekly prune is common practice; use filters to avoid removing important images unintentionally
4. **Test before production cleanup** — run with preview flags first (no `-f`) and review output carefully
5. **Review output always** — what will be removed must match your intent before confirming any destructive operation

## 9. References

- **`.agents/skills/containers/SKILL.md`** — Multi-stage builds, .dockerignore basics  
- **`.agents/skills/wsl-cleanup/SKILL.md`** — Full WSL2 maintenance (broader scope including apt cache, journal, temp files)  
- **docs.docker.com/build/cache/** — Build cache documentation and optimization techniques  
- **man docker-system-prune** — CLI reference for prune options and filters  

---

*This skill focuses on Docker-specific ecosystem management, complementing rather than duplicating existing skills.*