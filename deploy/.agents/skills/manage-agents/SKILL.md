---
name: manage-agents
description: "Manage agent definitions (.agent.md files) — create, update, retire, and validate agent files. AUTO-INVOKE when model-profiles is updated, when new agent roles are needed, or when agent files are stale. Uses model-profiles for model-to-role assignments."
---

# Manage Agents — Agent Definition Lifecycle

## When to Use

- Creating a new agent role (planner, coder, reviewer, doc writer, etc.)
- Updating model assignments when new models become available in `model-profiles`
- Retiring agent files when a role is no longer needed
- Validating agent frontmatter (name, description, tools, model, handoffs)
- Auditing agent files for stale models, missing tools, or broken handoff chains
- After updating `model-profiles` — re-evaluate all agent model assignments

## Auto-Invoke Trigger

This skill should be proactively invoked after:
- `model-profiles/SKILL.md` is updated with new models
- A new agent role is identified during project growth
- An existing agent's model is outdated or unavailable
- `audit-skills` detects agent file drift or misconfiguration

---

## Model-to-Role Assignment Table

Consult `model-profiles` for detailed model capabilities. These are the canonical assignments:

| Agent Role | Model | Rationale (from model-profiles) |
|-----------|-------|-------------------------------|
| **Plan** (architect) | `deepseek-v4-pro` | Best complex reasoning, architecture, multi-step planning |
| **Coder** (builder) | `deepseek-v4-flash` | Best coding efficiency-to-performance ratio; 13B active params |
| **Explore** (research) | `gemma-4-12b` | Fast, concise, strong reasoning for size; good for targeted searches |
| **Doc Writer** (docs) | `gemma-4-12b-agentic-fable5-composer2.5-v2-3.5x-tau2` | Fine-tuned creative writing + structure; ideal for documentation |
| **Reviewer** (audit) | `deepseek-v4-pro` | Best for 5-lens code review, security audits, sustained reasoning |

**Fallback chain**: If the assigned model is unavailable, fall back in this order:
1. `deepseek-v4-pro` (for reasoning-heavy roles)
2. `deepseek-v4-flash` (for coding and general roles)
3. `gemma-4-12b` (for docs, exploration, creative roles)
4. `auto` (let the harness choose)

---

## Agent File Format

Every agent file in `.github/agents/` uses this format:

```yaml
---
name: {AgentName}              # Required: matches filename stem
description: "{Required} — what this agent does, when to invoke. Keyword-rich for discovery."
argument-hint: "{Optional} — input guidance shown to user"
model: {model-name}            # Required: from model-to-role table
disable-model-invocation: true # Optional: prevent other agents from invoking
user-invocable: true|false     # Optional: show in agent picker (default: true)
tools: ['read', 'edit', ...]   # Required: tool list (omit for defaults, [] for none)
agents: ['Explore']            # Optional: subagents this agent can invoke
handoffs:                      # Optional: transitions to other agents
  - label: "Human-readable action"
    agent: {TargetAgentName}
    prompt: 'Context for the target agent'
    send: true
---
# {Agent Title}

<body — role description, rules, workflow, constraints>
```

### Required Fields

| Field | Required | Notes |
|-------|----------|-------|
| `name` | ✅ Yes | Must match filename stem (e.g., `name: Plan` for `plan.agent.md`) |
| `description` | ✅ Yes | Keyword-rich; used for subagent discovery. "Use when..." pattern. |
| `model` | ✅ Yes | From model-to-role table. Update when `model-profiles` changes. |
| `tools` | ✅ Yes | Minimal set — only what this role needs. `[]` = conversational only. |

### Optional Fields

| Field | Default | Purpose |
|-------|---------|---------|
| `argument-hint` | — | Text shown to user when invoking |
| `disable-model-invocation` | `false` | Block other agents from invoking as subagent |
| `user-invocable` | `true` | Show in agent picker; set `false` for subagent-only roles |
| `agents` | all | Restrict which subagents this agent can invoke |
| `handoffs` | — | Define transitions to other agents |

### Tool Aliases

| Alias | Purpose |
|-------|---------|
| `read` | Read file contents |
| `edit` | Edit/create files |
| `search` | Search files or text |
| `execute` | Run shell commands |
| `agent` | Invoke other agents as subagents |
| `web` | Fetch URLs and web search |

---

## Creation: Adding a New Agent

### Step 1 — Identify the Role

A new agent is needed when:
- A task is consistently delegated but there's no matching agent (e.g., "review this PR" → create Reviewer agent)
- A role distinction would improve quality (e.g., splitting "write code + write docs" into Coder + Doc Writer)
- A new phase enters the pipeline (e.g., adding a "Deployer" agent)

### Step 2 — Assign Model from Profiles

Read `model-profiles/SKILL.md` → Cross-Model Strategy Guide. Match the task to the best model. If the model isn't in the profiles, add a stub entry.

### Step 3 — Define Tools

| Role | Typical tools | Rationale |
|------|-------------|-----------|
| Planner/Architect | `[read, search, web, agent]` | Research only — no file edits |
| Coder/Builder | `[read, edit, search, execute, agent]` | Full dev access |
| Doc Writer | `[read, edit, search]` | No terminal — docs only |
| Reviewer/Auditor | `[read, search]` | Read-only — never edits |
| Explorer/Research | `[read, search, web]` | Read-only, fast |

