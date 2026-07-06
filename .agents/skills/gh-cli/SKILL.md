---
name: gh-cli
description: >-
  GitHub CLI (`gh`) integration — update repo metadata, manage PRs/issues/releases,
  create gists, search code, and query the API. Use whenever the user asks for GitHub
  operations that `gh` can handle faster than the browser.
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

## Repo Metadata

### Set description
```bash
gh repo edit --description "One-liner that sells the project."
```

### Set topics (replaces all)
```bash
gh repo edit --add-topic "topic1,topic2,topic3"
```

### Set homepage URL
```bash
gh repo edit --homepage "https://example.com/docs"
```

### View any repo (not just current)
```bash
gh repo view owner/repo --json name,description,url,topics
```

## Pull Requests

### List open PRs
```bash
gh pr list --state open --json number,title,author,createdAt,url
```

### View a PR
```bash
gh pr view <number> --json number,title,body,state,reviews,comments
```

### Create a PR
```bash
gh pr create --title "feat: description" --body "Detailed summary of changes." --base main
```

### Add labels to a PR
```bash
gh pr edit <number> --add-label "bug,needs-review"
```

### Merge a PR
```bash
gh pr merge <number> --squash --delete-branch
```

### Check PR status (CI)
```bash
gh pr checks <number>
```

## Issues

### 🔴 HARD RULE — Every Issue Must Be Complete

**If you file a bug report or feature request, you MUST use the template at [templates/issue-report.md](templates/issue-report.md).** An incomplete issue wastes everyone's time on back-and-forth ("what version?", "how to reproduce?").

The template is designed so someone else can diagnose and fix the issue without asking a single follow-up question. If you skip a section, you are delivering a broken report.

### Filing a Bug Report

Use the template file to file a complete bug:

```bash
# Populate the template with your specific details, then create
gh api repos/{owner}/{repo}/issues \
  -X POST \
  -f title="Bug: {one-line summary}" \
  -f body="$(cat .agents/skills/gh-cli/templates/issue-report.md)" \
  -f type="Bug" \
  -f labels[]="bug" \
  --jq '.html_url'
```

Edit the body to replace placeholders with your specific data before submitting.

### Filing a Feature Request

```bash
gh api repos/{owner}/{repo}/issues \
  -X POST \
  -f title="Feature: {one-line summary}" \
  -f body="$(cat .agents/skills/gh-cli/templates/issue-report.md)" \
  -f type="Feature" \
  -f labels[]="enhancement" \
  --jq '.html_url'
```

### Quick Commands (no template needed for simple queries)

```bash
# List open issues
gh issue list --state open --json number,title,labels,updatedAt

# View an issue
gh issue view <number> --json number,title,body,state,comments

# Create a simple issue (no template — only for trivial items)
gh issue create --title "Task: description" --body "Brief note" --label "task"

# Close an issue
gh issue close <number> --reason "completed"
```

### Cross-Reference

For GitHub issue operations beyond basic creation (issue types, projects V2, sub-issues, dependencies), use `gh api` directly with the GitHub REST API — see the API section below. The `gh-cli` template at `templates/issue-report.md` covers complete bug reporting structure.

## Releases

### List releases
```bash
gh release list --json tagName,name,publishedAt
```

### Create a release
```bash
gh release create v1.2.3 --title "v1.2.3" --notes "## What's new\n- Feature A\n- Fix B"
```

### Download release assets
```bash
gh release download v1.2.3 --pattern "*.tar.gz" --dir ./downloads
```

## Gists

### Create a public gist
```bash
gh gist create file.py --desc "Quick snippet" --public
```

### Create a secret gist
```bash
gh gist create config.json --desc "Private notes"
```

### List your gists
```bash
gh gist list
```

## Search

### Search repos
```bash
gh search repos "topic:ai language:python" --json name,owner,url,description --limit 20
```

### Search issues/PRs
```bash
gh search issues "bug in:title label:help-wanted" --limit 20
```

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

## When to Use

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

## Rules

- **Always use sync mode** — `gh` commands complete in <2 seconds. No async needed.
- **Check auth first** — if `gh auth status` shows "not logged in", tell the user and stop.
- **Confirm destructive actions** — before `gh pr merge`, `gh issue close`, or `gh release create`, tell the user what you're about to do and wait for confirmation (unless they explicitly asked for it).
- **Prefer `gh` over browser** — for metadata edits, PR/issue queries, and releases, `gh` is faster and scriptable.
- **Use `--json` for structured output** — `gh` subcommands support `--json` for machine-readable output. Use it instead of parsing human-readable tables.
