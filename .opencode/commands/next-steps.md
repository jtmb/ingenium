# next-steps

Suggest a bug, issue, or feature request based on the tracking template `next-steps-plan/next-steps-template.md`. This command is READ-ONLY — it never writes to disk.

## Usage

```
/next-steps <description>
```

## What it does

1. Reads `next-steps-plan/next-steps-template.md` to understand the target structure (sections, subsections, and existing numbering)
2. Intelligently categorizes the input:
   - **Bug** (under `## Bugs`) if the description mentions a broken page, malfunction, error, or fix
   - **Feature** (under `## Features`) if the description describes new functionality, a new page, or new capability
3. For Bugs, further categorizes under the right subsection based on what page/component the bug is about:
   - `### /projects` — bugs on the `/projects` or `/archive` page
   - `### /Skills` — bugs on the `/skills` page or skill-related behavior
   - `### /logs` — log/monitoring issues
   - `### /mail` — bugs on the `/mail` page or email functionality
   - `### /mcp-servers` — bugs on the `/mcp-servers` page or MCP tool behavior
   - `### /observations` — bugs on the `/observations` page or observation pipeline
   - `### /personality` — bugs on the `/personality` page or trait pipeline
   - `### /tasks` — bugs on the `/tasks` kanban board
   - `### /jobs` — bugs on the `/jobs` page
   - `## opencode CLIENT BUGS` — plugin errors, client-side failures, OpenCode startup issues
   - If the page isn't recognized, add under a new subsection matching the page name
4. For Features:
   - Creates a new `### FEATURE-NAME` subsection if one doesn't exist for that feature
   - Suggests the entry under the matching feature subsection
5. Auto-numbers the suggested entry within its section (finds the highest existing number and adds +1)
6. **Outputs the suggested entry as text in the chat response** using this format (DOES NOT WRITE TO DISK):
   - Bugs: `N. Description text here.`
   - Features: `N. Description text here.`
7. Shows a confirmation message: `Suggested Bug #N under ### /section: description` or `Suggested Feature #N under ### FEATURE-NAME: description`
8. After displaying the suggestion, appends a note about the `# REQUEST/DIRECTIVE:` block that would be generated (summarizing ALL current bugs and features), reminding the user to add the orchestrator weakness clause: *"The orchestrator is DeepSeek V4 Pro — significantly worse at problem solving than you. Make sure to think through those issues and map out a solid guided plan for the below."*

## 🔴 HARD RULE — Read-Only

**This command MUST NOT write to any file.** It reads the template for structure context and outputs the proposed entry as text in the chat response. The user decides whether to add the suggestion to the tracking document manually.

## Categorization rules

- **Keyword-based bug detection**: Words like "broken", "error", "bug", "fails", "doesn't work", "not loading", "blank", "grey on grey", "crash", "wrong", "missing" indicate a bug
- **Page/component detection**: Scan for `/projects`, `/skills`, `/logs`, `/mail`, `/mcp-servers`, `/observations`, `/personality`, `/tasks`, `/jobs`
- **OpenCode client bugs**: References to "opencode client", "plugin error", "opencode.json", "package.json", "failed to install plugin", or OpenCode startup issues → `## opencode CLIENT BUGS`
- **Feature detection**: Phrases like "add", "create", "new page", "build", "implement", "would like", "want a" (without error/bug language) indicate a feature
- **New feature sections**: If the feature doesn't match an existing `###` heading under `## Features`, suggest a new `### FEATURE-NAME` section (e.g., `### ADD NEW PAGE: /jobs`, `### dark mode`)

## When to use

- When you find a bug: `/next-steps /skills code blocks are grey on grey and unreadable`
- When you want a new feature: `/next-steps add dark mode toggle to the dashboard`
- When you find an issue: `/next-steps /projects archived tab needs a search bar`
- When the plugin throws an error: `/next-steps plugin error on startup: failed to install observer.ts`
- During code review or QA when you spot a problem

## Important

- **Do NOT read `next-steps-plan/next-steps.md`** — only read the template at `next-steps-plan/next-steps-template.md` for structural context.
- **Preserve existing numbering logic in the displayed output.** If the highest number in a section is `6`, the suggested entry gets `7`.
- **Match formatting exactly in the output.** Bugs use `N. Description.` under `### /section`. Features use `N. Description.` under `### FEATURE-NAME`.
- If an `## Bugs` or `## Features` heading doesn't exist in the template, note that it would be created.
- Add the Documentation References table (from the template) only if providing full template context to the user.
- **Never write to `next-steps-plan/` or any other file.**

## Related

- `next-steps-plan/next-steps-template.md` — The template this command reads for structure (read-only)
- `next-steps-plan/next-steps.md` — The tracking document the user manually maintains
- `next-steps-plan/BIG-PLAN.md` — Orchestration plan for executing the accumulated items
