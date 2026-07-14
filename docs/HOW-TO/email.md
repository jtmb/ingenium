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
3. **Right pane** — full message content when an email is selected

Click any email to view its complete headers and body in the right pane.

### Composing Messages

1. Click "Compose" button in the left sidebar
2. The compose dialog opens as an overlay modal with "New Message" header
3. Select a From account (dropdown), fill in To, CC/BCC (optional), Subject, and Message body
4. Click "Send" — uses SMTP via nodemailer to deliver through Gmail/Outlook servers
5. Click "Save Draft" to save without sending, or "Discard" to cancel

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
| `ingenium_email_draft_response` | Auto-draft a response | `project`, `account`, `uid` (optional: `folder`) | Draft saved to Drafts folder |
| `ingenium_email_suggest` | Suggest a response | `project`, `account`, `uid`, `folder` | AI-generated response suggestion |
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

## Self-Learning Integration

The email client integrates with Ingenium's self-learning pipeline through several mechanisms:

### Automatic Observations

During account setup and usage, the Observer plugin automatically logs observations:
- **OAuth2 flow completion** → logged as `preference` observation about authentication preferences
- **Folder navigation patterns** → detected as workflow patterns for inbox management
- **Search query types** → analyzed to understand common email search needs

### Manual Logging (Recommended)

After discovering useful workflows, log them manually:

```typescript
// After setting up Gmail account successfully
await ingenium_observe({
  observation_type: "preference",
  content: "User prefers Gmail over Outlook for OAuth2 integration — completed setup in <5 minutes",
  importance: 7
});

// After discovering effective search patterns  
await ingenium_observe({
  observation_type: "pattern", 
  content: "User searches emails by combining subject keywords with date ranges (e.g., 'invoice AND month:june')",
  importance: 6
});

// After composing first email via SMTP
await ingenium_observe({
  observation_type: "insight",
  content: "Email composition works seamlessly through nodemailer — no additional configuration needed after OAuth2 setup",
  importance: 8
});
```

### Triggering Synthesis Pipeline

After configuring multiple accounts or discovering email workflows, trigger synthesis to process observations into personality traits and skills:

1. Run `/synthesize` command in OpenCode
2. Check status with `ingenium_synthesis_status()`  
3. View results on dashboard at `/personality` and `/skills`

The pipeline may auto-create an "email-client" skill or update existing communication-related skills based on your usage patterns.

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

## Security Notes

- **Credentials encrypted**: All OAuth2 secrets are stored in database using AES-256-GCM with `INGENIUM_EMAIL_ENCRYPTION_KEY`
- **No plaintext storage**: Never see raw client IDs/secrets — they're always decrypted at runtime only
- **Project-scoped keys**: Each Ingenium project should have its own encryption key (never share across projects)

## Related Documentation

| Doc | Purpose |
|-----|---------|
| `docs/VARIABLES.md` | Email environment variables reference |
| `AGENTS.md` section "Email Client Environment Variables" | OAuth2 setup instructions and security warnings |
| `docs/self-learning-pipeline.md` Section 6 | MCP tools for observations (including email-specific patterns) |

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

Attachment metadata is discovered during body fetch (`walkParts()` in `gmail.ts`). Attachments are cached in `headers_json` within the `email_bodies` table with Gmail attachment IDs. Downloadable via:

```
GET /api/v1/emails/:id/attachments/:attachmentId
```

The attachment data is fetched on-demand from the Gmail API using `users.messages.attachments.get` and decoded from base64url.

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
| **P1** | `backfill-bodies` (boosted UID) | GET /:uid returns 202 (body cache miss) |
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

### Route Contract (Cache-Only)

All read routes are **cache-only — never block on the Gmail API**:

| Route | Behavior |
|-------|----------|
| `GET /` (email list) | Serves from `email_cache`. Cache hit → return instantly with `source: "cache"`. Cache miss → return `source: "pending"` + empty array. `?refresh=true` calls `boostFolder()` (non-blocking hint to engine). |
| `GET /:uid` (single email) | Serves body from `email_bodies` cache. Body cached → return full email. Body miss → `boostBody()` + `boostFolder()` hints + **202 Accepted** with `retry: true`. Client retries in ~1.5s. |
| `GET /search` | Filters cached emails in-memory. No cached data → returns `source: "pending"` + hints engine. |
| `GET /folders` | Reads from settings cache (`email_folders_<accountId>`). Empty → hints engine, returns `source: "pending"`. |
| `GET /triage` | Filters cached INBOX emails for unread items. Empty → hints engine. |

**Key principle**: Routes never call the Gmail API directly. All I/O flows through the engine's priority queue via `boostFolder()` / `boostBody()` hints.

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

*Last updated: July 14, 2026 — Gmail API provider with delta sync, priority queue, cache-only routes, bounded windows.*
