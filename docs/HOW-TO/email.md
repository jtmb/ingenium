# Email Client — How-To Guide

This document covers setting up and using the Ingenium email client with Gmail OAuth2 + REST API and SMTP support.

## Overview

The Ingenium email client provides:
- **OAuth2 authentication** for secure access to Gmail and Outlook accounts
- **Gmail REST API inbox viewing** via thin `fetch()` client
- **Email composition** through SMTP (nodemailer)
- **MIME parsing** for message content extraction
- **Search functionality** across email subjects, senders, and bodies

## Cache-First Architecture (Never-Block)

The email client uses a **cache-first** pattern to ensure the UI never blocks on live API calls:

### How It Works

1. **GET emails always serves from cache** — The API (`GET /api/v1/emails/list`) always checks the SQLite email cache first. If cached data exists, it returns immediately (source: `"cache"`) and triggers a background stale-cache refresh. The user sees data instantly.

2. **Cache miss = instant return + background fetch** — If the cache is empty (first request), the API returns immediately with whatever is available and fires a background sync. The UI **never waits** on the Gmail API.

3. **Body caching** — When an email is opened for reading, the body (HTML + text) is fetched from the Gmail API and cached via `emailCache.getCachedEmailBody()`. Subsequent reads return from cache with `source: "cache"`.

4. **Startup prefetch** — On API server start, `startEngine()` launches the sync engine workers for all connected accounts. Workers auto-discover folders and begin syncing with the freshness gate preventing full re-syncs.

5. **Freshness gate** — The sync engine uses the durable DB `last_synced_at` timestamp to skip folders synced within the `mail_sync_interval` window. This replaces the old ephemeral in-memory Set pattern.

### Why Cache-First?

- **The Gmail API is rate-limited** — 250 quota units/sec means we must be efficient
- **Delta sync is cheap** — `history.list()` with no changes returns instantly and costs ~1 unit, but full message fetches cost 5 units each
- **Multiple folders** — A single inbox view may need to cache INBOX, Sent, Drafts, etc.
- **Container restarts** — Supervisord autorestart clears in-memory state, but the SQLite cache persists across restarts

> **Note**: The cache is backed by the `email_cache` and `email_bodies` tables in the Ingenium SQLite database. It persists across container restarts. A "force refresh" parameter is available to bypass cache and re-fetch from the Gmail API.

### 🔴 Per-Folder Cache Invalidation

Since the Gmail API uses stable message IDs (hex strings, not IMAP UIDs), UIDVALIDITY-based invalidation no longer applies. Cache is cleared per-folder via `clearFolderCache(accountId, folder)` only when explicitly needed (e.g., account re-authentication or user-requested reset). Gmail's `history.list()` handles incremental updates — messages moved between labels are reflected in `labelsAdded`/`labelsRemoved` history entries without cache invalidation.

### 🔴 Folder List Caching

The folder list is mapped from Gmail labels via the API and cached per-account via the settings key `email_folders_<accountId>`. On first load, the list is fetched from the Gmail API and cached in settings. Subsequent loads serve from cache immediately while triggering a background refresh.

### 🔴 No In-Memory Prefetch Guard

The old `prefetchedAccounts` in-memory Set that gated background prefetch has been **removed**. It caused full resync storms on every API restart because the Set was always empty after a deploy. Replaced by the freshness gate which checks the durable DB `last_synced_at` timestamp — persists across restarts.

## Prerequisites

Before using the email client:

1. **OAuth2 Credentials**: Configure OAuth2 apps in Google Cloud Console or Azure AD
   - Gmail redirect URI: `http://localhost:3000/mail/oauth/callback`
   - Outlook (Azure) same callback URI

2. **Environment Variables** — Define these before starting the Docker container:
```bash
export GOOGLE_OAUTH_CLIENT_ID=your-google-oauth-client-id
export GOOGLE_OAUTH_CLIENT_SECRET=your-google-oauth-secret
export MS_OAUTH_CLIENT_ID=your-azure-ad-app-id  
export MS_OAUTH_CLIENT_SECRET=your-azure-ad-app-secret
export INGENIUM_EMAIL_ENCRYPTION_KEY=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0
export OAUTH_REDIRECT_URI=http://localhost:3000/mail/oauth/callback
```
These are passed through to `docker compose` via the `${VAR:-}` expansion in `docker-compose.yml`. See the OAuth2 Credential Setup section below for obtaining the client ID/secrets.

> 🔴 **Security**: Never commit these values. The encryption key must be exactly 32 bytes (64 hex chars). Generate a unique key per project — do not reuse across deployments.

## OAuth2 Credential Setup

### Google Cloud Console (Gmail)

1. Go to https://console.cloud.google.com/apis/credentials
2. If prompted, create a project or select an existing one
3. **Configure OAuth consent screen** (required before creating credentials):
   - User Type: **External** (or Internal if using Google Workspace)
   - Required fields: App name, User support email, Developer contact email
   - Scopes: Add `https://mail.google.com/` (sensitive scope — Google will require verification for production use)
   - Test users: Add your email address during development
4. **Create OAuth client ID** under "Credentials" → "+ Create Credentials" → "OAuth client ID":
   - Application type: **Web application**
   - Name: "Ingenium Email Client"
   - Authorized redirect URIs: Click "+ Add URI" → `http://localhost:3000/mail/oauth/callback`
   - Click "Create"
5. Copy the **Client ID** and **Client Secret** from the popup — set them as:
   ```
   GOOGLE_OAUTH_CLIENT_ID=<your-client-id>.apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=<your-client-secret>
   ```

> **Note:** The Gmail API must be enabled for your project. Go to "Enabled APIs & Services" → "+ Enable APIs and Services" → search "Gmail API" → Enable.

### Azure AD (Outlook / Microsoft 365)

