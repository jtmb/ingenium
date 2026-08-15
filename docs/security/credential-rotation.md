---
title: Credential Incident Runbook
description: Redacted response record and future remediation steps for the historical credential exposure.
---

# Credential Incident Runbook

> **Handling:** Redacted operational documentation. Do not add token values, hashes, or other secret material here.

## Incident status

- **History remediation:** The history rewrite was completed from an isolated mirror.
- **Affected paths:** The affected paths were removed from historical history.
- **Remote refs:** `origin` branches `main` and `the-next-level` were force-updated to the reported sanitized refs.
- **Current scans:** Local and current scans are clean.
- **Historical credential comparison:** No historical JWT matched the current local credentials.
- **Deployed bearer rotation:** Complete; the prior bearer was rejected with HTTP `401`.
- **Local email key:** Unchanged.
- **Separate follow-up:** External provider revocation, cache invalidation, and collaborator/CI clone-reset actions remain tracked here and were not inferred from the local bearer check.

No secret values are recorded in this document, issues, commits, logs, or support transcripts.

## Restore boundary

Successful database restore invalidates restored local sessions, scoped API/MCP
credentials, runtime capabilities/tickets/browser sessions, pending one-time
states, invitations, task reservations, and coordination ownership before
services restart. It preserves password hashes, OIDC links, TOTP factors, and
recovery codes, so it is not a password or external-provider rotation. Require
fresh local authentication after restore and perform any external provider
revocation separately. If restore later rolls back, clients or caches that
already observed revocation may remain invalidated; retain the signed rollback
evidence rather than attempting to resurrect old tokens.

## Remediation record

### 1. Credential verification

The deployed Ingenium API bearer was rotated and the prior bearer was rejected with HTTP `401`. External provider revocation and related cache invalidation remain separate follow-up checks. No credential values are recorded here.

### 2. History rewrite

The rewrite was performed from an isolated mirror. Affected paths were removed historically, and `origin/main` and `origin/the-next-level` were force-updated to the reported sanitized refs.

### 3. Local verification

Local and current scans are clean. No historical JWT matched the current local credentials. The local email key was not changed. Keep local secret material out of commits, build contexts, issue reports, and shell history.

### 4. Add ongoing secret scanning

- Run secret scanning against commits, branches, tags, and pull requests.
- Enable repository-host scanning and push protection where available.
- Add a pre-commit or CI check that detects JWT-shaped credentials without printing matching values.
- Review alerts in a protected channel and treat every confirmed finding as compromised until revoked.
- Repeat a full scan after the history rewrite and after force-updating remotes.

## Verification checklist

- [x] History rewritten from an isolated mirror.
- [x] Affected paths removed from historical history.
- [x] `origin/main` and `origin/the-next-level` force-updated to the reported sanitized refs.
- [x] Local and current scans clean.
- [x] No historical JWT matched current local credentials.
- [x] Deployed bearer rotated and prior bearer rejected with HTTP `401`.
- [x] Local email key unchanged.
- [ ] External provider revocation verified.
- [ ] External provider caches invalidated or confirmed clear.
- [ ] Collaborators and CI re-cloned or reset from the rewritten history.

## Related documents

- [Security documentation](index.md)
- [Environment variables](../develop/variables.md)
