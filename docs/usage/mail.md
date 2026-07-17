---
title: Mail
description: Using the Ingenium email client — reading, composing, searching, and managing emails with AI-powered features.
---

# Usage: Mail

## Overview

The email client provides Gmail REST API inbox viewing via thin `fetch()` client, email composition through SMTP (nodemailer), MIME parsing, and search functionality.

## Cache-First Architecture

The email client uses a **cache-first** pattern to ensure the UI never blocks on live API calls:

- **GET emails always serves from cache** — returns immediately from SQLite cache, triggers background stale refresh
- **Cache miss = instant return + background fetch** — UI never waits on the Gmail API
- **Body caching** — When an email is opened for reading, the body is fetched and cached
- **Freshness gate** — Uses durable DB `last_synced_at` timestamp to skip recently synced folders

## Viewing Inbox

The inbox displays in a 3-pane layout:
1. **Left sidebar** — account dropdown, compose button, and folder list (INBOX, Sent, Drafts, Archive, Spam, Trash)
2. **Middle pane** — email list with subject, sender, date preview (resizable handle)
3. **Right pane** — full message content when an email is selected, with a responsive reply panel

## Composing Messages

1. Click "Compose" button in the left sidebar
2. The **From** dropdown auto-selects the currently selected account
3. Fill in To, CC/BCC (optional), Subject, and Message body
4. Click "Send" — uses SMTP via nodemailer
5. Click "Save Draft" to save without sending

### Rich Text Formatting

The email composer uses a **TipTap-based rich text editor** with bold, italic, underline, font family, font size, text color, alignment, lists, blockquote, and clear formatting.

### Reply, Draft, and Forward

- **Reply** and **Draft (from smart-reply suggestion)** — Open an embedded inline compose box at the bottom of the reading pane
- **Forward** and **Compose New** — Use the full-screen modal overlay

### Review with AI

A **"Review with AI"** button appears below the message textarea. Clicking it sends your draft to the configured Synthesis LLM for tone, grammar, and clarity suggestions.

## Account Hiding

The FolderSidebar allows you to **hide** accounts from the left sidebar while keeping them active. This is useful when you have multiple accounts but only need a few visible day-to-day.

- **Hidden accounts continue syncing** — hiding an account only removes it from the sidebar UI. Background sync, smart replies, and IMAP IDLE watchers continue normally.
- **Show/hide an account**: Click the eye icon (👁) next to the account name in the FolderSidebar, or right-click the account name and select "Hide account" / "Show account".
- **Collapsed "Hidden accounts" section**: When at least one account is hidden, a collapsed **"Hidden accounts"** section appears at the bottom of the FolderSidebar. Click to expand and view/manage hidden accounts.

## Reconnect Button

When an account requires re-authentication (e.g., after an encryption key rotation or expired OAuth token), the account status changes to `error` and a **Reconnect** button appears in two places:

1. **FolderSidebar** — A small warning icon (⚠) appears next to the account name. Click it to see the Reconnect button.
2. **Account settings** — Under **Settings → Mail**, the affected account shows a "Reconnect" label with a clickable button.

Clicking **Reconnect** initiates the OAuth2 flow again, allowing you to re-authorize the account without removing and re-adding it.

## Searching Emails

The search bar supports FTS5-style queries:

```bash
# Search by subject (case-insensitive)
subject:invoice 2026

# Search by sender  
from:jane@example.com

# Search in email body
body:budget review meeting

# Combine multiple terms
budget AND invoice NOT cancelled
```

## Smart Reply Learning

The email client can learn your response style and draft 3 reply options when you reply to emails. When you click Reply, the compact inline composer mounts, auto-fetches suggestions, and renders them as pill/chip buttons below the message textarea.

### Configuration

Three settings control smart reply behavior, available in **Settings → Mail**:

| Setting Key | Default | Purpose |
|-------------|---------|---------|
| `mail_smart_replies_enabled` | `true` | Master toggle |
| `mail_smart_replies_mode` | `auto` | Automatic or manual mode |
| `mail_smart_replies_prefetch` | `false` | Pre-generate in background |

### Summarize This Email

A **"Summarize this email"** button appears near the top of every email reading pane. Click to get a concise 2-3 sentence summary of the email's key points.

## MCP Tools

The email client registers 27 MCP tools spanning account management, email operations, AI features, and IMAP monitoring: `ingenium_email_list`, `ingenium_email_search`, `ingenium_email_read`, `ingenium_email_send`, `ingenium_email_draft`, `ingenium_email_draft_response`, `ingenium_email_folders`, `ingenium_email_accounts`, `ingenium_email_account_create`, `ingenium_email_account_delete`, `ingenium_email_account_test`, `ingenium_email_attachment_get`, `ingenium_email_delete`, `ingenium_email_move`, `ingenium_email_oauth_exchange`, `ingenium_email_oauth_url`, `ingenium_email_patterns`, `ingenium_email_review_draft`, `ingenium_email_set_flags`, `ingenium_email_suggest`, `ingenium_email_summarize`, `ingenium_email_sync`, `ingenium_email_sync_status`, `ingenium_email_triage`, `ingenium_email_watch_start`, `ingenium_email_watch_status`, `ingenium_email_watch_stop`.

## Related Docs
- [Email Setup](../configure/email-setup.md) — Account setup and OAuth2 configuration
- [Synthesis Configuration](../configure/synthesis.md) — LLM configuration for smart replies
