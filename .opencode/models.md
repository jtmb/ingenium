# Active Agent Models

> Agent model mappings are centralized in [`opencode.json`](../opencode.json) under the `"agent"` key. This table is intentionally limited to the active mappings in that file; Markdown agent profiles do not define runtime models.

| Agent | Model | Variant |
|---|---|---|
| `browser-agent` | `deepseek/deepseek-v4-flash` | — |
| `ingenium-docs` | `openai/gpt-5.6-luna` | `medium` |
| `ingenium-qa` | `openai/gpt-5.6-terra` | `xhigh` |
| `ingenium-qa-vision` | `openai/gpt-5.6-luna` | `high` |
| `ingenium-software-engineer-fast` | `openai/gpt-5.6-luna` | `xhigh` |
| `ingenium-software-engineer-premium` | `openai/gpt-5.6-terra` | `xhigh` |
| `ingenium-orchestrator` | `openai/gpt-5.6-terra` | `high` |
| `ingenium-explore` | `openai/gpt-5.6-sol` | `medium` |
| `ingenium-scout` | `openai/gpt-5.6-luna` | `high` |
| `ingenium-chat` | `deepseek/deepseek-v4-flash` | `high` |
| `ingenium-security-auditor` | `openai/gpt-5.6-sol` | `high` |

The hidden `ingenium-llm-broker` is system-internal and has no entry in the root configuration's `"agent"` mapping.
