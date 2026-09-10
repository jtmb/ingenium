---
title: "WSL Pre-Flight Assessment and Disk Usage Reference"
impact: MEDIUM
impactDescription: "Prevents destructive cleanup without understanding current disk state"
tags: [wsl, pre-flight, assessment, disk-usage]
---

## WSL Pre-Flight Assessment and Disk Usage Reference

### When to Use

Invoke this skill when the user makes a request related to WSL2 disk space or system maintenance: "clean up WSL", "disk space low", "free up space", "WSL is running out of space", "reclaim space on WSL".

### Pre-Flight Assessment (Always First)

Before any cleanup operation, run these commands to assess current state:

```bash
# Disk usage by mount point
df -h

# Docker disk usage (tolerate missing Docker)
docker system df || true

# Top 20 largest directories in $HOME
du -sh "$HOME"/* 2>/dev/null | sort -hr | head -20 || true

# Journal disk usage
journalctl --disk-usage || true
```

Review the output and identify where the space pressure is before proposing specific cleanups.

### Component Disk Usage Reference

| Location | Typical Size | Notes |
|----------|-------------|-------|
| `/var/lib/docker/` | 5-50 GB | Main Docker storage |
| `~/.cache/pip/` | 0.5-5 GB | Pip package cache |
| `~/.cache/npm/` | 0.5-3 GB | npm global cache |
| `~/.cache/huggingface/` | 1-100 GB | HuggingFace model cache |
| `~/.ollama/models/` | 2-40 GB | Ollama model storage |
| `~/.lmstudio/models/` | 5-50 GB | LM Studio model files |
| `/var/log/journal/` | 100-500 MB | Systemd journal |
| `/var/cache/apt/archives/` | 200-800 MB | Downloaded .deb packages |
| `/var/lib/snapd/` | 1-5 GB | Snap packages and revisions |
