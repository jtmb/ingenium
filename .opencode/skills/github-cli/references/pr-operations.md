---
title: "Pull Request Operations — List, View, Create, Merge"
impact: HIGH
impactDescription: "Standardizes PR workflow via CLI for speed and scriptability"
tags: [github, pr, pull-request, review]
---

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
