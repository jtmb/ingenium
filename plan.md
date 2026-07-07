# Plan: Dashboard Styling Guide

## Orchestrator Instructions

| Phase | Step | Subagent | Task | Blocked by |
|-------|------|----------|------|------------|
| 1 | 1 | bash | Extract image from DB + call LM Studio vision API for style description | — |
| 1 | 2 | @ingenium-docs | Create STYLING-GUIDE.md from vision description | — |
| 2 | 3 | @ingenium-docs | Update nextjs-conventions skill with styling guide HARD RULE | Phase 1 |
| 2 | 4 | @ingenium-docs | Update generate-docs skill to include styling guide | Phase 1 |
| 2 | 5 | bash | bash tests/test-agent-validation.sh | Phase 2 |
| 2 | 6 | @ingenium-docs | Append learnings.md | Phase 2 |
