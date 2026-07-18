---
name: security-audit
description: "Systematic security review — automated leak scanning, credential rotation, dependency audit, and .gitignore hardening. Use for any security-sensitive code review, new API endpoints, environment variable introduction, or vulnerability scanning."
---

# Security Audit

> Systematic security review with automated leak-history scanning. Used by `@ingenium-security-auditor` agent.

## When to Use

- Reviewing any code change touching auth, secrets, CI/CD, data, or dependencies
- A new API endpoint, environment variable, or credential mechanism is introduced
- `.gitignore` is modified or should be audited
- User asks for a security review or vulnerability scan
- Sensitive patterns (tokens, keys, JWTs) are discovered in any tracked file

## 🔴 HARD RULEs

1. **Never commit secrets to source.** If found, escalate immediately to git-history scan (Step 2).
2. **Rotate exposed credentials before purging from history.** Purging alone is insufficient — the secret is already compromised.
3. **Always scan git history when a secret is found in current code.** The presence of a secret in HEAD often means it exists in past commits too.
4. **Use severity levels consistently** — Critical (exploitable/exposed), High (insecure pattern in current files), Low (hardening opportunity).

## Process

### 1. Surface Scan

Examine all code changes for:

| Category | Check for |
|----------|-----------|
| **Secrets exposure** | Hardcoded tokens, JWTs, passwords, API keys, `*.pem` files, credentials in any file |
| **Injection vulnerabilities** | SQL injection, command injection, XSS, unsafe `eval()`/`exec()` |
| **Supply chain risks** | `curl \| bash`, unsigned downloads, mutable git refs |
| **Missing security controls** | Permissive CORS, weak auth, no rate limiting, missing input validation |
| **`.gitignore` gaps** | Missing `*.pem`, `*.key`, `.env*`, `credentials.json` patterns |

### 2. Commit-History Leak Scan

Triggered automatically when a secret or infraction is found in current code:

```bash
git log --all -p -S "<pattern>" --pretty=format:"%H %ai %s"
```

- Search all branches and tags for the leaked pattern
- Report which commits introduced/exposed the secret
- Create a Docs page for each confirmed leak <!-- Thread retired → Docs RAG -->

### 3. Report

| Level | Meaning |
|-------|---------|
| 🔴 **Critical** | Exploitable vulnerability or secret exposed in git history |
| 🟡 **High** | Insecure pattern or secret in current files (not yet in history) |
| 💡 **Low** | Defense-in-depth hardening opportunity |

For each finding, include: file path, line number, what's wrong, and a concrete fix.

### 4. Remediate

For confirmed leaks in git history:
1. Create a Docs page with the commit SHA and fix instructions <!-- Thread retired → Docs RAG -->
2. Rotate the secret immediately
3. Purge with `git filter-branch` or BFG
4. Reference affected skills (`@development-conventions`, `@devops-conventions`)

## Common Patterns to Flag

```bash
# Hardcoded secrets
# THREAD_API_TOKEN retired — replaced by Docs RAG auth
# THREAD_API_TOKEN="sk-..."
API_KEY="abc123"
password = "admin"

# Unsafe eval
eval(userInput)
exec(rawCommand)

# Permissive CORS
Access-Control-Allow-Origin: *

# Missing .gitignore entries
*.pem
*.key
.env*
credentials.json
```

## Migrated Sources (Phase 3 Taxonomy)

| Source | Content Preserved At |
|--------|---------------------|
| `security-audit-workflow` | [`references/sources/security-audit-workflow/`](references/sources/security-audit-workflow/source-index.md) |

## Integration

Used by:
- `@ingenium-security-auditor` agent (primary consumer)
- `@ingenium-orchestrator` (triggers after changes touching security surface)
- `@development-conventions` — Lens 1 (Security) structured pass
- `@skill-maintenance` — audit checks for missing security patterns
