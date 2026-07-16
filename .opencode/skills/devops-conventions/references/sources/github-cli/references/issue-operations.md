---
title: "Issue Operations — Filing, Listing, Viewing, Closing"
impact: HIGH
impactDescription: "Ensures complete bug reports with reproduction steps"
tags: [github, issues, bug-report, feature-request]
---

## Issues

### Filing a Bug Report

```bash
gh api repos/{owner}/{repo}/issues \
  -X POST \
  -f title="Bug: {one-line summary}" \
  -f body="## Description\n{what happened}\n## Reproduction\n{steps}\n## Expected\n{what should happen}\n## Environment\n{version, OS}" \
  -f labels[]="bug" \
  --jq '.html_url'
```

### Filing a Feature Request

```bash
gh api repos/{owner}/{repo}/issues \
  -X POST \
  -f title="Feature: {one-line summary}" \
  -f body="## Problem\n{what this solves}\n## Solution\n{proposed implementation}" \
  -f labels[]="enhancement" \
  --jq '.html_url'
```

### Quick Commands

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
