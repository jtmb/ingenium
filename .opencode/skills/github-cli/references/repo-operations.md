---
title: "Repo Operations — Set Description, Topics, Homepage"
impact: LOW
impactDescription: "Quick metadata edits via CLI instead of browser"
tags: [github, repo, metadata]
---

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
