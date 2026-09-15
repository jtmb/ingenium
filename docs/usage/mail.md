---
title: Mail
description: Using the Ingenium email client — reading, composing, searching, and managing emails with AI-powered features.
---

# Usage: Mail

## Overview

The email client provides Gmail REST API inbox viewing via thin `fetch()` client, email composition through SMTP (nodemailer), MIME parsing, and search functionality.

## Durable account identity

Mail remains serviced through the canonical `global-default` runtime, but each
account is owned by an organization or a private user. Account metadata,
organization-qualified cache rows, OAuth values, and encrypted app-password
values are stored in the canonical SQLite database on the `ingenium-data`
volume. Rebuilds preserve them; deleting that volume does not.

Mail API routes resolve the canonical global project before account, cache, or
provider work begins. The `project` query parameter remains accepted for
backward compatibility but does not select the mail namespace. If canonical
global resolution fails, the operation fails closed before a provider request is
made.

Every account operation resolves the caller's organization and then applies the
account owner policy. Organization roles can use organization-owned accounts;
private accounts require their owner or an explicit grant. Foreign and
unauthorized accounts are returned as not found. Folder names are retained
unchanged through cache and provider operations.

### Encryption continuity

Credentials and OAuth tokens are encrypted with AES-256-GCM using
`INGENIUM_EMAIL_ENCRYPTION_KEY`. Ingenium stores only a non-reversible SHA-256
fingerprint of the normalized encryption key to detect continuity; it never
returns or logs the key, plaintext credentials, or ciphertext. A missing,
malformed, or changed key blocks writes rather than replacing recoverable data.
Account discovery remains available, while credential reads fail closed and the
mail service reports a reconnect/degraded state.

There must be exactly one active global project, and it must be named
`global-default`. If project integrity is ambiguous or the active global has a
different name, mail resolution fails closed rather than choosing a project by
name or row order.

### Legacy Account Migration

Startup recovery may move stranded mail settings from other project namespaces
into canonical `global-default`, but only as an all-or-nothing, verified,
compatible group.
Its preflight groups account metadata with its OAuth token record, decrypts every
credential with the active key, checks account identity, encryption continuity,
unambiguous source ownership, and destination collisions, and verifies the
destination before deleting any source row.

- A malformed, orphaned, plaintext, or undecryptable group is skipped.
- Source rows are retained when preflight or destination verification fails.
- Ambiguous or conflicting candidates are left for operator review rather than
  overwritten; existing destination values are never replaced. Recovery reports
  only bounded counts/status; it never exposes credential values, ciphertext, or
  account contents.
- Transient OAuth CSRF state is not migrated as durable account data.

Run preflight only after deploying the release containing the migration guards;
do not trigger a live migration against an older running API.

### Initial connection test and account retention

Manual account setup persists the account metadata and encrypted credential before
testing the connection. If that first test fails, the account is retained and
the setup form offers **Retry Connection**, editing, and **Remove Saved Account**.
Retry updates the existing account rather than creating a duplicate. Removal is
explicit; a failed connection test does not silently delete the account or its
saved data.

Provider and OAuth failures are redacted at the mail boundary: responses and
durable diagnostics contain only a stable code, safe message, operation, and
retryability. Provider URLs, response bodies, headers, token values, and raw
library error text are not returned or logged.

### Global OAuth application secrets

OAuth application client secrets are stored as protected vault settings under
the canonical `global-default` project. After the vault is unsealed, legacy plaintext
settings are reconciled for Gmail and Outlook. The encrypted copy is
decrypted/verified before the legacy row is removed. Conflicts, unavailable
vaults, and decryptability failures retain the source and do not overwrite a
protected value. An ambiguous duplicate-global state fails closed.

The settings contract is masked (`isSet`, `masked`) and supports `preserve`,
`replace` with a non-empty value, and explicit `clear`. Blank sanitized input
preserves the existing secret; the dashboard sends `clear` only after the user
confirms the destructive action.

## Cache-First Architecture

The email client uses a **cache-first** pattern to ensure the UI never blocks on live API calls:

