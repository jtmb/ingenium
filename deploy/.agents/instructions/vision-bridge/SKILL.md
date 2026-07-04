---
name: vision-bridge
description: "🔴 ALWAYS-LOADED — Bridge blind models to google/gemma-4-12b-qat vision model. ONE CURL COMMAND: source .lm-studio-env, write JSON with base64 to temp file, curl -d @file. No Playwright. No browser. Just a file path."
---

# 🔴 Vision Bridge — EXACTLY ONE CURL COMMAND

## The problem
You are blind but a vision model runs at `http://192.168.0.13:1234`. You have a PNG file path (from a failed `view_image`, a Playwright screenshot, or the user). **Run this exact command** — substitute the actual PNG path.

## 🔴 THE EXACT COMMAND (copy-paste, just change the path)

```bash
source ~/repos/gh-llm-bootstrap/.agents/.lm-studio-env && printf '{"model":"google/gemma-4-12b-qat","messages":[{"role":"user","content":[{"type":"text","text":"Describe this screenshot in detail: layout, colors, text content, visible elements, interactive elements."},{"type":"image_url","image_url":{"url":"data:image/png;base64,' > /tmp/vp.json && base64 -w0 /path/to/screenshot.png >> /tmp/vp.json && printf '"}}]}],"max_tokens":1000}' >> /tmp/vp.json && curl -s -X POST http://192.168.0.13:1234/v1/chat/completions -H "Content-Type: application/json" -H "Authorization: Bearer $LM_STUDIO_API_KEY" -d @/tmp/vp.json && rm -f /tmp/vp.json
```

**That's it.** The JSON payload goes to `/tmp/vp.json`, curl POSTs it, the temp file is deleted. The output is the vision model's description.

## 🔴 WHAT YOU DO

1. Look at your conversation. **Find the PNG file path** — from view_image failure, Playwright screenshot output, or user attachment.
2. **Replace `/path/to/screenshot.png`** in the command above with your actual path.
3. **Run the command.** Read the output. Continue your task.

## 🔴 RULES (violate = wrong answer)

- **DO NOT** use Playwright for the API call. The command above does NOT need a browser.
- **DO NOT** capture a screenshot. The file already exists.
- **DO NOT** extract base64 yourself. `base64 -w0` does it.
- **DO NOT** guess image contents. You're blind. Use the command.
- **DO NOT** ask user to describe the image. Use the command.

## 🔴 IF API KEY MISSING

`~/repos/gh-llm-bootstrap/.agents/.lm-studio-env` must exist with `LM_STUDIO_API_KEY=sk-lm-...`. If missing:

1. `vscode_askQuestions` header=`"api-key"` question=`"Enter LM Studio API key (sk-lm-...). Saved to .agents/.lm-studio-env."`
2. Save: `mkdir -p ~/repos/gh-llm-bootstrap/.agents && echo "LM_STUDIO_API_KEY=sk-lm-xxxxx" > ~/repos/gh-llm-bootstrap/.agents/.lm-studio-env && chmod 600 ~/repos/gh-llm-bootstrap/.agents/.lm-studio-env`
3. Verify: `source ~/repos/gh-llm-bootstrap/.agents/.lm-studio-env && echo "$LM_STUDIO_API_KEY" | head -c 10`
4. Run the curl command above.
