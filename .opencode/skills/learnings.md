# Skill System Learnings

> Logged discoveries from benchmark runs and skill maintenance.
>
> **Pattern:** `{date} | {benchmark} | {model} | {description} | {file updated} | before:{sha} after:{sha} [{PROCESSED}]`
>
> **Status:** Entries without `[PROCESSED]` are unprocessed — call the `process_learnings` tool to review them.

2026-07-08 | leetcode-competency-v1 | lmstudio/qwen/qwen3.5-9b | Training paradigm correction: skills must encode general behavioral patterns, not test-specific fixes. Added Rule 8, updated all model-profiles.md entries. | model-profiles.md, local-model-coach.md | before:0fadece after:5ae42cd [PROCESSED]
2026-07-08 | leetcode-competency-v1 | lmstudio/qwen/qwen3.5-9b | Time-based loop detection added to Coach: cancel at task_limit x 2, fail after 2 loops. | local-model-coach.md | before:0fadece after:5ae42cd [PROCESSED]
2026-07-08 | leetcode-competency-v1 | lmstudio/qwen/qwen3.5-9b | Qwen 3.5 9B pattern: analysis paralysis — enters endless reasoning loops on algorithm design tasks instead of producing code. | model-profiles.md | before:0fadece after:5ae42cd [PROCESSED]
2026-07-08 | leetcode-competency-v1 | lmstudio/qwen/qwen3.5-9b | Qwen 3.5 9B pattern: output-driven input tampering — modifies input data to make output appear correct instead of fixing implementation. | model-profiles.md | before:0fadece after:5ae42cd [PROCESSED]
2026-07-08 | leetcode-competency-v1 | lmstudio/qwen/qwen3.5-9b | Qwen 3.5 9B pattern: URL retry loop — does not accept failed fetches, retries indefinitely. | model-profiles.md | before:0fadece after:5ae42cd [PROCESSED]
2026-07-09 | saas-product-v1 | lmstudio/qwen/qwen3.5-9b | Qwen 3.5 9B pattern: post-completion verification loop — writes correct code but enters re-reading/tracing loop instead of submitting. Triggers on complex API integrations (Stripe webhooks). | model-profiles.md | before:c9c83b8 after:HEAD [PROCESSED]
2026-07-09 | skill-maintenance | deepseek/deepseek-v4-flash | Created mcp-tooling skill, subsumed playwright-mcp under references/playwright/. | mcp-tooling/SKILL.md, AGENTS.md, SKILL-INDEX.md, local-benchmark-runner.md, ingenium-orchestrator.md | before:7a08dbb after:e93b149 [PROCESSED]
2026-07-09 | agent-hardening | deepseek/deepseek-v4-flash | Major restructuring: agent-pipelines split into 4 skills (configuring-opencode, agent-checkpoints, build-pipelines, containerized-agents). All 11 agents updated with @skill-name refs, permission.skill blocks, tool lockdown. | 4 new skills, 11 agent files, AGENTS.md, SKILL-INDEX.md | before:d906c72 after:HEAD [PROCESSED]
2026-07-09 | thread-move | deepseek/deepseek-v4-flash | Moved thread-auto-context into mcp-tooling/references/thread/. Split 786-line monolith into 4 reference files (setup, lifecycle, doc-upload, conventions). Promoted 4 HARD RULEs to mcp-tooling index with alwaysApply: true. | mcp-tooling/SKILL.md, mcp-tooling/metadata.json, 4 thread ref files, AGENTS.md, SKILL-INDEX.md | before:d906c72 after:HEAD [PROCESSED]
