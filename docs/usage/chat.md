---
title: Chat User Guide
description: Complete guide to the Ingenium Chat interface — provider/model selection, session management, file attachments, and MCP monitoring.
---

# Ingenium Chat User Guide

Ingenium Chat is a standalone conversational AI interface that uses OpenCode's native chat API. It lives on the Dashboard at `/chat`, separated from the `/opencode` page which embeds OpenCode Web/CLI iframes.

## Quick Start

```bash
# Ensure at least one LLM provider is configured
open http://localhost:3000/chat
```

1. **Configure a provider** in Settings → Providers if none are set up. Once configured and OpenCode is restarted, the provider appears in the header selector.
2. **Select a provider, model, and agent** from the header dropdowns.
3. **Type a message** and press Enter to send.

## Provider / Model / Agent Selection

The ChatHeader at the top of the chat area contains three selectors (Provider, Model, Agent) plus an optional Variant selector for models that support multiple reasoning variants.

### Selector States

| State | Visual | When |
|-------|--------|------|
| **Normal** | Standard select with border, hover background, `cursor-pointer` | Providers available and chat config loaded |
| **Disabled (loading)** | `opacity-40 cursor-not-allowed` | Chat config API still loading |
| **Disabled (error)** | Same disabled style + red error banner | Chat config API failed |
| **Disabled (no providers)** | Same disabled style + blue info banner | No providers configured (links to Settings) |

When no providers are available, each selector shows a placeholder option:
- Provider: "No providers available"
- Model: "No models available"
- Agent: "No agents available"

### Free Model Badge

Providers with `source === "builtin"` display a **"(Free)"** badge next to their label. These are auto-discovered from the OpenCode Zen built-in provider (free tier, no API key required). The badge appears in both desktop and mobile selectors.

### Variant Selector

Some models expose variants (e.g., different reasoning efforts). When the selected model has a `variants` object, a fourth dropdown appears next to the Model selector showing the available variant keys.

### No-LLM-Guard

When the chat loads and detects that no LLM provider is configured:
1. A blue info banner appears: "No LLM configured. Go to Settings → Providers to configure."
2. All header selectors are disabled.
3. The composer's send button is disabled (even with text entered).
4. Pressing Enter does nothing.
5. The footer still shows "OpenCode Chat."

Once a provider is saved and OpenCode is restarted, the page becomes fully functional.

## Session Management

The left sidebar lists all chat sessions. Sessions are loaded from OpenCode via the `useOpenCodeSessions` hook.

| Action | How |
|--------|-----|
| **Create** | Click the "+" button or "New conversation" at the top of the sidebar |
| **Select** | Click a session title in the sidebar |
| **Rename** | Double-click the title in the ChatHeader and type a new name (Enter to save, Escape to cancel) |
| **Delete** | Hover over a session in the sidebar and click the trash icon |
| **Fork** | Click the fork button in the header; duplicates the session from the last assistant message |
| **Share** | Click the share button to generate a shareable link and copy it to clipboard. Share state auto-resets after 5 seconds. |
| **Compact** | Click the compact button to summarize the conversation via the selected model. Compact state auto-resets after 5 seconds. |

### Mobile Responsiveness

On screens narrower than 1280px, the sidebar auto-collapses. On mobile (<768px), the sidebar becomes an overlay drawer triggered by a hamburger button in the header.

## Composer

The composer bar sits at the bottom of the chat area with a `rounded-2xl` border.

### Features

| Feature | Description |
|---------|-------------|
| **Textarea** | Auto-growing (single line to max 200px). Enter to send, Shift+Enter for newline. |
| **Instructions** | Toggle (gear icon) opens a system prompt textarea above the composer. |
| **Attachments** | Paperclip button opens a file picker (max 5 files, 10MB each). Also supports drag-and-drop. Text files show code-block previews; images show inline thumbnails; binary files show download links. |
| **Send/Stop** | Arrow icon to send (text required); square icon to stop generation (when streaming). |

### Attachments

| Type | Preview |
|------|---------|
| Image | Inline thumbnail (click to expand full-size) |
| Text/code | Rendered as a code block with filename header and size |
| Other | Download link with filename and size |

Text file extensions accepted: `.txt .md .json .ts .tsx .js .jsx .py .rb .go .rs .java .cpp .c .h .hpp .css .scss .html .xml .yaml .yml .toml .ini .cfg .sh .bash .zsh .sql .graphql .vue .svelte .astro .pdf .csv`

Images are accepted by MIME type (`image/*`).

## Message Display

### User Messages
Right-aligned with `rounded-2xl` and a `--color-surface-selected` background.

### Assistant Messages
Left-aligned with **no card wrapper** — full-width text with relaxed leading. Includes:
- **Reasoning blocks**: Collapsible `<details>` element showing model reasoning content
- **Markdown content**: Rendered via ChatMarkdown component
- **File parts**: Rendered inline based on MIME type
- **Tool call cards**: Status cards for tool calls (pending, running, completed, failed). Failed cards show a revert button.

### Action Row
Each assistant message has an action row beneath it with:
- **Model attribution**: Shows `providerID/modelID` in muted text
- **Copy button**: Copies message content to clipboard (brief checkmark on success)
- **Retry button**: Only on the last assistant message when not streaming

## Permission Prompts

When an agent requests permission (e.g., to access a file or run a command), a PermissionPrompt card appears inline in the message list. Options: "Allow once", "Always allow", or "Deny".

## MCP Drawer

The MCP drawer (triggered by the server icon button in the header) shows connected MCP servers with their connection status and tool counts. Each server has a connect/disconnect toggle.

## API

The chat page fetches configuration from `GET /api/v1/settings/chat-config`. This endpoint returns:
- Sanitized provider list (no API keys)
- Models per provider
- Available agents
- Default selection
- Restart-required flag
- Backend capabilities flag

Messages are sent through OpenCode's native session `send()` API with the selected provider/model/agent.
