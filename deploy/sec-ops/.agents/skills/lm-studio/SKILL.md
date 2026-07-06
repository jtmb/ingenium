---
name: lm-studio
description: "LM Studio local inference server conventions — API reference, server management, model lifecycle, vision bridge. Use when running local models via LM Studio, managing model loads/unloads, calling chat/vision/embedding endpoints, or connecting agents to the local inference server at http://192.168.0.13:1234."
---

# LM Studio — Local Inference Server

## When to Use

- Running, loading, or unloading models on the LM Studio server
- Calling any LM Studio API endpoint (`/v1/models`, `/v1/chat/completions`, `/v1/embeddings`)
- Connecting an agent or plugin to the local inference server
- Using vision/image analysis via a local vision model
- Troubleshooting model load failures, timeouts, or auth errors
- Configuring the LM Studio provider in `opencode.jsonc`

## Server Info

| Property | Value |
|----------|-------|
| **Base URL** | `http://192.168.0.13:1234/v1` |
| **Auth** | Bearer token via `Authorization` header |
| **API key file** | `~/.lm-studio-env` (source with `source ~/.lm-studio-env`) |

## API Reference

### List Available Models

```bash
curl -s http://192.168.0.13:1234/v1/models \
  -H "Authorization: Bearer $LM_STUDIO_API_KEY"
```

Returns all models installed on the server (loaded or not):

```json
{
  "data": [
    { "id": "qwopus3.6-27b-v2-mtp", "object": "model" },
    { "id": "gemma-4-12b-agentic-fable5-composer2.5-v2-3.5x-tau2", "object": "model" }
  ]
}
```

### Chat Completion

```bash
curl -s -X POST http://192.168.0.13:1234/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LM_STUDIO_API_KEY" \
  -d '{
    "model": "qwopus3.6-27b-v2-mtp",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 500
  }'
```

### Vision (Image Analysis)

See the **Vision Bridge** section below for the complete workflow.

### Embeddings

```bash
curl -s -X POST http://192.168.0.13:1234/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LM_STUDIO_API_KEY" \
  -d '{
    "model": "text-embedding-nomic-embed-text-v1.5",
    "input": "Text to embed"
  }'
```

## 🔴 Vision Bridge — Blind Model Image Analysis

When a blind model (no vision capability) needs to analyze an image, use the LM Studio vision model. There is one exact command — do not deviate.

### Setup

Ensure the API key is available:

```bash
source ~/.lm-studio-env
echo "$LM_STUDIO_API_KEY" | head -c 10
```

If missing, create the file:
```bash
echo 'LM_STUDIO_API_KEY=sk-lm-...' > ~/.lm-studio-env
chmod 600 ~/.lm-studio-env
```

### 🔴 The Exact Command

Substitute the actual PNG path and vision model name:

```bash
MODEL="google/gemma-4-12b-qat"  # ← set to whichever vision-capable model is loaded
source ~/.lm-studio-env \
  && printf '{"model":"'"$MODEL"'","messages":[{"role":"user","content":[{"type":"text","text":"Describe this screenshot in detail: layout, colors, text content, visible elements, interactive elements."},{"type":"image_url","image_url":{"url":"data:image/png;base64,' > /tmp/vp.json \
  && base64 -w0 /path/to/screenshot.png >> /tmp/vp.json \
  && printf '"}}]}],"max_tokens":1000}' >> /tmp/vp.json \
  && curl -s -X POST http://192.168.0.13:1234/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $LM_STUDIO_API_KEY" \
    -d @/tmp/vp.json \
  && rm -f /tmp/vp.json
```

**Steps:**
1. Find the PNG file path (from Playwright screenshot, user attachment, or failed view_image)
2. Replace `/path/to/screenshot.png` with the actual path
3. Replace `$MODEL` if the loaded vision model differs
4. Run the command. Read the output. Continue your task.

### Script: `scripts/vision_call.py`

A Python alternative that wraps the same logic:

```bash
python3 .agents/skills/lm-studio/scripts/vision_call.py /path/to/screenshot.png
```

### 🔴 Rules

- **DO NOT** use Playwright for the API call — the curl command is all you need
- **DO NOT** extract base64 yourself — `base64 -w0` does it
- **DO NOT** guess image contents — you're blind, use the command
- **DO NOT** ask the user to describe the image — use the command

## Provider Configuration

The LM Studio provider is configured in `~/.config/opencode/opencode.jsonc`:

```json
{
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio (local)",
      "options": {
        "baseURL": "http://192.168.0.13:1234/v1"
      },
      "models": {
        "qwopus3.6-27b-v2-mtp": {
          "name": "Qwopus 3.6 27B v2 MTP (local)"
        },
        "gemma-4-12b-agentic-fable5-composer2.5-v2-3.5x-tau2": {
          "name": "Gemma 4 12B Agentic Fable5 (local)"
        }
      }
    }
  }
}
```

To update the model list with what's actually available on the server:

```bash
curl -s http://192.168.0.13:1234/v1/models \
  -H "Authorization: Bearer $LM_STUDIO_API_KEY" \
  | python3 -c "
import json, sys
data = json.load(sys.stdin)
for m in data['data']:
    print(f'\"{m[\"id\"]}\": {{\"name\": \"{m[\"id\"]} (local)\"}},")
"
```

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `Model not found` | Model is installed but not loaded in GPU | Open LM Studio, select and load the model |
| Connection refused | Server not running | Start LM Studio and enable the local inference server |
| Timeout | Model too large or GPU out of memory | Use a smaller model or reduce context length |
| Auth error | API key missing or wrong | Source `~/.lm-studio-env` or check key |
| VRAM exhausted | Too many models loaded or context too long | Unload unused models, reduce batch size |
| `max_tokens` exceeded | Response truncated | Increase `max_tokens` or reduce prompt |

## Model Lifecycle

LM Studio manages models through its UI, but models can also be referenced at runtime:

- **Load a model**: Open LM Studio → Server → Model Management → Select model → Load
- **Check loaded models**: `curl -s http://192.168.0.13:1234/v1/models` — models available for inference
- **Unload models**: Open LM Studio → Server → Model Management → Unload
- **Model not found error**: The model ID exists in the library but isn't loaded in GPU memory

## Integration with Other Skills

- **`vision-bridge`** — Deprecated. Use the lm-studio Vision Bridge section instead.
- **`model-profiles`** — Provides capability profiles for each loaded model
- **`local-model-commands`** — Terminal safety for `curl` and long-running model commands
- **`generic-conventions`** — Security rules for API keys and auth headers
- **`shell-scripts`** — `set -euo pipefail` for any LM Studio automation scripts
