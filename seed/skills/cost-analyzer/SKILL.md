# Cost Analyzer

Analyzes API costs for LLM usage, primarily DeepSeek V4 Flash/Pro and OpenCode free-tier models.

## DeepSeek Pricing (as of 2026)

| Model | Input (per 1M tokens) | Output (per 1M tokens) |
|-------|----------------------|-----------------------|
| deepseek-v4-flash | $0.15 | $0.60 |
| deepseek-v4-pro | $2.00 | $8.00 |

## Cost Tracking

- Set `INGENIUM_MONITORING_COST_TRACKING=true` to log estimated costs alongside API calls
- Costs are estimates based on token counts — actual billing may vary
- Monitor costs via `ingenium_learning_log(entry_type="cost", ...)` entries

## Budgeting

- Estimate 500-1500 tokens per turn for chat
- Architecture/multi-file operations use 2000-4000 tokens per turn
- Subagent spawning adds 500-2000 tokens per spawn (context transfer)