- **GET emails always serves from cache** — returns immediately from SQLite cache, triggers background stale refresh
- **Cache miss = instant return + background fetch** — UI never waits on the Gmail API
- **Body caching** — When an email is opened for reading, the body is fetched and cached
- **Freshness gate** — Uses durable DB `last_synced_at` timestamp to skip recently synced folders

When the account, folder, page, search, or selected message changes, in-flight
mail requests are aborted and responses carrying an older mail context are
discarded. A slow response from the previous selection cannot overwrite the
current account or folder.

### Gmail delta consistency

Gmail history changes apply message upserts, message deletions, and the account
history cursor in one database transaction. A failed write does not advance the
cursor, so the same history remains eligible for retry. Deleted messages also
remove their matching cached suggestion work and cached message row atomically.

## Viewing Inbox

The inbox displays in a 3-pane layout:
1. **Left sidebar** — account dropdown, compose button, and folder list (INBOX, Sent, Drafts, Archive, Spam, Trash)
2. **Middle pane** — email list with subject, sender, date preview (resizable handle)
3. **Right pane** — full message content when an email is selected, with a responsive reply panel

### Create a task from an email

1. Select an email from the currently loaded account and folder.
2. In the reader, choose **Create task**.
3. Enter the task title and confirm with **Create Task**.

The capture uses the exact loaded account, folder, and message UID. It creates a
title-only task reference in the global Mail project (`global-default`, normally),
regardless of the dashboard's selected worktree project. It copies no email body,
attachment, header content, or other message data. Repeating the same capture
returns the existing task instead of creating another one.

If the message is no longer loaded or the source identity is invalid, the capture
fails without creating a task and the modal shows the error. Mail account/project
resolution failures are fail-closed rather than redirected to another project.

On mobile, selecting a row changes from the list to the reader. Use **Back to
messages** to return to the list, then select another message; use **Create task**
from the reader while that message is loaded.

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

**Save Draft** builds the RFC822 message locally and appends it to the provider's
`Drafts` mailbox through IMAP. It does not send the message through SMTP.

### Review with AI

A **"Review with AI"** button appears below the message textarea. Clicking it sends your draft to the configured Synthesis LLM for tone, grammar, and clarity suggestions.

## Account Hiding

The FolderSidebar allows you to **hide** accounts from the left sidebar while keeping them active. This is useful when you have multiple accounts but only need a few visible day-to-day.

- **Hidden accounts continue syncing** — hiding an account only removes it from the sidebar UI. Background sync, smart replies, and IMAP IDLE watchers continue normally.
- **Show/hide an account**: Click the eye icon (👁) next to the account name in the FolderSidebar, or right-click the account name and select "Hide account" / "Show account".
- **Collapsed "Hidden accounts" section**: When at least one account is hidden, a collapsed **"Hidden accounts"** section appears at the bottom of the FolderSidebar. Click to expand and view/manage hidden accounts.

## Recovery Behavior

The sync engine and dashboard work together to handle restarts, late account discovery, and authentication failures gracefully. This section documents the recovery paths and how accounts transition between states.

### Watcher authentication in a cleared environment

The IMAP watcher authenticates its direct API observation requests with the
protected API token file when the runtime has deliberately removed token values
from service environments. It resolves the credential at request time, adds
the bearer header only to Ingenium API calls, and does not pass it to email
providers. Invalid, missing, symlinked, or broadly readable token files fail
closed without writing credential material to watcher observations or logs.

### Reconnect Button

When an account requires re-authentication (e.g., after an encryption key rotation, expired OAuth token, or decryption failure), the account status changes to `error` and a **Reconnect** button appears in two places:

1. **FolderSidebar** — A small warning icon (⚠) appears next to the account name. Click it to see the Reconnect button.
2. **Account settings** — Under **Settings → Mail**, the affected account shows a "Reconnect" label with a clickable button.

Clicking **Reconnect** opens the AccountSetup dialog, which adapts to the account's `authType`:

- **OAuth2 accounts** (Gmail, Outlook) — Initiates a full OAuth2 re-authorization flow through the provider's consent screen. The `AccountSetup.tsx` component calls `handleOAuthRedirect()` to obtain a new authorization URL and redirect the browser.
- **App-password accounts** (Yahoo, Custom) — Opens the manual credential form pre-populated with the account's existing host/port settings. The user enters a new app password and submits it via `PATCH /accounts/:id/credentials`. See the next section for details.

