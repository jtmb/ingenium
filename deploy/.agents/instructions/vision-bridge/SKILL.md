---
name: vision-bridge
description: "🔴 ALWAYS-LOADED — Bridge blind models to google/gemma-4-12b-qat vision model via LM Studio API. ONE CANONICAL APPROACH: takes a PNG file path, reads it, base64 encodes it, POSTs to http://192.168.0.13:1234/v1/chat/completions with Bearer token from .agents/.lm-studio-env. NEVER uses Playwright, NEVER opens a browser, NEVER captures a screenshot — just reads an existing file and calls the API. Auto-triggers on: model says 'Can't view screenshots', view_image fails, user says 'look at this', any tool produced an image file."
---

# Vision Bridge — Blind Model → Vision Model

**🔴 THIS IS THE ONLY VISION BRIDGE. DO NOT INVENT ANOTHER METHOD.**

## What This Is

You cannot see images. When a task requires understanding a screenshot or image, you call the LM Studio vision API to describe it for you. The API takes a PNG file, returns a text description. **Period.**

## 🔴 THE ONLY ALLOWED APPROACH — ONE SCRIPT

**There is ONE canonical script. It takes a PNG file path as argument. It reads the file, base64 encodes it, POSTs to LM Studio, prints the description. That's it.**

**The vision call NEVER:**
- Uses Playwright (Playwright is for CAPTURING screenshots, not for vision API calls)
- Opens a browser
- Navigates to a URL
- Interacts with a web page
- Captures a screenshot (the screenshot is captured BEFORE this script runs, by a different tool)

## 🔴 Workflow — Follow These Steps EXACTLY

### Step 1: Get a PNG file path

The image file comes from ONE of these sources:

