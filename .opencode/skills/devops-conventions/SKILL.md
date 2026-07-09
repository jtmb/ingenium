---
name: devops-conventions
description: "Unified DevOps conventions — CLI toolkit (jq, curl, sed, awk, find, grep), Docker container authoring and ecosystem management, and Kubernetes manifests. Use when writing shell pipelines, Dockerfiles, compose files, or K8s manifests."
alwaysApply: true
tags: ["devops", "docker", "kubernetes", "cli", "shell", "containers"]
---

# DevOps Conventions

> Unified conventions across three domains: CLI toolkit, Docker authoring & management, and Kubernetes manifests.

## When to Use

- Constructing shell pipelines or parsing JSON/text output
- Writing or editing Dockerfiles, Containerfiles, compose files, `.dockerignore`
- Managing Docker system resources (build cache, volumes, logs)
- Writing Kubernetes manifests, Helm charts, or Kustomize overlays

## 🔴 HARD RULEs

### 🔴 NEVER Pipe Curl to Shell

Never pipe `curl ... | sh` or `curl ... | bash`. Always download, inspect, then run.

```bash
# ❌ BAD — blind execution
curl -sSL https://example.com/install.sh | bash

# ✅ GOOD — inspect first
curl -sSL https://example.com/install.sh > install.sh
less install.sh && bash install.sh
```

### 🔴 NEVER Touch `$HOME/repos` or `/mnt`

The `$HOME/repos` directory and all subdirectories are off-limits for any Docker cleanup, WSL maintenance, or file operations. The `/mnt` directory (Windows drive mounts) is also off-limits. Before running ANY command that operates on paths, verify the path does not start with `$HOME/repos`, `/mnt`, or a resolved equivalent.

### 🔴 Assess Before Acting; Confirm Before Destruction

Show disk usage (`df -h`) before any destructive operation. Always confirm with the user before `docker system prune`, `apt autoremove --purge`, `rm -rf`, or similar destructive commands.

### 🔴 Shell Safety

Multi-command shell statements must follow `set -euo pipefail` safety patterns. Quote all variable expansions, use `|| true` tolerance for commands that may fail, never background processes with `&`.

### 🔴 NEVER Append Output Redirection to Terminal Commands

Never append `2>&1`, `>/dev/null`, `&>/dev/null`, or any standard output/error redirection to commands. All tool outputs must stream raw text back to the shell environment. Hiding output prevents error detection and debugging.

```bash
# ❌ WRONG — hiding output breaks error detection
curl http://localhost:4097/health 2>&1 | grep ok
docker ps 2>/dev/null
npm test &>/dev/null

# ✅ CORRECT — full output, handle errors explicitly
curl http://localhost:4097/health
docker ps
npm test
```

### 🔴 Use `docker compose`, NOT `docker-compose`

The `docker-compose` standalone binary (with hyphen) is deprecated. Always use the modern Docker Compose plugin:

```bash
# ❌ WRONG — docker-compose (hyphen) not installed on modern Docker
docker-compose config
docker-compose up -d

# ✅ CORRECT — docker compose (space) is the modern command
docker compose config
docker compose up -d
docker compose ps
```

The hyphen variant is a legacy Python script that may not exist on the system. The space variant is built into the Docker CLI as a plugin. Always use `docker compose` (space).

### 🔴 Use `docker compose` for Container Lifecycle — Not Raw `docker run`

All container lifecycle management must go through `docker compose` — never raw `docker run`, `docker rm`, or `docker stop` commands. The `docker compose` tool manages networks, volumes, and dependencies correctly.

```bash
# ❌ WRONG — raw docker commands bypass compose orchestration
docker run -d --name myapp ...
docker rm -f myapp
docker stop myapp

# ✅ CORRECT — compose handles networking, volumes, healthchecks, dependencies
docker compose up -d
docker compose down
docker compose restart
docker compose logs
docker compose ps
```

## Reference Files

### CLI Toolkit

| File | Content |
|------|---------|
| [`references/cli-toolkit/toolkit.md`](references/cli-toolkit/toolkit.md) | jq, curl, sed, awk, find + xargs, grep — flags, recipes, gotchas |

### Docker

| File | Content |
|------|---------|
| [`references/docker/authoring.md`](references/docker/authoring.md) | Multi-stage builds, non-root user, layer ordering, .dockerignore, pin digests, HEALTHCHECK, signal handling, secrets, image size |
| [`references/docker/management.md`](references/docker/management.md) | Pre-flight assessment, build cache optimization, system prune, volume lifecycle, GC, log management, cleanup script |

### Kubernetes

| File | Content |
|------|---------|
| [`references/kubernetes/manifests.md`](references/kubernetes/manifests.md) | Security context, resource limits, probes, network policies, labels, deployment strategy, service types, Ingress, ConfigMaps |

### Shell Scripts

| File | Content |
|------|---------|
| [`references/shell-scripts/scripting.md`](references/shell-scripts/scripting.md) | Safety flags, quoting, error handling, temp files, portability, secrets, script organization |

### WSL Cleanup

| File | Content |
|------|---------|
| [`references/wsl/pre-flight.md`](references/wsl/pre-flight.md) | WSL pre-flight assessment, when to use, component disk usage reference |
| [`references/wsl/docker.md`](references/wsl/docker.md) | Docker cleanup — prune images, containers, build cache |
| [`references/wsl/packages.md`](references/wsl/packages.md) | Package caches, systemd journal, temp files, snap cleanup |
| [`references/wsl/models.md`](references/wsl/models.md) | Model cache cleanup — Ollama, LM Studio, HuggingFace |
| [`references/wsl/workflow.md`](references/wsl/workflow.md) | Comprehensive cleanup workflow and post-flight report |

## Cross-References

- **`development-conventions`** — Python/Next.js conventions that pair with Docker/K8s deployments
- **`local-models`** — Command safety rules for CLI and dev server usage
