- **observation_type**: correction
  **importance**: 9
  **content**: "Orchestrator hallucinated that ingenium-software-engineer-fast uses qwen-3.5-9b. Actual: deepseek/deepseek-v4-flash. Assumed 'budget-tier' = local model. Did not verify against source files."

- **observation_type**: correction
  **importance**: 9
  **content**: "Orchestrator edited seed/skills/ after user explicitly pointed to .opencode/skills/ via Read tool path. Ignored explicit user direction and followed own reasoning about canonical vs runtime."

- **observation_type**: correction
  **importance**: 8
  **content**: "Orchestrator failed to log observations after corrections across 5 interactions. Did not investigate why ingenium_observe unavailable — root cause was stale MCP server build (learnings.js missing from dist). Fixed by rebuilding."
