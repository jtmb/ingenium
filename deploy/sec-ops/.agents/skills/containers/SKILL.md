---
name: containers
description: "Container conventions — multi-stage builds, non-root users, layer caching, secrets hygiene, HEALTHCHECK, signal handling, docker-compose patterns. Use when editing Dockerfiles, Containerfiles, or compose files."
---

# Container Conventions

## When to Use

Invoke this skill when working with containers — Dockerfiles, Containerfiles, docker-compose files, `.dockerignore` files (`**/{Dockerfile,Containerfile,docker-compose*,docker-compose.*,compose*,compose.*,.dockerignore}`).

## Multi-Stage Builds — Mandatory

Every container image MUST use multi-stage builds. Build dependencies stay in the builder stage; the final image contains only runtime artifacts.

```dockerfile
# Builder stage — compiles, bundles, generates
FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /app ./cmd/server

# Runtime stage — minimal, no build tools
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /app /app
USER appuser
ENTRYPOINT ["/app"]
```

- **Builder stage** has compilers, package managers, dev headers
- **Runtime stage** has only the binary and runtime deps (ca-certificates, tzdata)
- Use `--from=builder` to copy artifacts across stages
- `docker build --target builder` for debugging without bloating the final image

## Non-Root User — Mandatory

Never run containers as root in production. Create a dedicated user.

```dockerfile
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
```

- Use `-S` (system user, no login shell) — not a human account
- The `USER` directive must come AFTER any commands that need root (package installs, file copies to system dirs)
- Test with `docker run --rm --user nobody <image>` — if it works, you're root-free
- Kubernetes: set `securityContext.runAsNonRoot: true` and `runAsUser: 1000`

## Layer Ordering for Cache Hits

Order `COPY` and `RUN` commands from least-frequently-changing to most-frequently-changing.

```dockerfile
# 1. Dependencies first (changes rarely)
COPY package.json package-lock.json ./
RUN npm ci --production

# 2. Source code last (changes every commit)
COPY . .
```

- Package manager files (`package.json`, `go.mod`, `requirements.txt`, `Cargo.toml`) go BEFORE source
- Docker caches layers — if a layer changes, all subsequent layers rebuild
- Put expensive operations (compilation, downloads) early, trivial operations (file copies) late

## .dockerignore — Mandatory

Every project with containers MUST have a `.dockerignore`. It prevents leaking secrets, bloating context, and invalidating cache.

```dockerignore
# Secrets — never in the build context
.env
.env.*
*.key
*.pem
secrets/

# Version control
.git
.gitignore

# Dependencies (installed inside the build)
node_modules/
vendor/
__pycache__/

# Build artifacts
dist/
build/
target/

# Docs & config (non-runtime)
*.md
.dockerignore
docker-compose*.yml
```

- `.dockerignore` is a denylist, not an allowlist
- Secrets in the build context end up in image layers — even if you `rm` them later
- Test context size: `docker build --no-cache . 2>&1 | grep "sending build context"`

## Pin Base Image Digests

Never use floating tags in production. Pin to a specific digest for reproducibility and security.

```dockerfile
# Bad — moves under your feet
FROM node:20-alpine

# Good — pinned to exact digest
FROM node:20-alpine@sha256:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2
```

## HEALTHCHECK — Mandatory

Every long-running container MUST have a `HEALTHCHECK`.

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1
```

- `--interval`: how often to check (default 30s)
- `--timeout`: how long to wait for a response (default 5s)
- `--retries`: consecutive failures before marking unhealthy (default 3)
- `--start-period`: grace period after container starts (default 0s)
- The health check endpoint should be lightweight — no database queries, no external calls

## Signal Handling

Containers receive `SIGTERM` on stop. Your process must handle it gracefully.

- **Use `exec` form, not shell form:**

```dockerfile
# Bad — /bin/sh -c "node server.js" is PID 1 and doesn't forward signals
CMD node server.js

# Good — node is PID 1 and receives signals directly
CMD ["node", "server.js"]
```

- Use `tini` or `dumb-init` if your app doesn't handle signals
- Graceful shutdown: catch `SIGTERM`, stop accepting new requests, finish in-flight requests, close connections

## No Secrets in Image Layers

- Never `COPY` or `ENV` secrets into the image
- Use Docker BuildKit secrets for build-time secrets (`--secret` flag)
- For runtime secrets: environment variables, mounted secret files, or external secrets manager
- Scan images for secrets: `docker scan`, `trufflehog`

## Image Size Hygiene

- Use slim/alpine base images: `python:3.12-slim` not `python:3.12`
- Clean package manager caches in the same `RUN` layer
- `--no-install-recommends`: avoids pulling suggested-but-unnecessary packages
- Strip debug symbols: `-ldflags="-s -w"` for Go, `strip` for C/C++ binaries
- `.dockerignore` aggressively: `node_modules/`, `target/`, `.git/`
