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

## Recovery Behavior

The sync engine and dashboard work together to handle restarts, late account discovery, and authentication failures gracefully. This section documents the recovery paths and how accounts transition between states.

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
