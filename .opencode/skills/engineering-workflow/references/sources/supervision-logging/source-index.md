---
name: supervision-logging
description: "UI overlays and logging visibility for supervisord monitoring"
---

# Supervision Logging

## 🔴 HARD RULEs
- Always use the todo tool to track concerns/bugs from subagents (importance: 10)
- Apply detection prompts at each step of agent execution (importance: 9)
- Gate phases until verification gates pass before proceeding (importance: 8)
- Provide UI overlays showing supervisord logs and uptime per service (importance: 7)

## Reference Files

| File | Content |
|------|--------|
| [`references/supervisord-overlays.md`](references/supervisord-overlays.md) | UI overlay specifications for monitoring services |
| [`references/detection-prompts.md`](references/detection-prompts.md) | Detection prompt patterns applied at each execution step |
| [`references/phase-gating.md`](references/phase-gating.md) | Verification gate requirements before phase progression |
