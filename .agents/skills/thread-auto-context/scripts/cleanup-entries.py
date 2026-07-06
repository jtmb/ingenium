#!/usr/bin/env python3
"""
Batch-delete Thread entries matching a given tag.

Use this when you need to remove stale entries (e.g., after re-importing
docs with a better fetch method). Scans the entire session via cursor
pagination, deletes in sequence.

Usage:
    THREAD_API_TOKEN=your_token_here python3 cleanup-entries.py

Configuration (edit the variables below before running):
    SESSION    — Thread session name
    TARGET_TAG — Only entries with this tag will be deleted
    BASE_URL   — Thread server URL
    LIMIT      — Entries per page (max 200)
    SLEEP_MS   — Delay between deletes (ms)
"""

import logging
import os
import sys
import time

import requests

# ─── CONFIGURE THESE ─────────────────────────────────────────────────────────
SESSION = "gh-llm-bootstrap"
TARGET_TAG = "docker-ai-all.md"
BASE_URL = "http://localhost:5000"
LIMIT = 200
SLEEP_MS = 50
# ─────────────────────────────────────────────────────────────────────────────

TOKEN = os.environ.get("THREAD_API_TOKEN") or os.environ.get("THREAD_TOKEN")
if not TOKEN:
    print("FATAL: Set THREAD_API_TOKEN environment variable")
    sys.exit(1)

headers = {
    "Accept": "application/json",
    "Authorization": f"Bearer {TOKEN}",
}


def url(path):
    return f"{BASE_URL}{path}"


def delete_entry(eid):
    resp = requests.delete(
        url(f"/api/v1/sessions/{SESSION}/entries/{eid}"),
        headers=headers,
        timeout=10,
    )
    if resp.status_code == 204:
        return True
    if resp.status_code == 404:
        return False
    print(f"  WARN: delete {eid} returned {resp.status_code}")
    return False


def read_entries(limit=200, after=None):
    params = {"limit": limit, "sort": "asc"}
    if after is not None:
        params["after"] = after
    resp = requests.get(
        url(f"/api/v1/sessions/{SESSION}/entries"),
        params=params,
        headers=headers,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("data", [])


def main():
    total_found = 0
    total_deleted = 0
    cursor = None
    batch_num = 0

    print(f"Scanning session '{SESSION}' for entries tagged '{TARGET_TAG}' ...")

    while True:
        batch_num += 1
        entries = read_entries(limit=LIMIT, after=cursor)
        if not entries:
            break

        batch_ids = [e["id"] for e in entries if TARGET_TAG in e.get("tags", [])]
        total_found += len(batch_ids)

        if batch_ids:
            print(
                f"  Batch {batch_num}: found {len(batch_ids)} entries "
                f"(IDs {batch_ids[0]}-{batch_ids[-1]})"
            )
            for eid in batch_ids:
                if delete_entry(eid):
                    total_deleted += 1
                time.sleep(SLEEP_MS / 1000)
            print(f"    Deleted {len(batch_ids)} entries")
        else:
            print(f"  Batch {batch_num}: 0 entries (cursor at ID {entries[-1]['id']})")

        cursor = entries[-1]["id"]

    print(f"\nDone. Found: {total_found}, Deleted: {total_deleted}")


if __name__ == "__main__":
    main()
