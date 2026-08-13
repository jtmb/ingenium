---
title: Chat User Guide
description: Complete guide to the Ingenium Chat interface — provider/model selection, session management, file attachments, and MCP monitoring.
---

# Ingenium Chat User Guide

Ingenium Chat is a standalone conversational AI interface that uses OpenCode's native chat API. It lives on the Dashboard at `/chat`, separated from the `/opencode` page which embeds OpenCode Web/CLI iframes.

Chat-owned tools use the API's authoritative active global project. The Chat
page resolves that project rather than trusting the selected dashboard project;
if no sole active global project can be resolved, Chat does not run its tool
configuration.

## Context project selector

On `/chat`, the top navigation **Context project** selector chooses the project
used by optional project-context retrieval. A selection is represented explicitly
as `?project=<name>` in the URL and is persisted for the next visit. The API
validates the URL or stored value against the current, non-archived project list
before mounting the Chat shell; an invalid, missing, or archived selection never
falls back to another project. URL query values are encoded with
`URLSearchParams`.

If the URL or stored selection is no longer valid, Chat fails closed with
**Project context unavailable** and mounts no project-scoped Chat content. Use
**Clear project selection and use server default** to remove the invalid URL and
stored values and retry resolution against the sole active global project.

This selector is separate from Chat's server-owned authority. The banner
**Chat tools run through global project** identifies the project used by Chat
tools, provider/model configuration, and other global Chat mutations. Changing
the Context project does not redirect those tools.

Immutable Context conversations created by authenticated users are private by
default. Their messages, checkpoints, restore branches, and cited restricted RAG
sources remain bound to the conversation owner. Organization/project-visible
conversation scope must be selected explicitly; foreign private IDs are returned
as not found and organization administrators do not implicitly read them.

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

On screens narrower than 1280px, the sidebar auto-collapses. On mobile (<768px), the sidebar becomes the shared left edge-drawer pattern, triggered by a hamburger button in the header. The panel translates from the edge and the backdrop fades using `240ms` with `cubic-bezier(0.22, 1, 0.36, 1)`. Closing retains the panel through its transform transition so a rapid reopen reverses the same mounted drawer instead of restarting from a removed panel. The session drawer is inert and `aria-hidden` while retained only for exit; its existing mobile focus behavior remains in place.

### Create a Task from Chat

With a loaded, idle conversation selected, choose **Create task** (the plus
button in the Chat header). The confirmation form asks for a **title only**;
it does not copy the transcript, session title, or other Chat content into the
task. Chat capture belongs to the active global Ingenium project; the server
also verifies the OpenCode source instance, upstream project, and mapped global
project. Unmapped, mismatched, or unavailable sessions cannot be captured.

The stored reference uses fixed metadata (`OpenCode chat`), not the upstream
session title or transcript. Repeating the same capture reuses the existing
task and reference. The controls are labeled, keyboard-usable, and at least
44px; the header control remains available in the mobile layout.

## Composer

The composer bar sits at the bottom of the chat area with a `rounded-2xl` border.

### Features

| Feature | Description |
|---------|-------------|
| **Textarea** | Auto-growing (single line to max 200px). Enter to send, Shift+Enter for newline. |
| **Instructions** | Toggle (gear icon) opens a system prompt textarea above the composer. |
| **Attachments** | Paperclip button opens a file picker (max 5 files, 10MB each). Also supports drag-and-drop. Text files show code-block previews; images show inline thumbnails; binary files show download links. |
| **Send/Stop** | Arrow icon to send (text required); square icon to stop generation (when streaming). |

### Optional Project Context

The **Use project context** checkbox is an explicit per-send control and is off
by default. After an accepted send, it resets to off. The selected project is
validated before Chat mounts and is the authority for this optional Context
search; Chat tools and provider/model selection remain owned by the active
global project.

The request binds the validated Context project to that send. Retrieval is sent
only when the checkbox is enabled; a failed search leaves the prompt unsent so
the user can retry. The API rechecks the project at request time, so an archive
race is rejected rather than serving another project's context. Context source
contents and excerpts are not written to logs.

When enabled, retrieval is bounded to at most 5 sources, the query is limited
to 512 characters, and provider-bound context is limited to 5,000 characters.
The provider receives excerpts as untrusted reference data inside delimiters;
they are never rendered in Chat. Chat displays the exact citation metadata only:
title, the persisted chunk UUID as `citationId`, `sourceId`, `sourceHash`,
`chunkIndex`, current `availability` (`available`), heading, provenance, and
optional source reference. It never renders the source excerpt.

If retrieval finds no matches, the original prompt is still sent without
grounding. If the search fails, Chat preserves the prompt and the checkbox so
you can retry. Citation metadata is live per-turn UI state and is not durable
across a reload. Stable citation reproducibility comes from CTX-101's immutable
chunk identity and deterministic retrieval order, not from persisted Chat UI
grounding metadata.

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
- **Live provider-emitted reasoning**: OpenCode v1.18.9 first identifies a part through `message.part.updated` (`part.type: "reasoning"`), then sends its text through `message.part.delta` with `field: "text"`. Chat uses that authoritative part ID/type mapping, so reasoning remains separate from the user-facing answer. It is displayed as escaped plain text in an open disclosure while streaming, then becomes user-toggleable as "Reasoning" after the terminal event. The display is not generated by the dashboard and is not mixed into Markdown content or copy.
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

The drawer is a right edge-mounted modal dialog using the shared edge-drawer
motion pattern: the panel transforms and the backdrop opacity changes over
`240ms` with `cubic-bezier(0.22, 1, 0.36, 1)`. Exit presence is retained until
the panel transform ends, so rapid reversal reopens the mounted panel. It traps
`Tab` focus, moves focus to its close button when opened, restores the
previously focused element when closed, and closes with the close button,
backdrop, or `Escape`. It disables body scrolling while open and uses a
full-width panel on small screens and a 400px panel on larger screens. A panel
retained only for exit is `aria-hidden` and inert. Reduced-motion preferences
disable the transition and close/open immediately.

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
returned to the browser. Opening the drawer refreshes its data automatically;
the footer's **Refresh** button performs a manual refresh and shows the last
refresh time alongside the current connection status.

MCP tool state is refreshed after connection mutations and when the MCP session
reconnects. If a direct built-in tool call is blocked, Chat shows fixed,
actionable errors (`TOOL_DISABLED`, `TOOL_STATE_UNAVAILABLE`, or
`PROJECT_IDENTITY_REQUIRED`) and links to **MCP Servers** when the project is
known. The statically registered extension tools are the exception: they remain
visible, but their execution is still project-state-gated and fails closed.

The MCP status panel is a right edge drawer using the same `240ms`
`cubic-bezier(0.22, 1, 0.36, 1)` panel-transform/backdrop-opacity contract as
the session and Activity drawers. It remains mounted through exit and reverses
cleanly if reopened during that transition. While open it traps `Tab`, focuses
the close button, closes on the close button, backdrop, or `Escape`, and
restores focus to the trigger on close. The exiting panel is `aria-hidden` and
inert; reduced motion removes the transition and applies state changes
immediately.

These edge drawers are distinct from Chat's inline desktop panes and from
centered modals, dropdowns, and disclosures, which do not use this motion
primitive.

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
