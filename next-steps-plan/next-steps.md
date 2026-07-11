# RULES:
 - Please use @ingenium-software-engineer-premium for any explore tasks. Perform any screenshot viewewing tasks yourself, you have vision.
 - You are in Plan mode. You do not edit, you spawn @ingenium-software-engineer-premium or @ingenium-software-engineer-fast  any actions write/edit. You use @ingenium-explore for explore actions or @ingenium-software-engineer-premium if you require a better model. You use @ingenium-docs for documentations and finally @ @ingenium-qa for testing.
 - Your job is to be the brain of the operation.
 - Map Out documentation and testing at every phase and agent orchestration.
# REQUEST/DIRECTIVE:
One-shot every bug and feature listed below. Fix the 2 remaining /projects bugs (archived tab search, duplicate search bars), the 3 /mail bugs (OAuth credential UI, demo/testing mode, proper credential-error flow), the 2 /logs issues (investigate and fix API errors, make verbose errors a project standard), the /Skills background consolidation job, Playwright E2E test all new features from the previous build until they actually work, and execute the UI polish pass — bring flat pages (observations, agents, settings, mail, plugins, config) up to the visual standard of pipeline/logs. One pass, no excuses, test until it works. Architect the plan into phases for the orchestrator. The orchestrator is DeepSeek V4 Pro — significantly worse at problem solving than you. Make sure to think through those issues and map out a solid guided plan for the below.


## Bugs:

### /projects

1. No Search bar on archived tab
2. Duplicate search bars on /projects — remove the top-right one and the create button, move the remaining search bar to the top-right position

### /mail

1. OAuth credentials have no UI — generated auth URL has empty `client_id=`, user cannot enter Google/Microsoft client ID/secret anywhere. No credentials screen or setup flow
2. No way to test email UI without real OAuth — need a "load demo account" or placeholder mode so the email dashboard renders and MCP tools can be exercised
3. "Add Account" should detect missing credentials and prompt user for setup instead of producing an auth URL with empty fields or erroring

### /logs

1. API errors showing in /logs — investigate current "Unhandled error" entries and fix root cause before rebuilding
2. "Unhandled error" messages are useless — every error must include enough context to diagnose without digging through code. Make verbose errors a project standard: all catch blocks, Express error handlers, and child_process error handlers must log the originating route, request details, stack trace, and a human-readable summary

### /Skills

1. Background skill consolidation not running — 45 skills, no autonomous job condensing them below 20. Phase 3 prompt changes exist but no scheduler/cron job triggers the merge-first logic

## Features:

### E2E TESTING

1. Playwright test all features from the last one-shot plan: /jobs page (create job, run, live log console, cron scheduling), /mail (OAuth flow, account setup, email list/read/send MCP tools), kanban board on /tasks (drag-drop, swimlanes, WIP limits, view switcher, card detail with comments/activity/time tracking/search/bulk edit/notifications). Test until they work — not a single smoke pass.

### VISUAL UPGRADE

1. UI polish pass across all 16 dashboard pages — bring flat/unpolished pages (observations, agents, settings, mail, plugins, config) up to the visual quality of the best pages (pipeline, logs). Consistent card design, proper spacing, hover states, empty states, and typography. Keep stylesheets manageable — no per-page CSS files, use shared Tailwind patterns from STYLING-GUIDE.md. Make a plan to implement a simillar yet pollished ui. Think of it as a polish pass. Some of the pages look great like :
 http://localhost:3000/pipeline
http://localhost:3000/logs

and others look terrible and flat:

http://localhost:3000/observations
http://localhost:3000/agents
http://localhost:3000/settings

Please keep visual design consistent. Keep Stylesheets manegable.

### Documentation References

| Resource | Path |
|----------|------|
| MCP Tools | [`docs/HOW-TO/mcp-tools.md`](docs/HOW-TO/mcp-tools.md) |
| Architecture | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Synthesis | [`docs/HOW-TO/synthesis.md`](docs/HOW-TO/synthesis.md) |
| Personality | [`docs/HOW-TO/personality.md`](docs/HOW-TO/personality.md) |
| Conventions | [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) |
| README | [`README.md`](README.md) |
| Email | [`docs/HOW-TO/email.md`](docs/HOW-TO/email.md) |
| Self-Learning Pipeline | [`docs/self-learning-pipeline.md`](docs/self-learning-pipeline.md) |

---
