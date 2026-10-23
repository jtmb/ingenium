# Root-Authoritative Agent Models

[`opencode.json`](../opencode.json) is authoritative for the runtime agent
roster, model references, MCP entry, and plugin list. Native Markdown agent profiles own prompt content,
permissions/tool grants, lifecycle metadata, and skills; they do not define
runtime models, and a custom-agent root mapping does not create profile grants.
After changing a root mapping, profile, plugin, MCP entry, or OpenCode
configuration, perform a full parent OpenCode restart; restarting only the
child MCP process is insufficient. A restart acknowledgement alone is not
loaded-surface proof, so an independently read-capable verifier must check the
new parent's mapping, profile, and effective grants.
For this migration only, `ingenium-software-engineer-premium` is review-only;
this does not change the canonical profile's permanent role.

This reference records 11 mapped entries: built-in `plan` plus 10 named Ingenium
agents. Plan alone uses the root agent ID `plan` and root profile
`.opencode/agents/plan.md`; the named custom agents retain their nested native V2
IDs and profile paths. Root `opencode.json` remains authoritative; the hidden
`ingenium-llm-broker` is system-internal and intentionally has no root mapping.

| Agent | Model | Variant | Canonical profile |
|---|---|---|---|
| `plan` (built-in) | `openai/gpt-6-astra` | `max` | `.opencode/agents/plan.md` |
| `ingenium-explore` | `openai/gpt-6-sol` | `medium` | `.opencode/agents/research/ingenium-explore.md` |
| `ingenium-docs` | `openai/gpt-6-luna` | `xhigh` | `.opencode/agents/execution/ingenium-docs.md` |
| `ingenium-qa` | `openai/gpt-6-luna` | `xhigh` | `.opencode/agents/execution/ingenium-qa.md` |
| `ingenium-software-engineer-fast` | `openai/gpt-6-luna` | `xhigh` | `.opencode/agents/execution/ingenium-software-engineer-fast.md` |
| `ingenium-software-engineer-premium` | `openai/gpt-6-sol` | `high` | `.opencode/agents/execution/ingenium-software-engineer-premium.md` |
| `ingenium-recovery-engineer` | `openai/gpt-6-sol` | `high` | `.opencode/agents/execution/ingenium-recovery-engineer.md` |
| `ingenium-orchestrator` | `openai/gpt-6-sol` | `medium` | `.opencode/agents/primary/ingenium-orchestrator.md` |
| `ingenium-scout` | `openai/gpt-6-luna` | `xhigh` | `.opencode/agents/research/ingenium-scout.md` |
| `ingenium-chat` | `openai/gpt-6-luna` | `xhigh` | `.opencode/agents/chat/ingenium-chat.md` |
| `ingenium-security-auditor` | `openai/gpt-6-astra` | `high` | `.opencode/agents/security/ingenium-security-auditor.md` |

The canonical `ingenium-chat` profile is
`.opencode/agents/chat/ingenium-chat.md`; runtime bootstrap may project ordinary
profiles into OpenCode's native global/workspace agent directories, but those
generated flat copies are derived views, not additional repository profiles,
mappings, or grants. The protected hidden `ingenium-llm-broker` is
system-internal, intentionally has no root `"agents"` mapping, and is not
invocable.
