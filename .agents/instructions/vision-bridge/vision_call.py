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
