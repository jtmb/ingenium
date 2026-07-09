---
title: "LM Studio API — Server Info, Endpoints, Configuration, Common Issues"
impact: MEDIUM
impactDescription: Prevents API call failures, auth errors, and model loading confusion when using LM Studio for local inference
tags: [lm-studio, api, provider-config, local-inference]
---

## LM Studio API — Server Info, Endpoints, Configuration

### Server Info

| Property | Value |
|----------|-------|
| **Base URL** | `http://192.168.0.13:1234/v1` |
| **Auth** | Bearer token via `Authorization` header |
| **API key file** | `~/.lm-studio-env` (source with `source ~/.lm-studio-env`) |

### API Reference

#### List Available Models

```bash
curl -s http://192.168.0.13:1234/v1/models \
  -H "Authorization: Bearer $LM_STUDIO_API_KEY"
```

Returns all models installed on the server (loaded or not):

```json
{
  "data": [
    { "id": "qwopus3.6-27b-v2-mtp", "object": "model" },
    { "id": "qwen/qwen3.5-9b", "object": "model" }
  ]
}
```

#### Chat Completion

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

#### Embeddings

```bash
curl -s -X POST http://192.168.0.13:1234/v1/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $LM_STUDIO_API_KEY" \
  -d '{
    "model": "text-embedding-nomic-embed-text-v1.5",
    "input": "Text to embed"
  }'
```

### Provider Configuration

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
        "qwen/qwen3.5-9b": {
          "name": "Qwen 3.5 9B (local)"
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
    print(f'\"{m[\"id\"]}\": {{\"name\": \"{m[\"id\"]} (local)\"}},')"
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| `Model not found` | Model installed but not loaded in GPU | Open LM Studio, select and load the model |
| Connection refused | Server not running | Start LM Studio and enable the local inference server |
| Timeout | Model too large or GPU out of memory | Use a smaller model or reduce context length |
| Auth error | API key missing or wrong | Source `~/.lm-studio-env` or check key |
| VRAM exhausted | Too many models loaded or context too long | Unload unused models, reduce batch size |
| `max_tokens` exceeded | Response truncated | Increase `max_tokens` or reduce prompt |

### Model Lifecycle

LM Studio manages models through its UI, but models can also be referenced at runtime:

- **Load a model**: Open LM Studio → Server → Model Management → Select model → Load
- **Check loaded models**: `curl -s http://192.168.0.13:1234/v1/models` — models available for inference
- **Unload models**: Open LM Studio → Server → Model Management → Unload
- **Model not found error**: The model ID exists in the library but isn't loaded in GPU memory