### App-Password Credential Recovery via PATCH

App-password (manual) accounts recover from decryption failure or invalid credentials through an **in-place credential replacement** endpoint — no account removal or OAuth flow needed.

#### `PATCH /emails/accounts/:id/credentials`

Replaces the encrypted IMAP/SMTP password for an `app_password` account without touching any other account metadata or cached email data (`emails.ts:309-338`):

```typescript
// Request body
{ "appPassword": "new-app-password" }
```

**Behavior**:

| Aspect | Detail |
|--------|--------|
| Validation | Rejects non-`app_password` accounts with HTTP 422 (OAuth accounts must use the OAuth reconnect flow). Validates that `appPassword` is a non-empty string. |
| Encryption | The new password is encrypted with AES-256-GCM using `INGENIUM_EMAIL_ENCRYPTION_KEY` before storage (`accounts.ts:149-172`). |
| Engine reset | After storing, `stopAccountWorker()` stops the current worker and `startEngine()` spawns a fresh one (`emails.ts:330-331`). |
| Security | The response body never includes the submitted credential or any stored encrypted material — only `{ data: { success: true, accountId } }`. |
| Error | On encryption failure, returns HTTP 409 with `CREDENTIAL_UPDATE_FAILED` and a message to verify encryption configuration. |

**Frontend flow** (`AccountSetup.tsx:46-53, 89-173`):

1. When `reconnectAccount.authType === "app_password"`, the component auto-selects manual mode and pre-fills the form with the account's existing IMAP/SMTP host and port.
2. The user enters a new app password and clicks "Test Updated Credentials" (optional) or "Update Credentials".
3. Both actions call `PATCH /emails/accounts/:id/credentials` with the new password. The test action additionally calls `POST /emails/accounts/:id/test` to verify IMAP connectivity.
4. On success, the engine restarts with the new credentials and sync resumes automatically.

**Existing cached mail is preserved** — the credential update never clears the email cache or account settings.

### Visible Credential Failures

The dashboard detects credential decryption failures and auth errors through two overlapping mechanisms and displays them prominently so users never see a stuck "Setting up your mailbox" state.

#### Auth Error Detection (`mail/page.tsx:585-595`)

The `hasAuthError` flag is set to `true` when any of these conditions match:

1. **OAuth zero-worker** — An OAuth2 account with no sync worker and zero folders (`hasUnavailableOAuthAccount` check, lines 580-584).
2. **Folder-level error with auth-related message** — Any folder has `state: "error"` and `lastError` matches the regex `/auth|re-authenticat|credential.*(decrypt|reconn)/i` (line 586-589). This catches both OAuth error messages ("Account needs re-authentication...") and app-password error messages ("Account needs credential update...").
3. **All folders errored** — Every folder is in error state with zero cached emails (lines 591-594).
4. **Engine reports account with all folders errored** — The raw engine status shows the account but every folder is in the error state.

#### Credential Decryption Failure in the Sync Engine

When `getCredentials()` fails to decrypt stored credentials (`accounts.ts:196-232`), the engine detects it during the worker loop (`sync-engine.ts:406-432`):

- For **app-password accounts**: if `creds.password` is undefined after a decryption attempt, `needsCredentialUpdate` is set to `true` and every folder transitions to `error` with `lastError: "Account needs credential update — credentials are unavailable or cannot be decrypted."`.
- For **OAuth accounts**: if `creds.tokens` is undefined, the same mechanism sets `lastError: "Account needs re-authentication..."`.

The error messages are crafted to match the dashboard's detection regex so the amber banner appears automatically.

#### Dashboard Banners

The credential failure is surfaced in two contexts:

| Context | Location | Behavior |
|---------|----------|----------|
| **Initial mailbox setup** | `SyncProgress.tsx:255-272` | Amber banner with "Your email account needs to be reconnected." and a "Reconnect Account" button. Rendered while the progress screen is still showing. |
| **Main mail UI** | `mail/page.tsx:684-709` | Amber banner with warning icon, message "The stored credentials could not be decrypted.", and a "Reconnect" button that opens AccountSetup. |

