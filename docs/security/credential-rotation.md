---
title: Credential Rotation
description: Git history secret remediation and credential rotation procedures for the Ingenium repository.
---

# Credential Rotation & Git History Remediation

> **Status**: External release blocker — coordinated rotation/re-auth plus `git filter-repo` across all clones required.
> **Last updated**: 2026-07-16

---

## 🔴 Security Advisory

The Ingenium git repository contains **legacy secrets in git history** from earlier development phases.
The current worktree uses placeholders and required environment variables, but the secrets
remain in historical commits and cannot be removed without coordinated history rewriting.

> 🔴 **The legacy git-history secret rotation/purge remains a release blocker.**
> Phase A (rotate active credentials) must be completed before Phase B (git filter-repo).
> This is tracked as a pre-release blocker — not yet actioned.

### Secrets Present in Git History

| Secret | Type | Current Worktree Status | Risk |
|--------|------|-------------------------|------|
| **Thread API token** (`THREAD_API_TOKEN`) | MCP server auth token | Placeholder `<YOUR_THREAD_API_TOKEN>` in `opencode.json` | Anyone with repo access can read old commits |
| **Legacy email encryption key** | AES-256-GCM encryption key | `INGENIUM_EMAIL_ENCRYPTION_KEY` — now **required** with 64-hex validation; no hardcoded default | Rotated key in current config; old key in git history |
| **Legacy OpenCode password** | Web server auth password | `OPENCODE_SERVER_PASSWORD` — now **required** with entrypoint guard; no hardcoded default | Rotated password in current config; old password in git history |

### Why This Is a Release Blocker

1. **Any clone of the repository** contains the full history, including these secrets
2. **`git filter-repo` must be coordinated** across all clones — if even one clone pushes unfiltered history, the secrets reappear
3. **External collaborators** must re-clone after the purge
4. **Rotation/re-auth** must happen before or simultaneously with the purge — otherwise rotated credentials are invalidated but old compromised ones remain searchable

---

## Safe Remediation Steps

### Phase A — Rotate All Active Credentials (Do This First)

Before rewriting history, ensure all currently active credentials are replaced with new values:

1. **Generate a new Thread API token** via the Thread server admin panel
2. **Generate a new INGENIUM_EMAIL_ENCRYPTION_KEY** (64 hex chars):
   ```bash
   # Linux/macOS
   openssl rand -hex 32
   ```
3. **Set a new OPENCODE_SERVER_PASSWORD** (any strong password)
4. **Re-authenticate email accounts** with the new encryption key (existing encrypted credentials become undecryptable)
5. **Re-login to OpenCode** with the new password
6. **Update `.env` files, Docker Compose, and CI/CD** secrets with the new values

### Phase B — Coordinate Git History Purge

After all credentials are rotated:

1. **Notify all collaborators** of the upcoming history rewrite
2. **Freeze commits** on the main branch
3. **Run `git filter-repo`** to remove the secrets from history:
   ```bash
   # Install git-filter-repo: https://github.com/newren/git-filter-repo
   
   # Strip secrets from all commits (replace placeholders with actual patterns)
   git filter-repo \
     --replace-text <(echo "THREAD_API_TOKEN") \
     --force
   ```
   
   > ⚠️ **Do not print the actual secret values.** Use placeholder patterns only.
   > The command above is illustrative — actual patterns must be derived from
   > the specific strings found in the commit history.

4. **Verify the purge**:
   ```bash
   # Check no secrets remain in history
   git log --all --pickaxe-all -S "THREAD_API_TOKEN" --oneline
   # Should return empty
   ```

5. **Force-push** to all remotes:
   ```bash
   git push origin --force --all
   git push origin --force --tags
   ```

6. **All collaborators must re-clone** — anyone who force-pushes from an unfiltered clone will reintroduce the secrets

### Phase C — Post-Purge Verification

1. **Verify no secrets remain** in any branch or tag
2. **Rotate credentials again** (belt-and-suspenders):
   - Generate new Thread API token
   - Generate new encryption key
   - Set new OpenCode password