1. Go to https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade
2. Click "+ New registration":
   - Name: "Ingenium Email Client"
   - Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** (covers @outlook.com, @hotmail.com, and work/school accounts)
   - Redirect URI: Select **Web** → `http://localhost:3000/mail/oauth/callback`
   - Click "Register"
3. Copy the **Application (client) ID** → set as `MS_OAUTH_CLIENT_ID`
4. Under "Certificates & secrets" → "+ New client secret":
   - Description: "Ingenium email client"
   - Expires: 24 months (or as needed)
   - Click "Add"
   - Copy the **Secret Value** immediately (it only shows once) → set as `MS_OAUTH_CLIENT_SECRET`
5. Under "API permissions" → "+ Add a permission" → "Microsoft Graph" → "Delegated permissions":
   - Add `IMAP.AccessAsUser.All`
   - Add `SMTP.Send`
   - Add `offline_access`
   - Click "Grant admin consent" if using a tenant with admin rights

## Account Setup (OAuth2 Flow)

Once you have obtained OAuth2 credentials (see section above), add an account:

1. Open http://localhost:3000/mail
2. Click **"Add Email Account"**
3. Select provider (Gmail / Outlook)
4. Complete OAuth2 flow:
   - Browser redirects to Google/Outlook login page
   - Sign in with your email account
   - Grant Ingenium permission to access emails
   - Redirects back to callback URL automatically

### Verify Account Setup

After successful authentication, you should see:
- Your email address listed under "My Accounts"
- Inbox view populated with recent messages
- Folder navigation showing standard IMAP folders (INBOX, Sent, Drafts)

## Using the Email Client

### Viewing Inbox

The inbox displays in a 3-pane layout:
1. **Left sidebar** — account dropdown, compose button, and folder list (INBOX, Sent, Drafts, Archive, Spam, Trash)
2. **Middle pane** — email list with subject, sender, date preview
3. **Right pane** — full message content when an email is selected, with a responsive reply panel

**Reply panel layout**: On widescreen (xl+) clicking Reply opens the composer alongside the email body in a side-by-side layout. On smaller screens the reply composer stacks below the email body. The mail container uses `100dvh` (dynamic viewport height) for better mobile support.

**Resizable EmailList**: The email list pane (middle pane) is resizable — a 2px draggable handle sits between the list and reader panes. Drag it horizontally (or use ArrowLeft/ArrowRight keys when focused) to resize. The width defaults to 350px, with bounds of 240px (min) and 720px (max). Width is persisted in `localStorage` under the key `mail-list-width` — it survives page refreshes and browser restarts.

**Dual Resize Handles**: Both the email list panel and the reply composer panel can be independently resized by dragging their separator handles or using ArrowLeft/ArrowRight keys while focused. Widths are stored in `localStorage` under `mail-list-width` and `mail-reply-width` respectively.

Click any email to view its complete headers and body in the right pane.

> **Note**: Re-clicking the already-open email no longer triggers a visible reload. A same-UID guard (`selectedEmail?.uid === uid` at `mail/page.tsx:202-203`) prevents redundant fetch + state reset when the user clicks the same email row again.

> 🔴 **Email-switch auto-clear**: When switching to a different email (clicking a different row), any open inline reply box and any displayed AI summary automatically clear. This is handled by a single `useEffect` at `EmailReader.tsx:86-96` that resets both `isReplying`/`replyPrefill` and all `summary`/`summariseLoading`/`summariseError`/`summariseConfigured` state on `email?.uid` change. The same-UID guard (above) ensures re-clicking the same email does NOT trigger the reset — only genuinely switching to a different email clears the state.

### Composing Messages

1. Click "Compose" button in the left sidebar
2. The compose dialog opens as an overlay modal with "New Message" header (this modal is unchanged for Compose New and Forward)
3. The **From** dropdown auto-selects the currently selected account in the sidebar (via `initialAccountId={selectedAccount}` passed from the mail page). Fill in To, CC/BCC (optional), Subject, and Message body.
4. Click "Send" — uses SMTP via nodemailer to deliver through Gmail/Outlook servers
5. Click "Save Draft" to save without sending, or "Discard" to cancel
6. **Review with AI** — A "Review with AI" button appears below the message textarea in both inline compose and modal compose. Clicking it sends your draft to the AI and shows an Original vs Improved comparison with Apply/Dismiss options. See "Review with AI" below for details.
7. **Full-screen compose** — The compose overlay uses the full available screen width and height, providing ample space for drafting long messages.

### Rich Text Formatting

The email composer uses a **TipTap-based rich text editor** (replacing the old `<textarea>`). A formatting toolbar provides these controls:

| Control | Function | Tips |
|---------|----------|------|
| Undo / Redo | Revert or reapply the last edit | Keyboard shortcuts: Ctrl+Z / Ctrl+Shift+Z |
| Font Family | Select font (e.g., Sans Serif, Serif, Monospace) | Applies to selected text |
| Font Size | Increase / decrease text size | Preset sizes for headings vs body |
| Bold / Italic / Underline | Standard text emphasis | Keyboard shortcuts: Ctrl+B / Ctrl+I / Ctrl+U |
| Text Color | Foreground color picker | Opens a compact color swatch panel |
| Alignment | Left, center, right, justify | Block-level alignment |
| Ordered / Unordered Lists | Numbered and bullet lists | Multi-level nesting supported |
| Indent / Outdent | Increase or decrease list/item indentation | Works on lists and blockquotes |
| Blockquote | Quote-style formatting for cited text | Renders with left border accent |
| Clear Formatting | Remove all inline formatting from selection | Resets to default body style |

