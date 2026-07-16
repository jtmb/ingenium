---
name: security-audit-workflow
description: "Security audit methodology with consolidated reporting and multi-domain coverage"
---

# Security Audit Workflow

## 🔴 HARD RULEs
- Security audits must cover docker, api, services, dashboard, AND application code
- All findings must be consolidated into ONE report from all sources
- User performs security audits directly without spawning subagents
- Findings must include hardcoded credentials, API auth defaults, and encryption keys

## Reference Files

| File | Content |
|------|--------|
| [`references/security-domains.md`](references/security-domains.md) | Multi-domain audit coverage requirements |
| [`references/consolidated-reporting.md`](references/consolidated-reporting.md) | Single report consolidation patterns |
| [`references/hardcoded-credentials.md`](references/hardcoded-credentials.md) | JWT tokens, encryption keys, API auth defaults |