Both banners call `handleReconnect()`, which opens AccountSetup with the affected account's details (`reconnectAccount` prop). The component then auto-selects OAuth or manual mode based on `authType`.

### Worker Reconciliation After Restart / Late Account Discovery

The sync engine supports **idempotent startup** — `startEngine()` is safe to call repeatedly. When called while the engine is already running, it reconciles workers for accounts that became available after the initial start:

1. **Engine-already-running path** (`sync-engine.ts:921-928`): Calls `spawnWorkers()` which iterates all stored accounts and skips any that already have a worker running.
2. **Scheduled health check** (`scheduler.ts:156-193`): A periodic timer (default 300s, configurable via `mail_sync_interval_ms`) checks the engine heartbeat. If the engine is not running or the heartbeat is stale (>120s), it restarts the engine entirely.
3. **OAuth callback** (`emails.ts:207-211`): After a successful token exchange, `startEngine()` is called explicitly to reconcile the new account's worker without disrupting existing syncs.

This means accounts added through the API or via OAuth while the engine is already running will automatically get their sync worker launched.

### Zero-Worker / Zero-Folder OAuth Account Detection

An OAuth2 account that exists in the DB but has no sync worker and no cached folders (e.g., after a restart before sync begins, or if token decryption failed) shows a **Reconnect** prompt instead of getting stuck in a perpetual "Setting up your mailbox" state.

The dashboard detects this condition (`mail/page.tsx:580-584`) by checking:

```typescript
const hasUnavailableOAuthAccount =
  selectedAccountDetails?.authType === "oauth2" &&
  syncStatus !== null &&
  syncStatus.totalFolders === 0 &&
  !selectedEngineAccount;
```

When all three conditions are true — the account is OAuth2, sync status returned zero folders, and the engine has no worker for this account — `hasAuthError` is set to `true`. This triggers the **Reconnect** banner in both the `SyncProgress` component (initial mailbox setup view) and the main mail UI. The user sees a clear call-to-action rather than an indefinite loading state.

**Additional error detection** (lines 585-595) catches both OAuth and app-password scenarios:
- Any folder in `engineState === "error"` with a `lastError` matching `/auth|re-authenticat|credential.*(decrypt|reconn)/i` — this covers both OAuth errors ("Account needs re-authentication...") and app-password errors ("Account needs credential update — credentials are unavailable or cannot be decrypted.")
- All folders in error state with zero cached emails
- The engine reports the account but folders are all errored

### Interactive Google Consent Required (OAuth Only)

> 🔴 This section applies only to **OAuth2 accounts** (Gmail, Outlook). App-password accounts use the PATCH credential replacement flow instead — no OAuth redirect or consent screen involved.

Every OAuth reconnection flow goes through the **full Google consent screen**. The backend unconditionally passes `prompt: "consent"` and `access_type: "offline"` when generating the OAuth authorization URL (`oauth.ts:296-303`):

```typescript
const url = gClient.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: "https://mail.google.com/ openid email profile",
  state,
  redirect_uri: getRedirectUri(),
});
```

This guarantees:
- A **refresh token** is issued on every authorization (not just the first), preventing silent token loss on re-auth.
- The user must **interactively approve** the requested scopes each time (Google does not skip consent for already-authorized apps when `prompt=consent` is set).
- The CSRF state token is stored server-side and validated on callback, then immediately deleted to prevent replay (`oauth.ts:343-350`).

### Tokens Stay Server-Side

The entire OAuth token exchange happens **server-side** — OAuth tokens never reach the frontend:

1. The dashboard fetches an OAuth URL from `GET /emails/accounts/oauth/url?provider=xxx` and redirects the browser to the provider.
2. The provider redirects back to the **server callback** (`POST /emails/accounts/oauth`).
3. The server exchanges the authorization code for tokens using `exchangeCode()`.
4. Tokens are **encrypted at rest** with AES-256-GCM (`oauth.ts:124-150`) and stored in the `settings` table under the `email_oauth_<accountId>` key.
5. `storeTokens()` is called server-side and never returns token values to the client (`emails.ts:207-208`):
   ```typescript
   // Store tokens server-side — never return them to the client
   storeTokens(projectId, acctId, tokens);
   ```