### Step 4 — Write the Agent File

Create `.github/agents/{role}.agent.md` using the format above. Follow these principles:
- **Single role**: One persona with focused responsibilities per agent
- **Minimal tools**: Only what the role needs — excess tools dilute focus
- **Clear boundaries**: Define what the agent should NOT do
- **Keyword-rich description**: Trigger words so parent agents know when to delegate
- **Reference skills**: The body should list which `.agents/skills/` to load

### Step 5 — Commit and Log

```bash
git add -A
git commit -m "agent({name}): add {role} agent definition"
git rev-parse --short HEAD  # capture hashes
```

Append to `.agents/skills/learnings.md`:

```markdown
## YYYY-MM-DD — {agent-name} (agent)

- **Before**: `{hash}` (state before agent addition)
- **After**: `{hash}`
- **Added**: `{agent-name}.agent.md` — {one-line description}
- **Model**: {model assignment}
- **Source**: {what triggered — new role, model-profile update, etc.}
```

---

## Update: Changing an Existing Agent

### When to Update

| Trigger | Action |
|---------|--------|
| New model in `model-profiles` that better fits the role | Update `model:` field; log to learnings.md |
| Model becomes unavailable/deprecated | Fall back to fallback chain; log to learnings.md |
| Role scope expands (e.g., Coder now needs to deploy) | Add tools; update description; log |
| Handoff chain changes (new agent added to pipeline) | Update `handoffs:` and `agents:` fields; log |

### Procedure

1. **Read `model-profiles`** — is there a better model now?
2. **Update the `.agent.md`** file — change model, tools, or body
3. **Check handoff chains** — does adding/removing an agent break transitions?
4. **Commit before and after** — capture both hashes
5. **Log to `learnings.md`** with Before/After hashes

---

## Retirement: Removing an Agent

### Procedure

1. **Verify no handoffs reference it** — grep all `.agent.md` files in `.github/agents/` for the agent name
2. **Remove the file** — delete `.github/agents/{name}.agent.md`
3. **Remove from `deploy/.github/agents/`** — if it was deployed
4. **Commit and log**:

```markdown
## YYYY-MM-DD — {agent-name} (agent)

- **Before**: `{hash}` (state before retirement)
- **After**: `{hash}`
- **Retired**: `{agent-name}.agent.md` — {reason}
- **Model**: {was using X}
- **Source**: {why — role no longer needed, merged with another agent, etc.}
```

---

## Validation

Every agent file must pass these checks:

```bash
# Name matches filename
AGENT_DIR=".agents/agents"
for f in "$AGENT_DIR"/*.agent.md; do
  name=$(grep "^name:" "$f" | head -1 | sed 's/name: *//')
  expected=$(basename "$f" .agent.md)
  if [ "$name" != "$expected" ]; then
    echo "MISMATCH: $f name=$name expected=$expected"
  fi
done

# Frontmatter fences
for f in "$AGENT_DIR"/*.agent.md; do
  head -1 "$f" | grep -q "^---$" || echo "MISSING OPEN: $f"
  # Count frontmatter dashes (should be exactly 2 sets)
  dashes=$(grep -c "^---$" "$f")
  [ "$dashes" -eq 2 ] || echo "BAD FENCES ($dashes): $f"
done

# Required fields
for f in "$AGENT_DIR"/*.agent.md; do
  grep -q "^name:" "$f" || echo "MISSING name: $f"
  grep -q "^description:" "$f" || echo "MISSING description: $f"
  grep -q "^model:" "$f" || echo "MISSING model: $f"
  grep -q "^tools:" "$f" || echo "MISSING tools: $f"
done
```

### Handoff Chain Validation

Every agent referenced in a `handoffs:` block must exist:

```bash
# Collect all agent names
for f in .github/agents/*.agent.md; do
  grep "^name:" "$f" | sed 's/name: *//'
done | sort > /tmp/agent-names.txt

# Collect all handoff targets
for f in .github/agents/*.agent.md; do
  grep -A10 "^handoffs:" "$f" | grep "agent:" | sed 's/.*agent: *//'
done | sort -u > /tmp/handoff-targets.txt

# Find broken handoffs
comm -13 /tmp/agent-names.txt /tmp/handoff-targets.txt
```

---

## Integration with Other Skills

- **`model-profiles`** — authoritative model-to-task mapping. manage-agents reads this to assign models.
- **`audit-skills`** — checks agent file integrity (8th integration point): count, frontmatter, deploy drift, handoff chains.
- **`update-skills`** — same commit-before → log → commit-after pattern applied to agents.
- **`write-docs`** — agent lifecycle changes may require documentation updates.
- **`agent-pipelines`** — containerized agent orchestration; the agent files define the roles used in pipelines.

---

## Revert Safety

Same pattern as skills — always capture Before/After hashes:

```bash
# Revert an agent to its pre-change state:
git checkout <before-hash> -- .github/agents/<name>.agent.md
```
