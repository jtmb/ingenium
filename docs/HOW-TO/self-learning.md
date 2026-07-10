# HOW-TO: Self-Learning Pipeline

## Overview

The self-learning pipeline is the modern way to teach your AI agent about your preferences, workflows, and patterns. Instead of manually logging learnings, you simply use `ingenium_observe` during your workflow, and the system automatically processes observations into personality traits and skill updates.

## Architecture

```
User OpenCode Session (:4098)
  │
  ├─ Agent uses ingenium_observe() during workflow
  │   → observation stored in DB (pending)
  │
  ├─ Observer Plugin (session.idle / session.created)
  │   → imports local file fallbacks
  │   → triggers synthesis
  │
  └─ Synthesis Pipeline (triggered by /synthesize or plugin)
      → classifies observations
      → updates personality_traits
      → marks observations as processed
      → updates skills
```

## Observation Types

Use these 10 observation types when calling `ingenium_observe`. The email client (Gmail/Outlook OAuth2 + IMAP) is also an important source of observations:

| Type | When to use | Example |
|------|-------------|---------|
| `correction` | User corrects agent behavior | "User prefers snake_case over camelCase" |
| `preference` | User expresses a preference | "User wants 2-space indentation" or "Prefers Gmail over Outlook for OAuth2 setup" |
| `pattern` | Recurring behavior observed | "User always adds JSDoc comments" |
| `insight` | Novel discovery | "Container PTY works with glibc" |
| `feedback` | Implicit accept/reject | "User accepted the refactored code" |
| `behavior` | User behavior signal | "User runs tests before committing" |
| `terminology` | Preferred language | "User calls it 'deploy' not 'release'" |
| `workflow` | Workflow sequence | "User runs lint before commit" |
| `error` | User encountered error | "User hit TypeScript strict mode error" |
| `goal` | Stated or implied goal | "User wants to improve test coverage" |

## How to Use

### For Agents (during workflow)

Use `ingenium_observe` naturally during your workflow — just like you use `read`, `grep`, or `edit`. The email client is also a rich source of observations:

```typescript
// Store an observation during your work
ingenium_observe(
  observation_type: "preference",
  content: "User prefers concise error messages with action items",
  importance: 7
)

// Email-specific examples (after OAuth2 setup or email workflow discovery)
ingenium_observe({
  observation_type: "insight",
  content: "Email composition works seamlessly through nodemailer — no additional configuration needed after OAuth2 setup",
  importance: 8
})

ingenium_observe({
  observation_type: "pattern", 
  content: "User searches emails by combining subject keywords with date ranges (e.g., 'invoice AND month:june')",
  importance: 6
})
```

The observation is stored in the DB with status "pending". The synthesis pipeline will process it later.

### For the Orchestrator

Run `/synthesize` to trigger the synthesis pipeline, or wait for the background observer plugin to auto-trigger on session events.

## Personality Traits

The synthesis pipeline creates personality traits from observations. Each observation type maps to specific trait types:

| Trait Type | Generated from | Description |
|------------|---------------|-------------|
| `communication_style` | correction, preference | How the agent should communicate |
| `code_preference` | preference, correction | Code style and formatting preferences |
| `workflow_pattern` | pattern, workflow | User's development workflow patterns |
| `terminology` | terminology | Preferred terms and language |
| `priority_signal` | behavior, goal, error | What the user prioritizes |
| `feedback_style` | correction, feedback | How user gives feedback |
| `interaction_pattern` | behavior | Interaction style with agent |
| `domain_knowledge` | insight | User's domain expertise areas |
| `learned_skill` | pattern, workflow | Skills learned from observations |
| `personality_trait` | All types | General personality characteristics |

## MCP Tools

### Core Observation & Personality Tools