**How it works:**
- Formatted emails send **both HTML and plain-text fallback**. The HTML carries all formatting; the plain-text alternative ensures compatibility with text-only mail clients.
- **SmartSuggest and AI Review text is safely inserted as text, not raw HTML.** When you click "Use this draft" on a suggestion card or "Apply" on an AI review, the content is inserted as plain text into the TipTap editor — it never bypasses the editor's sanitization layer. This prevents XSS vectors and formatting corruption from LLM-generated content.
- The toolbar is fully accessible with `role="toolbar"` and `aria-label` attributes. See the [Styling Guide](../services/ingenium-dashboard/STYLING-GUIDE.md#formatting-toolbar) for detailed component styling.

### Reply, Draft, Forward, and Compose New

Each email reader pane includes action buttons for quick responses. The compose mode determines the UI:

- **Reply** and **Draft (from smart-reply suggestion)** — Open an **embedded inline compose box** at the bottom of the reading pane (Gmail-inspired compact design), keeping the email visible while you compose. The **From** field auto-selects the account currently being viewed in the sidebar.
- **Forward** and **Compose New** — Use the full-screen modal overlay (`EmailComposer`), unchanged from previous behavior.

**Reply** — Located in the action bar below the email header. Opens the inline compose box prefilled with:
- **To**: The original sender's address (`selectedEmail.from[0].address`)
- **Subject**: Prefixed with `"Re: "` — the `buildReplySubject()` helper (`mail/page.tsx:272-273`) checks the original subject against `/^re:/i` before adding the prefix, so double `"Re: Re:"` never occurs (dedup-guarded)
- **Body**: Empty — compose your response from scratch

**Draft (from smart-reply suggestion)** — When you click Reply, the inline composer opens with the empty Reply prefill (To/Subject). A **"Smart Replies"** section appears alongside the composer, showing up to 3 suggestion cards — each displaying a tone badge, subject line, and body preview. Click **"Use this draft"** on a card to fill the composer's subject and body with that suggestion's content immediately. This lets you review, tweak, and send an AI-drafted reply without leaving the reading pane.

The Smart Replies section has 5 visible states: loading skeletons (pulsing card placeholders while fetching), error with retry button (on API failure), unconfigured with a settings link (when no Synthesis LLM is set up), noreply info (automated senders — section hidden), and 3 suggestion cards (normal state).

**Forward** — Located in the action bar. Opens the full modal overlay (`EmailComposer`) with the original message content prefilled.

**Compose New** — Click "Compose" in the left sidebar. Opens the full modal overlay (`EmailComposer`) with a blank message.

Both inline compose and modal overlay include the **"Review with AI"** button below the message textarea. In the inline compose box, the button appears above the Smart Replies section. See the Review with AI section below for details.

**Inline reply with smart suggestions**: When replying (Reply or Draft from suggestion), a labeled **"Smart Replies"** section appears alongside the composer with up to 3 readable cards. Each card shows a tone badge, full subject line, and body preview (with `line-clamp-4` truncation). Click **"Use this draft"** on a card to fill the composer's subject and body immediately. The section has 5 visible states: loading skeletons (three pulsing card placeholders), error with retry button, unconfigured with a settings link, noreply info (hidden by default), and the 3 suggestion cards. The composer passes `emailUid`, `accountId`, and `folder` directly from EmailReader — no defaulting of folder to `"INBOX"`.

Source reference: `handleReply` at `mail/page.tsx:279-287`, `handleDraft` at `mail/page.tsx:289-297`.

#### Smart Reply Cards UX

**Smart Replies collapsible**: Smart Replies are shown expanded by default and can be collapsed/expanded using the disclosure button next to the heading. The button uses `aria-expanded` for accessibility. Cards are hidden via conditional rendering when collapsed.

**Applying drafts**: Click anywhere on a Smart Reply card (or press Enter/Space while focused) to apply the draft to the composer — fills the subject and body fields immediately.

**Copy button**: Use the copy icon button on each card to copy the draft to clipboard without applying it to the composer.

### Review with AI

A **"Review with AI"** button appears below the message textarea (and above the Smart Replies section in inline compose) in both the inline compose box (Reply/Draft) and the full modal overlay (Compose New/Forward).

**How it works:**
1. Write your draft as usual
2. Click "Review with AI" — sends your draft to the configured Synthesis LLM for tone, grammar, and clarity suggestions
3. The response shows an **Original vs Improved** side-by-side comparison with highlighted changes
4. Click **Apply** to replace your draft body with the AI-improved version
5. Click **Dismiss** to discard the suggestion and keep your original draft

**Key details:**
- **Not cached** — Every review is on-demand since each draft is unique
- **Uses the Synthesis LLM** — Same model configured for smart replies (Settings → Synthesis LLM)
- **Independent of smart reply settings** — The Review with AI button is always visible and functional regardless of `mail_smart_replies_enabled` or noreply checks
- The comparison view stays open until you Apply or Dismiss — you can edit your draft further before re-reviewing

**🔴 Reasoning model compatibility (suggest-llm.ts line 288):**
- `max_tokens: 8192` ensures reasoning models (DeepSeek, Qwen, etc.) have enough budget to complete their thinking and output clean content
- `reasoning_content` is **NEVER surfaced to users** — only the `content` field from the LLM response is shown. The old `content || reasoning_content` fallback pattern (which leaked the model's internal scratchpad to users) was removed. If `content` is empty after the model's thinking completes, an empty string is returned — the thinking trace is never exposed.
- Accurate as of: `packages/ingenium-email/lib/suggest-llm.ts` lines 254–307

### Searching Emails

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

# Use wildcards for partial matches
sub:*report* month:*january*
```

Search results appear instantly with highlighted matching text. Click a result to view the full message.

### Managing Folders

Standard folders are available in the sidebar:
- **INBOX** — incoming messages (default selected)
- **Sent** — sent emails
- **Drafts** — unsent drafts
- **Archive** — archived messages
- **Spam** — junk/spam folder
- **Trash** — deleted messages

## MCP Tools Reference

The email client registers these 13 tools with the Ingenium MCP server:

| Tool | Description | Key Parameters | Returns |
|------|-------------|----------------|---------|
| `ingenium_email_accounts` | List configured accounts | `project` | Array of `{ id, email, name, provider }` objects |
| `ingenium_email_send` | Compose and send | `project`, `account`, `to`, `subject`, `html` (optional: `text`, `cc`, `bcc`) | Send confirmation |
| `ingenium_email_search` | Search across emails | `project`, `account`, `query` (optional: `folder`) | Matching email summaries |
| `ingenium_email_read` | Read a single email | `project`, `account`, `uid`, `folder` | Full email with headers, body, attachments |
| `ingenium_email_list` | List emails in folder | `project`, `account` (optional: `folder`, `page`) | Paginated email list |
| `ingenium_email_folders` | List IMAP folders | `project`, `account` | Array of folder names |
| `ingenium_email_draft` | Save a draft | `project`, `account`, `to`, `subject`, `html` | Draft saved confirmation |
| `ingenium_email_draft_response` | Auto-saves the first AI-drafted reply as a Drafts-folder draft in Gmail | `project`, `account`, `uid` (optional: `folder`) | Draft saved to Drafts folder |
| `ingenium_email_suggest` | Returns 3 AI-drafted reply options with different tones, based on your past sent-email patterns | `project`, `account`, `uid`, `folder` | AI-generated response suggestion |
| `ingenium_email_triage` | Triage inbox | `project`, `account` (optional: `limit`) | Priority-categorized emails |
| `ingenium_email_patterns` | List learned patterns | `project` | Email-related skills |
| `ingenium_email_watch_start` | Start IMAP IDLE watcher | `project`, `account` | Watcher started confirmation |
| `ingenium_email_watch_status` | Check IMAP watcher | `project`, `account` | Running/stopped status |

**Example usage in OpenCode:**
```typescript
// List accounts
const accounts = await ingenium_email_accounts({ project: "my-project" });

// Read inbox
const emails = await ingenium_email_list({ project: "my-project", account: "account-id", folder: "INBOX" });

// Compose and send
await ingenium_email_send({ 
  project: "my-project",
  account: "account-id",
  to: "recipient@example.com",
  subject: "Project Update",
  html: "<p>Here's the latest status report...</p>"
});
```

## Smart Reply Learning

The email client can learn your response style and draft 3 reply options when you reply to emails — similar to Gmail's Smart Reply Suggestions appear **inside the inline reply composer** (not as a standalone block above the email body). When you click Reply, the compact inline composer mounts, auto-fetches suggestions, and renders them as pill/chip buttons below the message textarea.

### How It Works

1. **Voice sampling**: When generating suggestions, the system reads your recent Sent-folder emails (up to 15 most recent with cached bodies) to capture your tone, sign-offs, and reply style. This happens on-demand, not continuously.

2. **LLM-powered drafting**: The system sends the target email (sender, subject, body snippet) along with your voice samples to the configured Synthesis LLM, asking for exactly 3 distinct draft replies with different tones (concise, warm, formal).

3. **Caching**: Generated suggestions are cached in the `email_suggestions` database table (keyed by account + folder + UID). Subsequent opens of the same email return instantly from cache — no repeat LLM calls.

   > 🔴 **Cache persistence fix**: `upsertEmailCache()` (`packages/ingenium-core/lib/tools/email-cache.ts:87`) uses `INSERT ... ON CONFLICT(account_id, folder, uid) DO UPDATE SET` instead of the old `INSERT OR REPLACE`. The old pattern deleted the old row before inserting, which triggered `ON DELETE CASCADE` on child tables (`email_bodies`, `email_suggestions`, `email_summaries`) — destroying cached suggestions, bodies, and summaries on every re-sync cycle. `ON CONFLICT DO UPDATE` preserves child data across re-syncs. Cached suggestions now survive parent email re-syncs indefinitely.

4. **Folder handling**: The suggest endpoint (`GET /suggest/:uid`) sends the **actual `email.folder` value** from the request query parameter — no defaulting to `"INBOX"`. The inline SmartSuggest component encodes the folder via `encodeURIComponent(folder ?? "")` with no fallback. The `EmailComposer` passes `folder` exactly as received from `email.folder`. This means caching works correctly for all folders — suggestions generated in Sent, Starred, Archive, etc. are cached and returned by folder key, not lumped under INBOX.

5. **Noreply-sender skip gate**: Before any cache or LLM call, the endpoint checks sender fields against `/no[-_.]?reply|do[-_.]?not[-_.]?reply/i` (case-insensitive regex applied to both `from_addr` and `from_name`). If matched, it returns `source: "noreply"` immediately with empty suggestions and **no UI rendering** — the `SmartSuggest.tsx` component returns `null` for the `"noreply"` source. This prevents LLM calls on automated/transactional emails.

6. **Smart gating**: Suggestions are generated for all emails (read or unread) — the read-status restriction has been removed. The noreply-sender check, settings toggles (`mail_smart_replies_enabled`), and auto/manual mode still apply. Each email only gets one LLM generation; subsequent opens return cached suggestions (`source: "cache"`). This prevents "blowing up your LLM" usage.

7. **Graceful fallback**: If no Synthesis LLM is configured (Settings → Synthesis LLM), the system falls back to template-based keyword matching against manually-created email skills. The UI shows a note directing you to configure an LLM for full AI drafting.

8. **Background precomputation (optional)**: When `mail_smart_replies_prefetch` is enabled, the sync engine generates suggestions **in the background** for genuinely new incoming messages as they arrive through delta poll. This means suggestions appear instantly (from cache) when you open those emails later — no waiting for LLM generation.

   **How background precomputation works:**
   - The sync engine's delta poll (every 30s) detects genuinely new messages (via `history.list`'s `messagesAdded` entries — label changes and resyncs are **not** queued)
   - New messages are enqueued into a **durable `email_suggestion_queue` table** (survives restarts)
   - A dedicated worker processes the queue: for each message, it calls the LLM to generate suggestions and stores them in `email_suggestions` cache
   - **Retry with backoff**: If an LLM call fails, the queue entry is retried up to 3 times with exponential backoff (30s → 2min → 5min). After the final failure, the entry is marked `failed` and not retried.
   - **Settings gate**: Queue processing respects `mail_smart_replies_enabled` and noreply checks
   - **LLM timeout safety**: Each generation uses the same `max_tokens: 8192` and `content`-only pattern as on-demand suggestions — reasoning traces are never exposed
   - The precomputed result is **indistinguishable from on-demand generation** — the same cache table, same API response shape, same source labels when read from cache

### Configuration

Uses the **existing Synthesis LLM** settings (`synthesis_model`, `synthesis_api_key`, `synthesis_endpoint`). No separate email-specific LLM configuration needed. Configure in Settings → Synthesis LLM.

Three email-specific settings control smart reply behavior, available in **Settings → Mail**:

| Setting Key | Default | UI Widget | Purpose |
|-------------|---------|-----------|---------|
| `mail_smart_replies_enabled` | `true` | Checkbox | Master toggle — when disabled, the suggest endpoint returns `source: "disabled"` and the UI shows nothing. |
| `mail_smart_replies_mode` | `"auto"` | Select dropdown (`auto` / `manual`) | **Automatic** — suggestions are fetched immediately when an email is opened. **Manual** — the component renders a "Generate Suggestions" button instead; the user clicks to trigger the LLM call. |
| `mail_smart_replies_prefetch` | `"false"` | Checkbox | Pre-generate smart replies in the background so they load instantly — enqueues genuinely new incoming messages for proactive LLM generation. |

Configure via dashboard Settings page or MCP tools:
```typescript
await ingenium_setting_set({
  project: "global-default",
  key: "mail_smart_replies_enabled",
  value: "true"
});
await ingenium_setting_set({
  project: "global-default",
  key: "mail_smart_replies_mode",
  value: "manual"  // or "auto"
});
await ingenium_setting_set({
  project: "global-default",
  key: "mail_smart_replies_prefetch",
  value: "true"  // or "false"
});
```

### API Response Shape

`GET /api/v1/emails/suggest/:uid?project=&account=&folder=`

```json
{
  "suggestions": [
    { "tone": "concise",  "subject": "Re: ...", "body": "..." },
    { "tone": "warm",     "subject": "Re: ...", "body": "..." },
    { "tone": "formal",   "subject": "Re: ...", "body": "..." }
  ],
  "source": "generated",  // or "cache", "heuristic"
  "configured": true
}
```

- `source: "generated"` — fresh LLM generation
- `source: "cache"` — instant from cache, no LLM call
- `source: "heuristic"` — LLM not configured, template fallback
- `source: "noreply"` — sender matched the noreply regex pattern; no UI shown
- `source: "disabled"` — `mail_smart_replies_enabled` setting is `"false"`; no UI shown
- `configured: false` — LLM not available, using heuristic

### Database

| Table | Purpose |
|-------|---------|
| `email_suggestions` | Caches suggestions per account/folder/UID with FK cascade to `email_cache` |
| `email_cache` | Parent table — suggestions deleted automatically when account is removed |

### Summarize This Email

A **"Summarize this email"** button appears near the top of every email reading pane (in the action bar, above the email body).

**How it works:**
1. Click "Summarize this email" — sends the email body (HTML stripped to text, truncated to 8000 chars) to the configured Synthesis LLM
2. The LLM returns a concise 2–3 sentence summary of the email's key points
3. The summary is cached per `(account_id, folder, uid)` in the `email_suggestions` table (same cache as smart replies), so subsequent views of the same email return the summary instantly
4. A "Show full email" toggle lets you expand back to the original body after viewing the summary

**Key differences from smart replies:**
- **Not gated by noreply checks** — Summaries work for automated/transactional emails too
- **Not gated by settings** — The summarizer is always enabled regardless of `mail_smart_replies_enabled` or `mail_smart_replies_mode`
- **Not gated by read status** — Works for any email (read, unread, sent, archived, spam)
- **Always cached** — First summary per email triggers an LLM call; all subsequent views serve from cache with `source: "cache"`

**🔴 Reasoning model compatibility (suggest-llm.ts line 225):**
- `max_tokens: 8192` ensures reasoning models have enough budget to complete their thinking and output clean summary text
- `reasoning_content` is **NEVER surfaced to users** — only clean `content` from the LLM response is shown. The old `content || reasoning_content` fallback pattern was removed from all suggest-llm.ts functions. If the model's response has empty `content` after thinking, an empty string is returned — the thinking trace is never exposed.
- ⚠️ **Pre-fix cached summaries**: Summaries generated before this fix (when the old fallback was in place) may contain leaked thinking-process text in their cache entries. Re-triggering the summarize action on the same email will overwrite the cached entry with a clean summary — the LLM is called fresh, and the new output uses `content` only. See `packages/ingenium-email/lib/suggest-llm.ts` lines 188–245.

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|--------------|-----|
| OAuth2 redirect fails (404) | Callback URI not registered in Google/Azure console | Add `http://localhost:3000/mail/oauth/callback` to authorized redirect URIs, restart server |
| "Access denied" error after login | OAuth scopes too limited or expired refresh token | Re-authorize account via dashboard — complete full OAuth2 flow again |
| Inbox empty but no errors | IMAP connection timeout | Check firewall allows outbound IMAP (port 993) and SMTP (port 465), verify API is running on :4097 |
| Account shows in dropdown but no emails | Account not fully authenticated | Remove the account and re-add via the setup flow |
| Compose dialog has box-within-a-box layout | CSS nesting issue | Ensure EmailComposer is rendered directly inside Overlay's `children`, not wrapped in an extra `<div>` with border |
| Search returns no results | Query syntax incompatible with FTS5 | Use simpler queries first: `subject:test` or just keywords without operators |
| SMTP send fails (timeout) | Mail provider blocking local connections | Verify Docker network allows outbound SMTP, check mail server accepts relay from your IP range |
| Smart replies show "Configure LLM" note | Synthesis LLM not set up | Go to Settings → Synthesis LLM, select a model and enter API key |
| Smart replies disappeared after re-sync | Old `INSERT OR REPLACE` bug (pre-fix) | If a re-sync occurred before the `ON CONFLICT DO UPDATE` fix was deployed, cached suggestions were cascade-deleted. Re-open the email and click Reply — suggestions regenerate on the next suggestion fetch (the new cache is now persistent). |
| Old emails show no suggestions | Noreply sender or settings disabled | Check if sender matches the noreply regex or verify `mail_smart_replies_enabled` is `"true"` in Settings → Mail |
| Noreply/automated emails show no "Smart Replies" section | Noreply sender skip gate — senders matching `/no[-_.]?reply|do[-_.]?not[-_.]?reply/i` are suppressed with `source: "noreply"` and render no Smart Replies UI | This is intentional; smart reply LLM calls are not wasted on automated/transactional emails. The "Summarize this email" button still works for these emails. |
| Neither toolbar nor suggestions appear | TipTap build issue or missing Synthesis LLM config | Verify the TipTap/rich-text composer built correctly (check console for JS errors). If the toolbar doesn't render, the compose area may fall back to a plain textarea with no formatting controls. Also verify Synthesis LLM is configured in Settings → Synthesis LLM — without it, Smart Suggestions and AI Review won't work. |
| Background generation not working | Precompute disabled or LLM not configured | Verify `mail_smart_replies_prefetch` is enabled (Settings → Mail checkbox). Ensure Synthesis LLM is configured. Check the API logs for `processSuggestionQueue` entries — if none appear, the queue worker isn't running or no new messages were enqueued. |

## Security Notes

- **Credentials encrypted**: All OAuth2 secrets are stored in database using AES-256-GCM with `INGENIUM_EMAIL_ENCRYPTION_KEY`
- **No plaintext storage**: Never see raw client IDs/secrets — they're always decrypted at runtime only
- **Project-scoped keys**: Each Ingenium project should have its own encryption key (never share across projects)

## Related Documentation

| Doc | Purpose |
|-----|---------|
| `docs/VARIABLES.md` | Email environment variables reference |
| `AGENTS.md` section "Email Client Environment Variables" | OAuth2 setup instructions and security warnings |
| `docs/self-learning-pipeline.md` Section 6 | MCP tools reference (observation + email tools) |

## Files Reference

| File | Purpose | Location |
|------|---------|----------|
| `packages/ingenium-email/src/oauth.ts` | OAuth2 flow handlers (Google + Azure AD) | Email client core |
| `packages/ingenium-email/src/accounts.ts` | Account management, credential encryption | Email client core |
| `services/ingenium-api/routes/email.ts` | REST API endpoints for email operations | API layer |
| `services/ingenium-dashboard/src/app/mail/page.tsx` | Dashboard 3-pane layout + compose overlay | Frontend |
| `services/ingenium-dashboard/src/app/mail/components/EmailComposer.tsx` | Compose dialog form | Frontend |
| `services/ingenium-dashboard/src/app/mail/components/AccountSetup.tsx` | Add account flow (OAuth + manual) | Frontend |
| `services/ingenium-dashboard/src/app/mail/components/FolderSidebar.tsx` | Account dropdown + folder list | Frontend |
| `services/ingenium-dashboard/src/app/mail/components/EmailList.tsx` | Email list with search + pagination | Frontend |
| `services/ingenium-dashboard/src/app/mail/components/EmailReader.tsx` | Full email display + actions | Frontend |
| `services/ingenium-dashboard/src/app/components/Overlay.tsx` | Generic modal overlay component | Frontend |
| `services/ingenium-dashboard/src/app/mail/oauth/callback/page.tsx` | OAuth callback handler + "Go to Mail" | Frontend |
| `packages/ingenium-email/lib/sync-engine.ts` | Background sync engine with priority queue, Gmail delta poll, body backfill, per-account workers | Email client core |
| `packages/ingenium-email/lib/providers/gmail.ts` | GmailProvider — MailProvider implementation using Gmail REST API | Email client core |
| `packages/ingenium-email/lib/providers/mail-provider.ts` | MailProvider interface contract for pluggable backends | Email client core |
| `packages/ingenium-email/lib/providers/gmail-api.ts` | Thin `fetch()`-based Gmail REST API client | Email client core |
| `packages/ingenium-core/lib/tools/email-cache.ts` | `clearFolderCache()`, `getSyncState()`, `clearCache()` | Core library |

## Sync Architecture (Gmail API, July 2026)

### Gmail API Provider

The email client uses **Gmail REST API** (`https://mail.google.com/` scope) instead of IMAP. The `GmailProvider` (`packages/ingenium-email/lib/providers/gmail.ts`) implements the `MailProvider` interface with a thin `fetch()`-based client (`gmail-api.ts`) — no heavy `googleapis` dependency.

Key differences from IMAP:
- **No connection pool** — Each API call is a stateless HTTPS request. No persistent IMAP connections to manage.
- **No UIDVALIDITY** — Gmail message IDs are stable hex strings. Cache invalidation due to UID renumbering does not occur.
- **No `[Gmail]/` folder aliases** — Gmail labels map directly to flat folder names. No Noselect filtering needed.
- **No IDLE watch** — Delta polling via `history.list()` replaces IMAP IDLE for new mail detection.

#### 🔴 Sender Address Parsing Fix (`gmail.ts` line 142)

The Gmail provider previously used a hand-written regex (`^(?:"?([^"]*)"?\s*)?<?([^>]+)>?$`) to parse the `From` header for sender display names and addresses. This regex appeared to work for quoted display names but **catastrophically backtracked** for unquoted names, corrupting the `from_addr` field in the email cache — frequently reducing it to a single character (e.g., `'m'`) for most emails.

**Fix**: The hand-written regex was replaced with `mailparser`'s `simpleParser` — the same library already used by the IMAP sync path (`packages/ingenium-email/lib/parser.ts` line 10). The fix at `packages/ingenium-email/lib/providers/gmail.ts` line 142:
```typescript
const parsed = await simpleParser(`From: ${fromRaw}\r\n\r\n`);
const fromValue = parsed.from?.value?.[0];
fromName = fromValue?.name?.trim() || null;
fromAddr = fromValue?.address?.trim() || null;
```
This correctly handles both quoted and unquoted display names per RFC 2822.

**Repair**: All previously-corrupted cached email sender addresses have been repaired. If you see any remaining garbled sender names, clearing the email cache (`clearFolderCache()`) and re-syncing will regenerate them with correct addresses.

### Delta Sync (history.list)

The sync engine uses Gmail's **history API** for incremental delta sync:

```
history.list(startHistoryId) → { history: [...], historyId }
```

- Returns only **what changed** since the last poll: messages added, messages deleted, label changes.
- **Empty response** when nothing new — the `historyId` cursor advances without any data transfer.
- Initial sync (no cursor) triggers a **full resync** — `listMessages()` batches metadata gets.
- If the `historyId` expires (Gmail retains history for ~7 days), the provider returns `fullResyncRequired: true` and the engine re-syncs all folders.

The delta poll runs every **30 seconds** (P0 priority) — cheap because empty responses cost ~1 quota unit.

### Label → Folder Mapping

Gmail labels are mapped to folder names for the cache layer:

| Label ID | Folder Name | Notes |
|----------|-------------|-------|
| `INBOX` | INBOX | Primary inbox |
| `SENT` | Sent | Sent messages |
| `DRAFT` | _(skipped)_ | Not exposed as a folder in the provider |
| `SPAM` | Spam | Junk/spam |
| `TRASH` | Trash | Deleted messages |
| `STARRED` | Starred | Starred/flagged messages |
| `IMPORTANT` | Important | Gmail's automatic importance |
| `CATEGORY_*` | _(skipped)_ | Gmail category labels are filtered out |
| `CHAT` | _(skipped)_ | Chat messages excluded |
| Custom (`type=user`) | Label display name | User-created labels use their name as folder |

### Message IDs

Gmail message IDs are **hex strings** (not integers). All cached messages are keyed by string ID throughout the `email_cache` and `email_bodies` tables. The migration `025_email_string_ids.sql` rebuilds the `uid` columns from INTEGER to TEXT.

### Token Refresh

`getFreshGmailToken()` in `oauth.ts` auto-refreshes OAuth tokens **60 seconds before expiry** using `google-auth-library`. The refresh is transparent — every provider method calls `getFreshGmailToken()` at the top, regardless of the `tokens` parameter passed in.

### Attachment Downloads

Attachment metadata is discovered during body fetch (`walkParts()` in `gmail.ts`). Each attachment carries two identifiers:
- **`partId`** — The MIME part identifier within the message (e.g., `"0"`, `"1"`)
- **`attachmentId`** — An opaque Gmail API token for retrieving the attachment data

Both are cached in `headers_json` within the `email_bodies` table. The frontend sends the `attachmentId` to the download endpoint:

```
GET /api/v1/emails/:id/attachments/:attachmentId
```

The route handler resolves the real attachment ID by walking the Gmail message parts. This works for both old caches (which stored only `partId`) and new caches (which include the `attachmentId` from the API). The attachment data is fetched on-demand from the Gmail API using `users.messages.attachments.get` and decoded from base64url.

### Rate Limits

The Gmail API enforces a **250 quota units per second** per user. Cost breakdown:

| Operation | Cost |
|-----------|------|
| `history.list` (empty response) | ~1 unit (free if nothing changed) |
| `messages.list` (search/query) | 1 unit |
| `messages.get` (metadata) | 5 units |
| `messages.get` (full body) | 5 units |
| `messages.send` | 100 units |
| `messages.modify` (labels) | 5 units |
| `users.attachments.get` | 5 units |
| `users.labels.list` | 1 unit |

**Mitigations:**
- Delta poll (30s) costs ~1 unit because empty responses are free
- Body fetches are batched in groups of 5 with **200ms yield** between batches
- Initial sync uses `batchGetMessages()` to fetch metadata in parallel (stays under quota)
- The offline window (`mail_offline_window`, default 500) caps metadata per folder

### Background Sync Engine

The email client uses a **singleton background sync engine** (`packages/ingenium-email/lib/sync-engine.ts`) that owns **all Gmail API I/O**. One engine per container launches one worker per connected email account. Workers are serialized per-account — no concurrent API calls for the same account.

#### Priority Queue

Each worker maintains a priority-ordered task queue with deduplication:

| Priority | Task Type | Trigger |
|----------|-----------|---------|
| **P0** | Delta poll (history.list) | Every 30s — cheap, empty response when nothing new |
| **P1** | `sync-folder` (boosted) | User clicks a folder in UI |
| **P1** | `backfill-bodies` (boosted UID) | On-demand body fetch hint after synchronous Gmail API response (user sees body immediately; engine caches it for next read) |
| **P2** | `sync-folder` (INBOX stale) | INBOX headers older than sync interval (default 5 min) |
| **P3** | `sync-folder` (round-robin) | All folders cycled, skip-fresh gate (DB `last_synced_at`) |
| **P4** | `backfill-bodies` (capped) | Headers synced but bodies uncached, up to `mail_body_window` |
| **P5** | `backfill-bodies` (deeper) | Body window full but boosted folder has more bodies |

**Per-account serialization**: One worker per account, sequential task execution. Body fetches batch in groups of 5 with 200ms yield between batches. The entire loop yields 1s between full account ticks.

**Heartbeat**: `engineState.heartbeatAt` is updated on every loop tick (even on errors). The dashboard / status page checks heartbeat age to detect stuck workers.

#### Task Lifecycle

1. **Delta poll** (every 30s) — calls `provider.changesSince(historyId)`. Applies upserts/deletes to cache, advances cursor.
2. **Maintenance tick** (when queue empty) — generates P1 boosted folders, P2 stale INBOX, P3 round-robin, P4 body backfill, P5 deep backfill.
3. **Task execution** — `sync-folder` calls `provider.listMessages()` (fetches metadata headers, capped at `mail_offline_window`), updates folder state.

   `backfill-bodies` calls `provider.getBody()` for each missing UID, stores HTML/text/attachments to `email_bodies` table.
4. **Watchdog** — Each task has a 5-minute watchdog timer. Stuck tasks are aborted with an error.

#### Full Resync Flow

When `changesSince()` returns `fullResyncRequired: true` (initial sync or expired historyId):
1. Engine enqueues P2 `sync-folder` tasks for **all** folders
2. Each folder's `listMessages()` fetches metadata headers (capped at `mail_offline_window`)
3. After headers are cached, P4 body backfill tasks are enqueued automatically
4. The new `historyId` from Gmail is stored as the cursor for future delta polls

### Route Contract (Cache-First with Synchronous Fallback)

Read routes serve from cache first. `GET /:uid` makes synchronous Gmail API calls on cache-miss for immediate body delivery. `GET /` with `?refresh=true` also performs a synchronous fetch via the Gmail REST API with a 10s timeout. All other routes are **cache-only — never block on the Gmail API**:

| Route | Behavior |
|-------|----------|
| `GET /` (email list) | Serves from `email_cache`. Cache hit → return instantly with `source: "cache"`. Cache miss → return `source: "pending"` + empty array. `?refresh=true` performs a **synchronous fetch** via Gmail REST API with 10s timeout — returns `source: "live"` on success or falls back to `source: "cache"` on timeout. The sync engine still backfills in the background. |
| `GET /:uid` (single email) | Serves body from `email_bodies` cache. Body cached → return full email with `source: "cache"`. Body miss → fetches body **synchronously** from Gmail API (~400ms) and returns 200 with `source: "live"`. 202 polling remains only as a timeout/error fallback. Background `boostBody()` hint enqueued to cache for subsequent reads. |
| `GET /search` | Filters cached emails in-memory. No cached data → returns `source: "pending"` + hints engine. |
| `GET /folders` | Reads from settings cache (`email_folders_<accountId>`). Empty → hints engine, returns `source: "pending"`. |
| `GET /triage` | Filters cached INBOX emails for unread items. Empty → hints engine. |

**Key principle**: All other routes never call the Gmail API directly — I/O flows through the engine's priority queue via `boostFolder()` / `boostBody()` hints. `GET /:uid` and `GET /?refresh=true` are the exceptions, calling the Gmail API synchronously for immediate delivery and hinting the engine to cache for subsequent reads.

### Bounded Windows

Two configurable caps prevent unbounded sync:

| Setting Key | Default | Purpose |
|-------------|---------|---------|
| `mail_offline_window` | 500 | Max headers (email listings) to cache per folder |
| `mail_body_window` | 200 | Max email bodies to cache per folder |

Configure via dashboard Settings page or MCP tools:
```typescript
await ingenium_setting_set({
  project: "global-default",
  key: "mail_offline_window",
  value: "500"
});
await ingenium_setting_set({
  project: "global-default",
  key: "mail_body_window",
  value: "200"
});
```

Also configurable: `mail_sync_interval_ms` (default 300,000 = 5 min) controls the freshness gate for header re-sync.

### Engine Status

`getEngineStatus()` exposes the engine state for dashboard / status page monitoring:

```typescript
interface FolderEngineState {
  folder: string;
  state: "idle" | "syncing-headers" | "backfilling-bodies" | "complete" | "error";
  headersSynced: number;
  headersTotal: number;
  bodiesCached: number;
  bodiesWindow: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

interface EngineStatus {
  running: boolean;
  heartbeatAt: string | null;
  accounts: { accountId: string; email: string; folders: FolderEngineState[] }[];
}
```

The folder state machine progresses: `idle → syncing-headers → backfilling-bodies → complete`. Error state is set on failures; the next successful task transitions out of error. The `GET /sync-status` API endpoint returns both a backward-compatible summary and the raw `engine` object.

### Engine Lifecycle

- **Start**: `startEngine(projectId)` — idempotent, launches workers for all connected accounts via `GmailProvider`.
- **Stop**: `stopEngine()` — aborts all workers via AbortController, waits for graceful shutdown.
- **Restart safety**: Workers survive container restarts because the email cache is SQLite-backed (persistent). On restart, `startEngine()` re-launches workers; the freshness gate (`last_synced_at` in DB) prevents full re-syncs.
- **Migration path**: `prefetchAllAccounts()` is deprecated — delegates to `startEngine()` for backward compatibility.

### HTML Rendering

Emails with HTML bodies render in a **sandboxed `<iframe>`** (`sandbox="allow-same-origin allow-popups"`, no `allow-scripts`). CSS from the email cannot leak into the dashboard. Emails > 2MB show a text-only fallback. An `EmailErrorBoundary` catches render exceptions to prevent full-page crashes.

---

*Last updated: July 15, 2026 — Smart replies work for all emails (read-status restriction removed), inline compose for Reply/Draft (Gmail-inspired), Summarize This Email button (cached AI summaries for any email), Review with AI button (on-demand draft review in inline and modal compose), Smart Reply Learning (LLM-powered suggest + draft response), cache-first Gmail API with delta sync, priority queue, bounded windows.*
