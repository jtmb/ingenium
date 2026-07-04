---
name: vision-bridge
description: "🔴 ALWAYS-LOADED — Bridge blind models to google/gemma-4-12b-qat vision model. ONE COMMAND: python3 /home/brajam/repos/gh-llm-bootstrap/.agents/instructions/vision-bridge/vision_call.py <png-path>. That is the ONLY method. No Playwright. No browser. No base64 inline. Just run that command with a PNG file path."
---

# 🔴 Vision Bridge — EXACT ONE-SHOT PROCEDURE

## The Problem
You are blind — you cannot see images. But there is a vision model running at `http://192.168.0.13:1234` that CAN see them. This skill bridges that gap.

## 🔴 THE ONE AND ONLY METHOD

A Python script already exists at this absolute path:
```
/home/brajam/repos/gh-llm-bootstrap/.agents/instructions/vision-bridge/vision_call.py
```

**To use it, run this exact command (substitute the PNG path):**
```bash
python3 /home/brajam/repos/gh-llm-bootstrap/.agents/instructions/vision-bridge/vision_call.py /path/to/file.png
```

**The script:**
1. Reads `LM_STUDIO_API_KEY` from `.agents/.lm-studio-env`
2. Reads the PNG file, base64 encodes it
3. POSTs to `http://192.168.0.13:1234/v1/chat/completions` with model `google/gemma-4-12b-qat`
4. Prints the vision model's description to stdout

**You:** Wait for the output. Read the description. Continue your task.

## 🔴 DO NOT

- **Do NOT use Playwright.** The script does NOT need a browser. It reads a FILE and calls an API. No Playwright, no browser, no page.
- **Do NOT capture a screenshot.** The PNG file should already exist. If you don't have one, find another way or tell the user.
- **Do NOT inline base64.** Do NOT use curl. Do NOT write your own Python. The script on disk handles everything.
- **Do NOT reason about image contents.** You can't see it. Use the bridge.
- **Do NOT ask the user to describe it.** Use the bridge.

## 🔴 IF THE API KEY FILE IS MISSING

The env file is at `~/repos/gh-llm-bootstrap/.agents/.lm-studio-env`. If it doesn't exist:

1. Use `vscode_askQuestions` — header `"api-key"`, question `"Enter your LM Studio API key (e.g., sk-lm-...). Saved to .agents/.lm-studio-env."`, no options.
2. Save their answer:
   ```bash
   mkdir -p ~/repos/gh-llm-bootstrap/.agents && echo "LM_STUDIO_API_KEY=sk-lm-xxxxx" > ~/repos/gh-llm-bootstrap/.agents/.lm-studio-env && chmod 600 ~/repos/gh-llm-bootstrap/.agents/.lm-studio-env
   ```
3. Run `source ~/repos/gh-llm-bootstrap/.agents/.lm-studio-env && echo "$LM_STUDIO_API_KEY" | head -c 10` to verify.
4. Then run `vision_call.py` above.

## 🔴 ERROR HANDLING

| Script says | What to do |
|-------------|-----------|
| `API key file not found` | Run the key-prompt steps above |
| `File not found: /path/...` | The PNG path is wrong — use the correct absolute path |
| `API call failed: ...` | Tell user LM Studio may not be running on 192.168.0.13:1234 |

## 🔴 HARD RULES

1. **ONE METHOD ONLY.** The command above. Nothing else.
2. **NO PLAYWRIGHT.** The vision API call does not use a browser or Playwright.
3. **NO BASE64 INLINE.** Use the script on disk.
4. **NO GUESSING.** If you can't see it, bridge it.
5. **NO STOPPING.** If the command succeeds, use the description and continue.
6. **NO ASKING THE USER.** Don't ask user to describe images. Use the bridge.