| Tool | Purpose |
|------|---------|
| `ingenium_observe` | Store an observation (10 types available) |
| `ingenium_observation_search` | FTS5 search across observations with ranking |
| `ingenium_observation_list` | List observations with filters (type, status, importance) |
| `ingenium_observation_stats` | Get pipeline statistics (pending/processed counts) |
| `ingenium_personality` | Get full personality profile from all traits |
| `ingenium_personality_traits` | List personality traits with filtering |
| `ingenium_synthesis_run` | Trigger synthesis pipeline manually |
| `ingenium_synthesis_status` | Check pipeline status and stats |

### Email Client Tools (OAuth2 + IMAP/SMTP)

The email client registers these tools for direct MCP access:

| Tool | Purpose | Parameters | Returns |
|------|---------|------------|---------|
| `email_account_list` | List all configured OAuth2 accounts | — | Array of `{ id, provider, emailAddress }` objects (Gmail/Outlook) |
| `email_compose_message` | Compose and send new email via SMTP | `{ accountId: string, to: string[], subject: string, body: string, attachments?: File[] }` | Message ID or error message |
| `email_search_inbox` | Search emails across all accounts with FTS5 ranking | `{ query: string, limit?: number, accountId?: string }` | Array of matching email summaries with highlighted text |

**Example usage in OpenCode:**
```typescript
// List configured OAuth2 accounts  
const accounts = await ingenium_email_account_list();
console.log("Configured:", accounts); // [{ id: "1", provider: "gmail", emailAddress: "user@gmail.com" }]

// Search inbox for invoice-related emails with FTS5 ranking
const results = await ingenium_email_search_inbox({ query: "invoice 2026", limit: 5 });
results.forEach(msg => { console.log(`${msg.subject} from ${msg.sender}`); })

// Compose and send message via SMTP (nodemailer)
await ingenium_email_compose_message({ 
  accountId: accounts[0].id,
  to: ["recipient@example.com"],
  subject: "Project Update",
  body: `Here's the latest status report...`
});
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/observations` | GET | List observations with filters |
| `/api/v1/observations/search` | GET | FTS5 search across observations |
| `/api/v1/observations/stats` | GET | Pipeline statistics |
| `/api/v1/personality` | GET | Full personality profile |
| `/api/v1/personality/traits` | GET | List personality traits |
| `/api/v1/synthesis/run` | POST | Trigger synthesis pipeline |
| `/api/v1/synthesis/status` | GET | Check pipeline status |

## Deprecation Notice

The old `ingenium_learning_log` MCP tool is **deprecated** but still functional. It forwards to both the old `learnings` table and the new `observations` table for backward compatibility.

**Migration path:**
- New code should use `ingenium_observe` instead of `ingenium_learning_log`
- Existing learnings entries will be processed by the synthesis pipeline
- The `/process-learnings` command is deprecated; use `/synthesize` instead

## Dashboard Pages

The Ingenium Dashboard provides visual management for the self-learning system:

- **Observations Page** — View, search, and filter observations
- **Personality Page** — View your agent's learned personality profile
- **Learnings Page** — Deprecated, redirects to Observations page

## Code Location

| Component | Path |
|-----------|------|
| Core tools | `packages/ingenium-core/lib/tools/observations.ts`, `personality.ts`, `synthesis.ts` |
| API routes | `services/ingenium-api/lib/routes/observations.ts`, `personality.ts`, `synthesis.ts` |
| MCP server | `services/ingenium-server/scripts/mcp-server.ts` (tools registered) |
| Plugin | `.opencode/plugins/observer.ts`, `observer-core.ts` |
| Dashboard pages | `services/ingenium-dashboard/src/app/observations/page.tsx`, `personality/page.tsx` |

## Self-Improvement Commands

After making changes to the self-learning system:

```bash
# Run synthesis to process observations
/synthesize

# Check pipeline status
ingenium_synthesis_status

# View personality profile
ingenium_personality

# Search observations
ingenium_observation_search("keyword")
```

## Related Documentation

- `.opencode/skills/self-learning/SKILL.md` — Complete skill documentation
- [docs/HOW-TO/learnings.md](./learnings.md) — Old learnings documentation (deprecated, kept for reference)
- .opencode/skills/skill-maintenance/SKILL.md — Skill lifecycle management