3. **Update documentation** to remove any historical references to old credential values
4. **Add a pre-receive hook** to the remote to block any commit containing known secret patterns:
   ```bash
   # Example pre-receive hook (server-side)
   #!/bin/sh
   while read oldrev newrev refname; do
     git rev-list $oldrev..$newrev | while read commit; do
       if git show $commit | grep -qE 'THREAD_API_TOKEN|INGENIUM_EMAIL_ENCRYPTION_KEY'; then
         echo "ERROR: Commit $commit contains secrets. Rejected."
         exit 1
       fi
     done
   done
   ```

---

## Active Defense Measures

### 🔴 Timing-Safe API Token Comparison

`INGENIUM_API_TOKEN` is validated via `crypto.timingSafeEqual` at `services/ingenium-api/lib/middleware/auth.ts`:

```typescript
// Timing-safe comparison — pad both inputs to equal length so
// timingSafeEqual never throws on differing buffer lengths.
const providedBuf = Buffer.from(provided, "utf8");
const tokenBuf = Buffer.from(token, "utf8");
const maxLen = Math.max(providedBuf.length, tokenBuf.length);
const paddedProvided = Buffer.alloc(maxLen, 0);
const paddedToken = Buffer.alloc(maxLen, 0);
providedBuf.copy(paddedProvided);
tokenBuf.copy(paddedToken);

if (!timingSafeEqual(paddedProvided, paddedToken)) {
  throw new AppError("Invalid authorization token", "FORBIDDEN", 403);
}
```

Key properties:
- **Length-safe padding**: Both inputs are padded to `maxLen` so `timingSafeEqual` never throws on differing buffer sizes (which would leak the correct token length)
- **Middleware chain placement**: Auth sits AFTER rate limiting — brute-force attempts are throttled before any token comparison cost is paid
- **401 vs 403 distinction**: Missing/invalid header → 401 UNAUTHORIZED; wrong token → 403 FORBIDDEN (distinguishes "not configured" from "wrong value")

### 🔴 `.dockerignore` Secret Build-Context Prison

The `.dockerignore` excludes all secret files from the Docker build context, preventing accidental layer leakage:

```
# Secrets
.env
.env.*
*.key
*.pem
secrets/
```

These patterns block:
- `.env` / `.env.*` — environment files containing tokens, keys, passwords
- `*.key`, `*.pem` — TLS/SSH private keys
- `secrets/` — any dedicated secrets directory

Secrets are supplied exclusively at runtime via Docker Compose `environment:` or `.env` files — never baked into the image. The Docker build never sees credential material.

> 🔴 **Build-context + git-history = two-layer defense.** Even if `.dockerignore` blocks secrets from the image, they remain in git history. Both must be addressed: `.dockerignore` prevents image-layer leakage; `git filter-repo` prevents source-archive leakage.

---

## 🔴 Hard Rules

1. **Never commit `THREAD_API_TOKEN`** to source. Use `<YOUR_THREAD_API_TOKEN>` placeholder.
2. **Never hardcode `INGENIUM_EMAIL_ENCRYPTION_KEY`** — always require it from the environment.
3. **Never print full secret values** in documentation, issues, or transcripts.
4. **Rotate before purge** — always invalidate old credentials before rewriting history.
5. **Coordinate all clones** before `git filter-repo` — unfiltered clones will reintroduce secrets.
6. **Add a pre-receive hook** to prevent future secret commits.

---

## Related Documents

- `docs/VARIABLES.md` — Environment variable reference with security notes
- `docs/reference/environment-variables.md` — Canonical env var reference
- `AGENTS.md` — Header security rule and env var enforcement
- `docs/security/iframe-sandbox.md` — Iframe sandbox evaluation (separate concern)

> **Note**: There is currently no security index/README file. This document is linked from
> `next-steps-plan/SKILL-SYSTEM-MIGRATION.md` and the security section of `AGENTS.md`.
