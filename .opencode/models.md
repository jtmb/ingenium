# Root-Authoritative Agent Models

[`opencode.json`](../opencode.json) is the sole authority for runtime agent models, variants, and canonical profile prompts. Markdown agent profiles do not define runtime models. Restart OpenCode after changing a root mapping or profile/configuration reference so the new configuration is loaded.

| Agent | Model | Variant | Canonical profile |
|---|---|---|---|
| `browser-agent` | `openai/gpt-5.6-luna` | `max` | `.opencode/agents/execution/browser-agent.md` |
| `ingenium-docs` | `openai/gpt-5.6-luna` | `max` | `.opencode/agents/execution/ingenium-docs.md` |
| `ingenium-qa` | `openai/gpt-5.6-terra` | `high` | `.opencode/agents/execution/ingenium-qa.md` |
| `ingenium-qa-vision` | `openai/gpt-5.6-luna` | `max` | `.opencode/agents/execution/ingenium-qa-vision.md` |
| `ingenium-software-engineer-fast` | `openai/gpt-5.6-luna` | `max` | `.opencode/agents/execution/ingenium-software-engineer-fast.md` |
| `ingenium-software-engineer-premium` | `openai/gpt-5.6-sol` | `high` | `.opencode/agents/execution/ingenium-software-engineer-premium.md` |
| `ingenium-orchestrator` | `openai/gpt-5.6-sol` | `high` | `.opencode/agents/primary/ingenium-orchestrator.md` |
| `ingenium-explore` | `openai/gpt-5.6-sol` | `medium` | `.opencode/agents/research/ingenium-explore.md` |
| `ingenium-scout` | `openai/gpt-5.6-luna` | `max` | `.opencode/agents/research/ingenium-scout.md` |
| `ingenium-chat` | `deepseek/deepseek-v4-flash` | `max` | `.opencode/agents/chat/ingenium-chat.md` |
| `ingenium-security-auditor` | `openai/gpt-5.6-sol` | `high` | `.opencode/agents/security/ingenium-security-auditor.md` |

The root-level `.opencode/agents/ingenium-chat.md` file is a compatibility mirror of the canonical chat profile above; it is not a separate agent or model mapping. The protected hidden `ingenium-llm-broker` is system-internal, intentionally has no root `"agent"` mapping, and is not invocable.
