---
name: gitignore
description: "Git ignore file conventions — patterns, structure, and rules for .gitignore files. Use when creating or editing .gitignore files."
---

# Git Ignore Conventions

## When to Use

- Creating a `.gitignore` file for a new project
- Adding or removing patterns from an existing `.gitignore`
- Reviewing what should and shouldn't be committed
- Setting up a monorepo with multiple `.gitignore` files

## 🔴 HARD RULE — `.gitignore` Must Be Present and Complete

**Every project MUST have a `.gitignore` at the root.** After scaffolding, after adding new tooling, after changing build outputs — check `.gitignore` is up to date. A missing pattern means someone will accidentally commit secrets, build artifacts, or node_modules.

## Structure

```
# ── OS Files ──────────────────────────────────────────
.DS_Store
Thumbs.db

# ── Editor / IDE ──────────────────────────────────────
.idea/

# ── Dependencies ──────────────────────────────────────
node_modules/
vendor/

# ── Build Output ──────────────────────────────────────
dist/
build/
*.tsbuildinfo

# ── Environment / Secrets ─────────────────────────────
.env
.env.*
!.env.example

# ── Runtime / Cache ───────────────────────────────────
*.log
.cache/
.tmp/

# ── Generated ─────────────────────────────────────────
*.generated.*
```

- **Group by category** with section headers — makes it scannable
- **One pattern per line** — no comma-separated lists
- **Negate with `!`** for intentional exceptions (e.g., `!.env.example`)
- **Directory patterns end with `/`** — `node_modules/` not `node_modules`

## What Must Be Ignored

| Category | Examples | Why |
|----------|----------|-----|
| **Secrets** | `.env`, `*.pem`, `*.key`, `credentials.json` | Never commit credentials |
| **Dependencies** | `node_modules/`, `vendor/`, `__pycache__/` | Reproducible from lockfiles |
| **Build output** | `dist/`, `build/`, `out/`, `*.tsbuildinfo` | Generated, not source |
| **OS files** | `.DS_Store`, `Thumbs.db`, `Desktop.ini` | Not project files |
| **Editor files** | `.idea/` | Team-specific, not universal |
| **Runtime artifacts** | `*.log`, `.cache/`, `.tmp/`, `coverage/` | Ephemeral |
| **Generated code** | `*.generated.*`, `*.pb.go`, GraphQL types (varies) | Check team policy — some commit, some don't |

## What Should NOT Be Ignored

| Category | Examples | Why |
|----------|----------|-----|
| **Lockfiles** | `package-lock.json`, `yarn.lock`, `Cargo.lock`, `go.sum` | Reproducible builds |
| **Example configs** | `.env.example`, `config.example.yaml` | Documents needed vars without exposing secrets |
| **CI/CD configs** | `.gitlab-ci.yml`, `Jenkinsfile` | Pipeline as code |
| **Dockerfiles** | `Dockerfile`, `docker-compose.yml` | Infrastructure as code |
| **Docs** | `*.md`, `docs/` | Documentation is source |

## Language-Specific Patterns

### Node.js / TypeScript
```
node_modules/
dist/
.env
.env.local
*.tsbuildinfo
coverage/
```

### Python
```
__pycache__/
*.pyc
*.pyo
.venv/
venv/
dist/
*.egg-info/
.env
```

### Go
```
# Binaries
*.exe
*.test
*.out
/bin/
# No node_modules or venv — Go doesn't use them
```

### Rust
```
target/
**/*.rs.bk
.env
```

### Next.js
```
.next/
out/
.env*.local
```

## Monorepo `.gitignore`

Monorepos can use a single root `.gitignore` or nested ones per service. Prefer a single root unless services use different languages with conflicting rules.

## After Editing

1. Run `git status` — verify no unintended files are tracked
2. Run `git ls-files --ignored --exclude-standard` — verify intended files are ignored
3. If secrets were accidentally committed before adding to `.gitignore`, rotate them immediately
