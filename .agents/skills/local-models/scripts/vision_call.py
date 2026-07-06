#!/usr/bin/env python3
"""Vision bridge — sends an image to LM Studio for analysis via the vision model."""

import base64
import json
import os
import sys
import urllib.request

ENV_PATH = os.path.expanduser("~/.lm-studio-env")
SERVER_URL = "http://192.168.0.13:1234/v1/chat/completions"

def main():
    if len(sys.argv) < 2:
        print("Usage: vision_call.py <image_path>")
        sys.exit(1)

    image_path = sys.argv[1]
    if not os.path.exists(image_path):
        print(f"ERROR: Image not found: {image_path}")
        sys.exit(1)

    # Load API key
    api_key = os.environ.get("LM_STUDIO_API_KEY")
    if not api_key and os.path.exists(ENV_PATH):
        with open(ENV_PATH) as f:
            for line in f:
                if line.startswith("LM_STUDIO_API_KEY="):
                    api_key = line.strip().split("=", 1)[1]
                    break

    if not api_key:
        print("ERROR: API key not found. Set LM_STUDIO_API_KEY or source ~/.lm-studio-env")
        sys.exit(1)

    # Read and encode image
    with open(image_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("utf-8")

    # Build request
    payload = {
        "model": os.environ.get("VISION_MODEL", "google/gemma-4-12b-qat"),
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Describe this screenshot in detail: layout, colors, text content, visible elements, interactive elements."
                    },
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:image/png;base64,{b64}"}
                    }
                ]
            }
        ],
        "max_tokens": 1000
    }

    req = urllib.request.Request(
        SERVER_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            print(result["choices"][0]["message"]["content"])
    except Exception as e:
        print(f"ERROR: Vision call failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
