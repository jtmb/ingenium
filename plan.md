# Plan: Agent Pipeline Improvements — Probing, Todo Tracking, Multi-Model

## TL;DR

Fix three gaps in our agent pipeline: (1) the scrum agent doesn't ask probing questions before planning, going straight to research without validating assumptions; (2) the orchestrator tracks work exclusively on the kaban board with no in-session OpenCode todo visibility; (3) all subagent instances of the same name use the same model — no way to split work across fast/capable models. Additionally, create a centralized model config convention and fix 4 bugs found during QA review.

## Orchestrator Instructions

| Phase | Step | Subagent | Task | Blocked by |
|-------|------|----------|------|------------|
| 0 | 0 | @ingenium-software-engineer | **Fix QA bugs.** Fix `in-progress` → `in_progress` in 3 files (orchestrator.md, primer/SKILL.md, agent-pipelines/SKILL.md). Add missing `mcp:` permission block to orchestrator.md listing all kaban tools it uses. Fix orphaned `4.` in orchestrator-primer. Fix orchestrator.md line 190 — change "writes final files" to "delegates file writes to @ingenium-software-engineer". Sync all to deploy variants. | — |
| 1 | 1 | @ingenium-software-engineer | **Add probing questions to scrum agent.** Update `.opencode/agents/primary/ingenium-scrum.md`: Add a new `§1.5 Probe` step between "Understand" and "Delegate to subagents". Add 🔴 HARD RULE "Ask Before You Plan". Add `question` tool usage for structured requirement gathering. Add assumption validation step. Update Process section numbering. Sync the file to deploy variants. | Phase 0 |
| 1 | 2 | @ingenium-software-engineer | **Add risk assessment to plan format.** Update `.opencode/agents/primary/ingenium-scrum.md`: Add "Risks" as a required section in the Plan Style Guide. Each risk must state: what could go wrong, likelihood, mitigation. Add to the Plan Style Guide table. Sync to deploy variants. | Phase 0 |
| 1 | 3 | @ingenium-software-engineer | **Enable todowrite in orchestrator.** Update `.opencode/agents/primary/ingenium-orchestrator.md`: Add `todowrite: allow` to permission block. Update kaban workflow to ALSO mirror tasks to todowrite — add task as pending when read from kaban, mark completed when done. Add instruction: "Update `todowrite` in parallel with each kaban transition so in-session progress is visible." Sync to deploy variants. | Phase 0 |
| 2 | 4 | @ingenium-software-engineer | **Create multi-model agent variants.** Create two new subagent files: `.opencode/agents/execution/ingenium-software-engineer-fast.md` (budget model, e.g. lmstudio/qwen3.5-9b or deepseek/deepseek-v4-flash) and `.opencode/agents/execution/ingenium-software-engineer-premium.md` (capable model, e.g. deepseek/deepseek-v4-pro). Content: identical to existing engineer, only `model:` differs. Update orchestrator's subagent delegation table to say "Use @ingenium-software-engineer-fast for standard tasks, @ingenium-software-engineer-premium for complex/risky work." Sync to deploy variants. | Phase 0 |
| 2 | 5 | @ingenium-software-engineer | **Create centralized model config convention.** Create `.agents/models.yaml` mapping agent names to model tiers. NOT read by OpenCode — it's a human-editable source of truth for model assignments. Add a comment at the top explaining this convention. Document this in `.agents/README.md` (create if not exists). | Phase 0 |
| 3 | 6 | @ingenium-qa | **Review all changes.** Verify probing questions are useful and not perfunctory. Confirm todowrite integration doesn't break kaban workflow. Verify new agent models are correctly assigned. Check that deploy variants are synced. | Phase 2 |
| 3 | 7 | @ingenium-docs | **Update documentation.** Update `docs/agents.md` with new probing workflow and multi-model agent variants. Update `docs/ARCHITECTURE.md` with model config convention. Log to `.agents/skills/learnings.md`. | Phase 2 |
| 4 | 8 | @ingenium-orchestrator (yourself) | **Commit.** git add all + git commit with descriptive message. Verify tests pass. Archive kaban board. | Phase 3 |

## Detailed Change Specs

### Q. QA Bug Fixes

**Bug 1: `in_progress` column name** — 3 files use `in-progress` (hyphen) instead of `in_progress` (underscore). The kaban board column IDs are: `backlog`, `todo`, `in_progress`, `review`, `done`.

| File | Line | Fix |
|------|------|-----|
| `.opencode/agents/primary/ingenium-orchestrator.md` | ~162 | `kaban_move_task <id> in-progress` → `kaban_move_task <id> in_progress` |
| `.agents/skills/orchestrator-primer/SKILL.md` | ~14 | `kaban_move_task <id> in-progress` → `kaban_move_task <id> in_progress` |
| `.agents/skills/agent-pipelines/SKILL.md` | ~290 | `todo → in-progress → review → done` → `todo → in_progress → review → done` |

