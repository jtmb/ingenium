---
name: github-cli
description: "GitHub CLI (`gh`) integration — update repo metadata, manage PRs/issues/releases, create gists, search code, and query the API. Use whenever the user asks for GitHub operations that `gh` can handle faster than the browser."
alwaysApply: true
tags: ["github", "cli", "gh", "pr", "issues", "releases"]
---

# GitHub CLI — `gh`

You have access to the `gh` CLI (authenticated) for GitHub operations. Prefer `gh` over manual API calls or opening the browser for repo management tasks.

## Before Using

Always verify auth is working first. If `gh auth status` fails, tell the user to run `gh auth login`.

```bash
gh auth status 2>&1
```

## 🔴 HARD RULE — Every Issue Must Be Complete

If you file a bug report or feature request, you MUST include complete details: version, reproduction steps, expected vs actual behavior, environment. An incomplete issue wastes everyone's time on back-and-forth.

## Reference Files

| File | Content |
|------|---------|
| [`references/repo-operations.md`](references/repo-operations.md) | Set description, topics, homepage; view repo metadata |
| [`references/pr-operations.md`](references/pr-operations.md) | List, view, create, merge PRs; add labels; check CI status |
| [`references/issue-operations.md`](references/issue-operations.md) | Create, list, view, close issues; filing bugs and feature requests |
| [`references/releases-gists-search.md`](references/releases-gists-search.md) | Create/list releases, create/list gists, search repos/issues |
| [`references/api-reference.md`](references/api-reference.md) | Direct API access with `gh api`, rules, and command decision table |

## Cross-References

- **`development-conventions`** — README documentation, API design, Python/Next.js conventions
- **`local-models`** — Command safety rules for running CLI commands