| Source | How you get the path |
|--------|---------------------|
| `view_image` just failed on a file | Use the same file path you fed to `view_image` |
| `playwright-mcp` / `chrome-devtools` produced a screenshot | Use the path from their tool output |
| User says "look at this screenshot" | Ask which file (or if there's no file, see Step 1b below) |
| User attached an image | Use the attachment file path |

**🔴 DO NOT** try to capture a screenshot yourself using Playwright if no file path exists yet. That's outside this bridge's scope.

### Step 1b: No file path? Create one first with Playwright

If no screenshot file exists yet and you need one, use `run_playwright_code` with `page.screenshot({type: 'png', fullPage: true})` to produce a PNG file. Then note its path and proceed to Step 2.

**🔴 IMPORTANT**: Playwright is ONLY used here to PRODUCE the PNG file. The vision API call in Step 2 NEVER involves Playwright. These are two separate steps.

### Step 2: Call the vision API with the existing PNG file

Run this command. **Edit the `/path/to/screenshot.png` to match your actual file.** Do NOT use base64 inline in the terminal command — use Python which handles large payloads correctly.

```bash
python3 /home/brajam/repos/gh-llm-bootstrap/.agents/instructions/vision-bridge/vision_call.py /path/to/screenshot.png
```

**🔴 Wait for the output. It will print the description to stdout.** Do not do anything else until this command completes.

### Step 3: Use the description

The script prints the vision model's description. Read it carefully. Use it to continue your task.

## 🔴 The Script (already saved on disk — do not re-create)

**This script is already saved at `/home/brajam/repos/gh-llm-bootstrap/.agents/instructions/vision-bridge/vision_call.py`.** You do NOT need to create it. Just call it.

```python
#!/usr/bin/env python3
"""vision_call.py — Take a PNG file path, call LM Studio vision API, print description.

Usage: python3 vision_call.py /path/to/screenshot.png
"""
import json, urllib.request, base64, os, sys

# --- Config ---
API_URL = "http://192.168.0.13:1234/v1/chat/completions"
MODEL = "google/gemma-4-12b-qat"
ENV_PATH = os.path.expanduser("~/repos/gh-llm-bootstrap/.agents/.lm-studio-env")

# --- Load API key ---
if not os.path.exists(ENV_PATH):
    print("ERROR: API key file not found. Use vscode_askQuestions to prompt user for key.")
    sys.exit(1)
with open(ENV_PATH) as f:
    api_key = None
    for line in f:
        if line.startswith("LM_STUDIO_API_KEY"):
            api_key = line.split("=", 1)[1].strip()
if not api_key:
    print("ERROR: API key variable not found in env file.")
    sys.exit(1)

# --- Read PNG from argument ---
if len(sys.argv) < 2:
    print("ERROR: Usage: vision_call.py <path/to/screenshot.png>")
    sys.exit(1)
img_path = sys.argv[1]
if not os.path.exists(img_path):
    print(f"ERROR: File not found: {img_path}")
    sys.exit(1)
with open(img_path, "rb") as f:
    b64_data = base64.b64encode(f.read()).decode("utf-8")

# --- Call API ---
payload = {
    "model": MODEL,
    "messages": [{
        "role": "user",
        "content": [
            {"type": "text", "text": "Describe this screenshot in detail: layout, colors, text content, visible elements, and any interactive elements."},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64_data}"}}
        ]
    }],
    "max_tokens": 1000
}
req = urllib.request.Request(
    API_URL,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"}
)
try:
    with urllib.request.urlopen(req, timeout=180) as resp:
        result = json.loads(resp.read())
        description = result["choices"][0]["message"]["content"]
        print(description)
except urllib.error.URLError as e:
    print(f"ERROR: API call failed: {e.reason}. LM Studio may not be running.")
    sys.exit(1)
```

## 🔴 API Key Not Found — Prompt the User

If `.agents/.lm-studio-env` does not exist (first run, new clone, or key rotation):

1. Use `vscode_askQuestions` to ask the user for their LM Studio API key.
   - Header: `"api-key"`
   - Question: `"Enter your LM Studio API key (e.g., sk-lm-...). It will be saved to .agents/.lm-studio-env for future use."`
   - Do NOT offer options.
2. Save the key:
   ```bash
   mkdir -p /home/brajam/repos/gh-llm-bootstrap/.agents
   cat > /home/brajam/repos/gh-llm-bootstrap/.agents/.lm-studio-env << 'EOF'
LM_STUDIO_API_KEY=sk-lm-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
EOF
   chmod 600 /home/brajam/repos/gh-llm-bootstrap/.agents/.lm-studio-env
   ```
   (Replace with the actual key.)
3. Verify: `source /home/brajam/repos/gh-llm-bootstrap/.agents/.lm-studio-env && echo "$LM_STUDIO_API_KEY" | head -c 10`
4. Proceed to Step 2 above.

## 🔴 When to Trigger

| Priority | Trigger | Action |
|----------|---------|--------|
| **P0** | You say "Can't view screenshots" / view_image fails | Bridge immediately |
| **P0** | User says "look at this" / attaches an image | Bridge immediately |
| **P1** | Any tool produced a screenshot file path | Bridge to read the file |

**When triggered, do NOT:**
- Reason about image contents
- Ask user to describe
- Continue without visual data
- **Use Playwright for the API call**
- **Invent a different method**

## States

| State | What happens |
|-------|-------------|
| **Monitoring** | No trigger yet |
| **Triggered** | P0/P1 fired |
| **Getting PNG** | If no file exists, use Playwright or find the file |
| **Calling API** | `python3 vision_call.py /path/to/file.png` |
| **Processing** | Description received, extracting answers |
| **Complete** | Continuing original task |

## 🔴 HARD RULES

1. **One script, one method.** Use `vision_call.py` with a file path argument. Do not invent another approach.
2. **Never use Playwright for the vision API call.** A browser is NOT needed to POST to an HTTP endpoint.
3. **Never guess image contents.** If you can't see it, bridge it.
4. **Never stop and wait for the user.** Call the API directly.
5. **Accept vision model output as ground truth for visual facts.**
6. **If API key file missing**, use `vscode_askQuestions` to prompt the user.
7. **If API returns error**, tell user LM Studio may not be running.