**Bug 2: Orphaned `4.` in orchestrator-primer** — Line 26 has `4.` with no items 1-3. Replace `4.` with `## Kaban Tracking` heading.

**Bug 3: Orchestrator missing MCP permissions** — The orchestrator instructs calls to kaban tools but has no `mcp:` block in its frontmatter `permission:`. Add:

```yaml
mcp:
  "kaban_kaban_add_task": "allow"
  "kaban_kaban_add_task_checked": "allow"
  "kaban_kaban_move_task": "allow"
  "kaban_kaban_complete_task": "allow"
  "kaban_kaban_get_next_task": "allow"
  "kaban_kaban_check_dependencies": "allow"
  "kaban_kaban_status": "allow"
  "kaban_kaban_archive_tasks": "allow"
  "kaban_kaban_export_markdown": "allow"
  "kaban_kaban_wins": "allow"
```

**Bug 4: Orchestrator self-contradiction** — Line ~190 says "orchestrator merges findings, writes final files" which violates "NEVER write code yourself." Change to: "orchestrator merges findings, delegates file writes to @ingenium-software-engineer, spawns @ingenium-docs"

### 1. Probing Questions for Scrum Agent

**File**: `.opencode/agents/primary/ingenium-scrum.md`

After the existing Process §1 "Understand" and before §2 "Delegate to subagents", insert:

```
### 1.5. Probe — Validate Understanding Before Research

Before delegating ANY research, you MUST validate your understanding with the user. Do not assume. Do not skip this step.

**🔴 HARD RULE — Ask Before You Plan**: Before spawning ANY research subagents, you MUST ask clarifying questions. If the user's request is ambiguous, underspecified, or missing critical context, ask now — not after the research is done.

**Required questions** (ask at least 3 of these, adapt to context):

| Question | When to ask |
|----------|------------|
| What's the priority/urgency of this work? | Always |
| Are there any constraints or non-negotiables? | Always |
| What does success look like? Acceptance criteria? | New features |
| Who are the stakeholders or affected users? | Cross-cutting changes |
| Is there a time estimate or deadline? | Always |
| Are there known risks or concerns with this area? | Changes to existing code |
| What scope is deliberately OUT of this work? | Large features |
| Do you have testing preferences (framework, coverage)? | New code |
| Should this be split across multiple sprints/PRs? | Large features |

**After asking**, wait for user response. Do NOT proceed to research until you have answers.

**Validation checks** (state these explicitly to the user):
1. "Here's what I understand you want: {one-paragraph restatement}. Is that correct?"
2. "I am assuming: {list your key assumptions}. Are these safe?"
3. "I will NOT work on: {explicit scope boundary}. Confirm?"

**Use the `question` tool** for structured questions when the user needs to pick from options. For open-ended questions, use freeform text.
```

Also update the Process section numbering: step 1.5 inserts between 1 and 2, so all subsequent numbers shift by 0.5:
- Old §2 (Delegate) → remains §2  
- Old §3 (Analyze) → remains §3
- Old §4 (Plan) → remains §4
- Old §5 (Populate kaban) → remains §5
- Old §6 (Persist and hand off) → remains §6

### 2. Risk Assessment in Plan Format

**File**: `.opencode/agents/primary/ingenium-scrum.md`

In the Plan Style Guide, add "Risks" to the Required Sections list:

```
**Risks** — What could go wrong? Each risk must state: (1) the risk, (2) likelihood (low/medium/high), (3) impact, (4) mitigation. No plan is complete without risks.
```

Template example:
```
## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Dependency X changes its API mid-implementation | Low | High — blocking | Pin version, monitor changelog |
| Test coverage gap in edge case Y | Medium | Medium — regression risk | Add explicit edge-case test in Phase 2 |
| N+1 query introduced by refactor | Low | High — perf regression | Profile before/after with existing benchmarks |
```

### 3. Todowrite Mirror in Orchestrator

**File**: `.opencode/agents/primary/ingenium-orchestrator.md`

**A. Add `todowrite: allow` to permissions**:
```yaml
permission:
  todo: allow          # <-- ADD THIS
  read: allow
  ...
```

**B. Update the Kaban Workflow section** — after each kaban action, add a todowrite mirror instruction:

```
1. **Get next task**: Call `kaban_get_next_task` → also add to `todowrite` as `pending`
...
3. **Move to in-progress**: Call `kaban_move_task <id> in_progress` → also mark `in_progress` in `todowwrite`
...
6. **After subagent completes**: Call `kaban_move_task <id> review` → mark `in_progress` → `pending` in `todowrite` for the QA task
7. **After QA passes**: Call `kaban_complete_task <id>` → mark `completed` in `todowrite`
```

