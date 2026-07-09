---
title: "API Access and Command Reference — Direct API Calls and Usage Rules"
impact: MEDIUM
impactDescription: "Standardizes API usage patterns and CLI best practices"
tags: [github, api, cli, best-practices]
---

## API (authenticated direct calls)

When `gh` subcommands don't cover what you need, use the `gh api` command:

```bash
# GET a GitHub API endpoint
gh api /repos/owner/repo/commits --jq '.[0].sha'

# POST with body
gh api /repos/owner/repo/issues --method POST \
  -f title="New issue" \
  -f body="Details here" \
  -f labels[]="bug"
```

The `--jq` flag uses jq syntax to extract fields from the JSON response.

## Rules

- **Always use sync mode** — `gh` commands complete in <2 seconds. No async needed.
- **Check auth first** — if `gh auth status` shows "not logged in", tell the user and stop.
- **Confirm destructive actions** — before `gh pr merge`, `gh issue close`, or `gh release create`, tell the user what you're about to do and wait for confirmation.
- **Prefer `gh` over browser** — for metadata edits, PR/issue queries, and releases, `gh` is faster and scriptable.
- **Use `--json` for structured output** — `gh` subcommands support `--json` for machine-readable output. Use it instead of parsing human-readable tables.

## Command Decision Table

| Task | Command | Notes |
|------|---------|-------|
| Update repo description | `gh repo edit --description "..."` | Fast, no browser |
| Add/change topics | `gh repo edit --add-topic "..."` | Replaces all topics |
| Set homepage | `gh repo edit --homepage "..."` | Link to docs |
| Create PR | `gh pr create --title "..." --body "..."` | Use after pushing a feature branch |
| List PRs | `gh pr list --state open` | Quick status check |
| Create release | `gh release create vX.Y.Z --notes "..."` | After merging |
| Quick gist | `gh gist create file --public` | Share snippets |
| Search across repos | `gh search repos "..."` | Discover related projects |
| Raw API access | `gh api /endpoint` | When no subcommand exists |