6. The frontend only stores the provider name in `localStorage` for redirect context (`AccountSetup.tsx:16-18`):
   ```typescript
   // SECURITY: OAuth tokens never touch the frontend — the backend handles the entire
   // authorization code flow. The frontend only stores the provider name in localStorage
   // for redirect context.
   ```

Token refresh also happens server-side. `getValidTokens()` (`oauth.ts:161-201`) auto-refreshes expired tokens when they are within 60 seconds of expiry, using the stored refresh token, and persists the refreshed tokens.

### Circuit Breaker

The sync engine implements a per-folder **auth-error circuit breaker** to prevent infinite retry loops against invalid credentials:

- After `MAX_AUTH_ERRORS` (hardcoded threshold of 3) consecutive auth-related errors on the same folder, the folder transitions to `error` state with the message `"Account needs re-authentication — visit /mail to reconnect"` (`sync-engine.ts:767-777`). For app-password accounts, auth errors that match `/401|unauthorized|invalid.*credential|auth.*error|re-authenticate|oauthtoken/i` trigger the same circuit breaker.
- New valid tokens from a successful OAuth flow clear the circuit breaker via `resetAuthCircuit()` (`oauth.ts:144-149`).
- A successful `PATCH /emails/accounts/:id/credentials` (app-password) also clears the circuit breaker — the engine restart triggered by `stopAccountWorker()` + `startEngine()` resets auth error counters for the account (`sync-engine.ts:995-1001`).
- Worker stop (`stopAccountWorker()`) also cleans up auth error counters for the account.

This is a safe degraded state, not an instruction to remove the account. Cached
metadata/mail remains available where possible. Restore the original encryption
key if continuity is the issue, or use **Reconnect**: OAuth accounts complete a
new provider consent flow; app-password accounts replace the password in place.

### Engine Health and Status

The service health API (`services.ts:225-264`) reports the following email-client states:

| State | Condition |
|-------|-----------|
| `stopped` | Engine not running |
| `healthy` | Engine running with heartbeat < 120s |
| `degraded` | Heartbeat stale > 120s, or all accounts have all folders in error |
| `idle` | Engine running but no accounts configured |
| `error` | `getEngineStatus()` threw |

The scheduled health check (`triggerMailSyncForAllProjects`) restarts the engine if the heartbeat is stale or the engine is not running, ensuring automatic recovery from process restarts.

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

Suggestion generation uses a leased background queue. A worker claim lasts 120
seconds by default; an expired claim can be reclaimed by another worker. Failed
jobs retry with bounded backoff (30, 60, 120, then 300 seconds) and are removed
after the fifth failed attempt. Jobs are deduplicated and are only generated
when the cached message and body are still available.

The IMAP IDLE watcher coalesces overlapping new-message events into one scan and
tracks message UIDs already handled during the watcher lifetime. Repeated events
therefore do not create duplicate triage or automatic drafts. Its hot
least-recently-used cache is bounded at **4,096 entries** and is only an
optimization; it is discarded when the process or watcher restarts.

The authoritative duplicate-suppression marker is durable migration 092, keyed by
`project_id`, `account_id`, `folder`, and `uid`. Each claim is an atomic database
operation: exactly one concurrent claimant receives `newlyRecorded: true`, while
duplicates receive `alreadyProcessed: true` and skip side effects. The database
retains only the newest **4,096 markers per project/account/folder scope**; a
duplicate refreshes its timestamp, and the oldest rows in that scope are pruned.
Because the marker is durable, a fresh watcher after an API restart still suppresses
work already claimed by the prior process. Within one process, concurrent starts
for the same account share one startup promise, and overlapping `exists` events
share one scan.

If a durable marker claim fails, the watcher logs at most three bounded warnings and
skips observation, suggestion, and draft side effects for that UID. The UID is not
put in the hot cache, so a later scan retries the claim. Deleting an account stops
its worker and watcher, clears all durable markers for the canonical project and
account, then removes the account and its cached mail.

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