**C. Add to the Anti-Patterns table**:
```
| "I forgot to update todowrite" | Only updating kaban, not todowrite | Update BOTH kaban and todowrite at each transition |
```

### 4. Multi-Model Agent Variants

**Create**: `.opencode/agents/execution/ingenium-software-engineer-fast.md`

```markdown
---
name: ingenium-software-engineer-fast
description: "Budget-tier implementation agent. Use for standard, low-risk coding tasks — bug fixes, simple refactors, documentation code examples. Same behavior as @ingenium-software-engineer but runs on a cheaper model."
mode: subagent
model: deepseek/deepseek-v4-flash
reasoningEffort: "medium"
permission:
  read: allow
  edit: allow
  write: allow
  glob: allow
  grep: allow
  list: allow
  bash: allow
  task:
    "ingenium-explore": "allow"
    "ingenium-scout": "allow"
  skill:
    "*": "allow"
skills:
  - generic-conventions
  - model-profiles
  - local-model-commands
  - shell-scripts
  - useful-tests
  - project-structure
  - skill-load
---

# Ingenium Software Engineer (Fast)

Budget-tier implementation agent. Same behavior as `@ingenium-software-engineer` — writes code, implements features, refactors, fixes bugs, performs design review. Runs on a cheaper model for cost efficiency on standard tasks.

**Use this agent for**: Standard bug fixes, simple refactors, documentation code blocks, test authoring, straightforward implementation tasks.

**Use `@ingenium-software-engineer-premium` for**: Complex multi-file refactoring, architectural changes, performance-critical code, security-sensitive work, tasks requiring deep reasoning.

(Include the full engineer prompt from the existing engineer agent — it should be behaviorally identical, only the model differs.)
```

**Create**: `.opencode/agents/execution/ingenium-software-engineer-premium.md`

```markdown
---
name: ingenium-software-engineer-premium
description: "Premium-tier implementation agent. Use for complex, high-risk, or architecture-level coding tasks. Same behavior as @ingenium-software-engineer but runs on a more capable model."
mode: subagent
model: deepseek/deepseek-v4-pro
reasoningEffort: "xhigh"
permission:
  read: allow
  edit: allow
  write: allow
  glob: allow
  grep: allow
  list: allow
  bash: allow
  task:
    "ingenium-explore": "allow"
    "ingenium-scout": "allow"
  skill:
    "*": "allow"
skills:
  - generic-conventions
  - model-profiles
  - local-model-commands
  - shell-scripts
  - useful-tests
  - project-structure
  - skill-load
---

# Ingenium Software Engineer (Premium)

Premium-tier implementation agent. Same behavior as `@ingenium-software-engineer` — writes code, implements features, refactors, fixes bugs, performs design review. Runs on DeepSeek V4 Pro for maximum capability on complex tasks.

**Use this agent for**: Complex multi-file refactoring, architectural changes, performance-critical code, security-sensitive work, tasks requiring deep reasoning across multiple domains.

**Use `@ingenium-software-engineer-fast` for**: Standard bug fixes, simple refactors, documentation code blocks, test authoring, straightforward implementation tasks.

(Include the full engineer prompt from the existing engineer agent.)
```

**Update**: `.opencode/agents/primary/ingenium-orchestrator.md` — in the Subagent Delegation Table:

```
| Work type | Delegate to | Model tier |
|-----------|-------------|------------|
| Standard code, bug fixes, simple refactors | `@ingenium-software-engineer-fast` | Budget (cheap) |
| Complex refactoring, architecture, security | `@ingenium-software-engineer-premium` | Premium (capable) |
| General implementation (default) | `@ingenium-software-engineer` | Standard |
```

### 5. Centralized Model Config Convention

**Create**: `.agents/models.yaml`

```yaml
# .agents/models.yaml — Centralized model configuration
# 
# This file is a HUMAN-EDITABLE SOURCE OF TRUTH for model assignments.
# It is NOT read by OpenCode automatically — you must sync changes to
# individual agent .md files's frontmatter `model:` field.
#
# When changing a model, update this file first, then propagate to each
# agent's .md frontmatter.
#
# Convention: model strings follow OpenCode format (provider/model)

# ── Model Aliases (use these in agent configs below) ──

models:
  fast:     deepseek/deepseek-v4-flash        # Budget-tier, 13B active parameters
  capable:  deepseek/deepseek-v4-flash        # Standard tier (same model, different reasoning effort)
  premium:  deepseek/deepseek-v4-pro           # Premium tier, 49B active parameters
  local:    lmstudio/qwen3.5-9b               # Local inference, free
  budget:   deepseek/deepseek-v4-flash         # Alias for fast

# ── Agent → Model Assignments ──

agents:
  primary:
    ingenium-scrum:         premium           # Master planner — needs deep reasoning
    ingenium-orchestrator:  capable           # Coordinator — needs speed + reliability

  execution:
    ingenium-software-engineer:          capable   # Standard implementation
    ingenium-software-engineer-fast:     fast      # Budget-tier variant
    ingenium-software-engineer-premium:  premium   # Premium-tier variant

  research:
    ingenium-explore:             fast      # Code search — fast, wide
    ingenium-scout:               capable   # Thread/web search — moderate reasoning
    ingenium-security-auditor:    capable   # Security analysis — thorough

  review:
    ingenium-qa:                  capable   # Code review + test authoring
    ingenium-docs:                fast      # Documentation — mechanical
    ingenium-plan-file:           fast      # Plan file CRUD — mechanical

# ── Reasoning Effort Overrides (per agent) ──

reasoning:
  ingenium-scrum:                        xhigh    # Maximum reasoning for planning
  ingenium-orchestrator:                 high     # Moderate reasoning for coordination
  ingenium-software-engineer-fast:       medium   # Standard reasoning
  ingenium-software-engineer-premium:    xhigh    # Deep reasoning for complex tasks
```

