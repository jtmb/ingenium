---
title: "Releases, Gists, and Search — Create, List, and Discover"
impact: LOW
impactDescription: "Standard commands for release management, snippet sharing, and code search"
tags: [github, releases, gists, search]
---

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
