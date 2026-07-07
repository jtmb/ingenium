# Plan: Vision Agent — Direct Vision Model

## Orchestrator Instructions

| Phase | Step | Subagent | Task | Blocked by |
|-------|------|----------|------|------------|
| 1 | 1 | @ingenium-software-engineer | Update ingenium-vision.md: model→lmstudio/google/gemma-4-12b-qat, simplify process | — |
| 1 | 2 | @ingenium-software-engineer | Update local-models/SKILL.md: add preferred approach note to Vision Bridge | — |
| 2 | 3 | bash | bash tests/test-agent-validation.sh | Phase 1 |
| 2 | 4 | @ingenium-docs | Append learnings.md | Phase 1 |

## Verification

```bash
grep "lmstudio/google/gemma-4-12b-qat" .opencode/agents/research/ingenium-vision.md
bash tests/test-agent-validation.sh
```