**Update**: `AGENTS.md` — add a reference to `.agents/models.yaml`:

Add to the repository structure section:
```
├── .agents/
│   ├── models.yaml             # Centralized model configuration (human-editable)
```

**Note to orchestrator**: The `.agents/models.yaml` file is a CONVENTION — not a feature. It documents model assignments but doesn't automate them. When you change models, update this file first, then manually update each agent's frontmatter `model:` field in its `.md` file.

## Relevant Files

| File | Action | Description |
|------|--------|-------------|
| `.opencode/agents/primary/ingenium-orchestrator.md` | MODIFY | Fix bugs: in_progress column, mcp permissions, self-contradiction, todowrite integration, delegation table update |
| `.agents/skills/orchestrator-primer/SKILL.md` | MODIFY | Fix in_progress column, orphaned numbering |
| `.agents/skills/agent-pipelines/SKILL.md` | MODIFY | Fix in_progress column |
| `.opencode/agents/primary/ingenium-scrum.md` | MODIFY | Add probing questions §1.5, risk assessment to plan format |
| `.opencode/agents/execution/ingenium-software-engineer-fast.md` | CREATE | Budget-tier engineer agent |
| `.opencode/agents/execution/ingenium-software-engineer-premium.md` | CREATE | Premium-tier engineer agent |
| `.agents/models.yaml` | CREATE | Centralized model configuration convention |
| `AGENTS.md` | MODIFY | Add models.yaml to repo structure |
| `docs/agents.md` | MODIFY | Add probing workflow, multi-model agents, model config convention |
| `docs/ARCHITECTURE.md` | MODIFY | Add model config convention, multi-model pattern |
| `.agents/skills/learnings.md` | MODIFY | Log all changes |

## Verification

1. **Column name fix**: `grep "in-progress" .opencode/agents/primary/*.md .agents/skills/orchestrator-primer/SKILL.md .agents/skills/agent-pipelines/SKILL.md` — must return nothing
2. **Orchestrator MCP permissions**: `grep -A 15 "mcp:" .opencode/agents/primary/ingenium-orchestrator.md` — must show all 10 kaban tools
3. **Orchestrator todowrite**: `grep "todowrite" .opencode/agents/primary/ingenium-orchestrator.md` — must show at least 3 occurrences (permission, workflow, anti-pattern)
4. **Probing questions**: `grep "Probe" .opencode/agents/primary/ingenium-scrum.md` — must show "Probe — Validate Understanding"
5. **Risk section**: `grep "Risks" .opencode/agents/primary/ingenium-scrum.md` — must show "Risks" as a required plan section
6. **New agent files exist**: `ls .opencode/agents/execution/ingenium-software-engineer-fast.md .opencode/agents/execution/ingenium-software-engineer-premium.md`
7. **Models.yaml exists**: `test -f .agents/models.yaml && echo "PASS" || echo "FAIL"`
8. **Deploy sync**: all modified source files have matching deploy copies with same md5

## Decisions

- **Probing questions are mandatory** before research — 🔴 HARD RULE, not optional
- **todowrite mirrors kaban** — dual tracking for in-session visibility + persistent board state
- **Multi-model via separate agents** — OpenCode doesn't support pools, so we create named variants
- **`.agents/models.yaml` is a convention** — not an OpenCode feature; manual sync required
- **Existing `ingenium-software-engineer` stays as default** — fast and premium are supplements, not replacements
- **`ingenium-software-engineer-fast` uses the same model as default** initially — differentiation is in reasoning effort (`medium` vs `high`) and intended task complexity
- **Deploy variants DO get the new execution agents** — they're part of the agent pipeline, not project-specific
- **Scrum process renumbering is minimal** — §1.5 inserts cleanly; no cascading renumbers needed since we use numbered lists, not paragraph numbering
