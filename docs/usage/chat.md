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

1. **Configure a provider** in Settings → Providers if none are set up. Once saved, the provider appears in the header selector through OpenCode's live configuration reload; no restart is required.
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

Once a provider is saved, the page becomes fully functional through OpenCode's live configuration reload; no restart is required.

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
- **Live provider-emitted reasoning**: OpenCode v1.18.3 first identifies a part through `message.part.updated` (`part.type: "reasoning"`), then sends its text through `message.part.delta` with `field: "text"`. Chat uses that authoritative part ID/type mapping, so reasoning remains separate from the user-facing answer. It is displayed as escaped plain text in an open disclosure while streaming, then becomes user-toggleable as "Reasoning" after the terminal event. The display is not generated by the dashboard and is not mixed into Markdown content or copy.
- **Markdown content**: Rendered via ChatMarkdown component in plain flow. Chat-only callouts, quotes, code blocks, and tables do not add card, border, or background-bubble chrome; Docs callouts are unchanged.
- **File parts**: Rendered inline based on MIME type without attachment cards, borders, or background bubbles.
- **Tool-call traces**: Compact OpenCode-style rows showing a human-friendly tool label and a short argument summary. **Web Search is the sole interactive trace**: its keyboard-accessible row opens the **Activity** drawer for the selected assistant message rather than expanding details inline. The drawer shows the provider's chronological reasoning, response text, and tool activity; Web Search entries may include the query and only concrete, validated `http`/`https` URLs, grouped as **Visited**, **Results**, or **Sites**. A URL is **Visited** only when it is in an explicit `visited`/`crawled` collection or its own object has an exact positive visitation flag; status fields, unrelated sibling fields, and names such as `unvisited` do not imply visitation. Query text is never converted into a fabricated URL or title; provider result titles and arbitrary payload fields are not rendered. Opened links use a new tab with `noopener noreferrer`. All other tools remain non-interactive compact traces; traces do not expand into payloads or expose execution status, duration, output, or error details. A separate revert affordance may appear for failed calls.

All LLM and agent output in Chat uses this borderless, background-free plain-flow treatment. User messages intentionally retain their distinct right-aligned selected-surface bubble.

### Activity Status Indicator
Before actual provider reasoning or answer text arrives, Chat shows only a muted inline status and dot—never a loading pill or card. Live reasoning replaces that interim status immediately. If an assistant part has not yet received reasoning, the same borderless status can describe its current phase:
| Phase | Label | When |
|-------|-------|------|
| **Connecting** | "Connecting…" | Establishing session connection |
| **Thinking** | "Thinking…" | Model reasoning phase (coincides with auto-expanded reasoning block) |
| **Using tools** | "Using tools…" | Tool execution phase (coincides with tool call cards) |
| **Writing response** | "Writing response…" | Response generation phase |
| **Reconnecting** | "Reconnecting…" | Reconnecting after disconnect |

The status is derived from the `streamActivity` prop and maps via `data-testid="chat-activity-status"` with `role="status"` for accessibility. Stream errors use the same inline treatment.

### Activity Drawer

Web Search tool rows open the **Activity** drawer for the selected assistant
message. The drawer presents a chronological, live-updating timeline containing
provider reasoning, response text, and tool activity. Tool entries may include
the query and validated `http`/`https` sites grouped as **Visited**, **Results**,
or **Sites**; it does not expose arbitrary provider payloads. The Web Search row
does not render those details inline.

The drawer is a modal dialog. It traps `Tab` focus, moves focus to its close
button when opened, restores the previously focused element when closed, and
closes with the close button, backdrop, or `Escape`. It disables body scrolling
while open and uses a full-width panel on small screens and a 400px panel on
larger screens. Reduced-motion preferences disable its entrance animation.

### Action Row
Each assistant message has an action row beneath it with:
- **Model attribution**: Shows `providerID/modelID` in muted text
- **Copy button**: Copies only the user-facing answer content to the clipboard, excluding provider reasoning (brief checkmark on success)
- **Retry button**: Only on the last assistant message when not streaming

## Agent Prompts

When an agent requests permission (e.g., to access a file or run a command), its action, command, and choices appear as borderless inline flow in the message list. Options: "Allow once", "Always allow", or "Deny".

When an agent asks a structured question, the question and its radio/checkbox options also appear as borderless inline flow. Select the requested options and choose **Submit Answer**; text-only questions are answered in the composer below.

## MCP Drawer

The MCP drawer (triggered by the server icon button in the header) shows MCP
servers with normalized connection status and tool counts. The API endpoint is
`GET /api/v1/opencode/mcp`; successful responses are returned under `data`.
The dashboard accepts these status values:

| Status | Meaning | Connected |
|--------|---------|-----------|
| `connected` | The server is connected | Yes |
| `disabled` | The server is disabled | No |
| `failed` | The server failed to connect | No |
| `needs_auth` | Authentication is required | No |
| `needs_client_registration` | Client registration is required | No |
| `unknown` | The upstream status was unrecognized or malformed | No |

The legacy boolean `connected` field remains available for compatibility, but
the normalized `status` field is authoritative. Fixed browser-safe messages are
used for error states; upstream diagnostics are not exposed. An invalid root
response produces `502 MCP_STATUS_INVALID` rather than an empty server list.
Each server has a connect/disconnect toggle and the drawer provides refresh and
retry feedback when status loading fails. Connect and disconnect success is the
fixed `{ data: { accepted: true } }` DTO; raw upstream mutation bodies are never
returned to the browser.

## API

The chat page fetches configuration from `GET /api/v1/opencode/chat-config`. This endpoint returns:
- Allowlisted provider/model metadata (no API keys, endpoints, base URLs,
  headers, packages, or internal topology)
- Models per provider
- Available agents
- Default selection
- Configured state plus sanitized primary/backup provider metadata

If catalog discovery fails, the endpoint returns a fixed `503` error: recognized
OpenCode network-startup failures use `OPENCODE_UNAVAILABLE` with
`OpenCode is starting up. Provider list will be available shortly.`; other
catalog failures use `LLM_CATALOG_UNAVAILABLE` with `The Chat model catalog is
temporarily unavailable. Try again later.` Neither response exposes an
upstream endpoint, transport diagnostic, or provider credential.

When a user changes provider or model, Chat sends the exact pair only to the
authenticated `PUT /api/v1/opencode/chat-selection` endpoint. The server
validates it against the active global catalog before persisting the non-secret
global selection. Browser localStorage is not a provider/model authority, and
Docs AI never receives provider/model IDs from the browser.

The dashboard opens the session SSE stream before sending a prompt. The prompt
request returns HTTP `202` with `{ data: { accepted: true } }` as soon as the
provider turn is accepted; it does not contain the assistant response. Chat
uses the per-session SSE stream as the authoritative response channel, reading
message-part deltas for live content and ending the turn on `session.idle` or
`session.error`. The dashboard serves this through its dedicated
`/api/v1/opencode/sessions/:id/events` Node route, which forwards the upstream
readable stream directly with `Cache-Control: no-cache, no-transform` and
`X-Accel-Buffering: no`. It must not be handled by the generic compressed Next
rewrite: that path can buffer or transform the persistent connection, delaying
incremental frames until the stream closes. The messages endpoint is used only
for history and best-effort reconciliation.
