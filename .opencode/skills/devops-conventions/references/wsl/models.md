---
title: "WSL Model Cache Cleanup — Ollama, LM Studio, HuggingFace"
impact: MEDIUM
impactDescription: "Reclaims the largest space consumers on developer WSL instances"
tags: [wsl, models, ollama, lm-studio, huggingface, cleanup]
---

## WSL Model Cache Cleanup

These are typically the largest space consumers on a developer's WSL2 instance.

| Tool | Location | Assessment | Cleanup |
|------|----------|------------|---------|
| **Ollama** | `~/.ollama/models/` | `ollama list` | `ollama rm <model>` for each unused model |
| **LM Studio** | `~/.lmstudio/models/` | `du -sh "$HOME/.lmstudio/models/"*` | `rm -rf <model-dir>` with confirmation |
| **HuggingFace** | `~/.cache/huggingface/hub/` | `du -sh "$HOME/.cache/huggingface/hub/"*` | `rm -rf <model-dir>` with confirmation |

```bash
# Ollama — list and remove
ollama list 2>/dev/null || true
# Remove specific model: ollama rm <model-name>

# LM Studio models
du -sh "$HOME/.lmstudio/models/"* 2>/dev/null | sort -hr || true
# Remove specific model dir: rm -rf "$HOME/.lmstudio/models/<model>" (with confirmation)

# HuggingFace cache
du -sh "$HOME/.cache/huggingface/hub/"* 2>/dev/null | sort -hr || true
# Remove specific model: rm -rf "$HOME/.cache/huggingface/hub/<model-dir>" (with confirmation)
```

| Location | Risk | Est. Space | Notes |
|----------|------|------------|-------|
| Ollama models | 🟡 Moderate | 2-20 GB per model | Must be re-pulled if needed again |
| LM Studio models | 🟡 Moderate | 2-50 GB | Manual directory removal |
| HuggingFace hub | 🟡 Moderate | 1-100 GB | Re-downloads on next `from_pretrained()` |
