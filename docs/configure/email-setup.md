---
title: Email Setup
description: Email account setup with OAuth2 for Gmail and Outlook — prerequisites, credential configuration, and account setup flow.
---

# Configure: Email Setup

## Overview

This guide covers setting up email accounts for the Ingenium email client with Gmail OAuth2 + REST API and SMTP support.

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
export OAUTH_REDIRECT_URI=http://localhost:3000/mail/oauth/callback
./scripts/bootstrap-local-secrets.sh
```
OAuth configuration is passed through Compose. The email encryption key is an
owner-only file mounted read-only from the path recorded in ignored `.env`.

> 🔴 **Security**: Never commit these values. The encryption key must be 64 hex characters (32 bytes) or a 64-character base64url secret; the latter is deterministically reduced to an AES-256 key. Generate a unique key per deployment and retain it unchanged while that deployment's encrypted mail data is in use.

## OAuth2 Credential Setup

OAuth application client secrets (`oauth_gmail_client_secret` and
`oauth_outlook_client_secret`) are protected settings backed by the encrypted
vault and belong only to the canonical `global-default` project. The selected
dashboard project does not change their storage scope. The Settings API returns only
masked presence metadata (`isSet` and `masked`), never the secret value. Use
explicit `preserve`, `replace`, or `clear` actions; a blank value from a
sanitized settings form preserves the existing secret. The dashboard requires
confirmation before it sends `clear`.

If the vault is sealed or unavailable, OAuth client-secret reads and writes
fail closed. After unseal, legacy values are reconciled for both supported
providers. A legacy plaintext value is removed only after an encrypted vault
copy is successfully created and decrypted/verified. Conflicting or
undecryptable values remain in place for operator review; protected values are
never overwritten by a conflicting legacy value. Duplicate active global
projects also fail closed.

OAuth callback diagnostics are redacted. User-facing callback failures use
constant safe messages, while server diagnostics retain only safe status/error
codes or error names. Provider URLs, response bodies, headers, authorization
codes, tokens, and raw library error text are not returned or logged.

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
5. Copy the **Client ID** and **Client Secret** from the popup

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
   - Copy the **Secret Value** immediately → set as `MS_OAUTH_CLIENT_SECRET`
5. Under "API permissions" → "+ Add a permission" → "Microsoft Graph" → "Delegated permissions":
   - Add `IMAP.AccessAsUser.All`
   - Add `SMTP.Send`
   - Add `offline_access`
   - Click "Grant admin consent" if using a tenant with admin rights

## Account Setup (OAuth2 Flow)

Once you have obtained OAuth2 credentials:

1. Open http://localhost:3000/mail
2. Click **"Add Email Account"**
3. Select provider (Gmail / Outlook)
4. Complete OAuth2 flow:
   - Browser redirects to Google/Outlook login page
   - Sign in with your email account
   - Grant Ingenium permission to access emails
   - Redirects back to callback URL automatically

Choose whether the account is organization-owned or private to the current
user before starting OAuth or manual setup. OAuth state is stored only as a
SHA-256 hash in a ten-minute, organization-qualified, consume-once attempt bound
to that owner and account ID. The callback cannot change the owner/account, and
replaying or crossing organizations returns a generic not-found/invalid-state
failure. Tokens remain server-only and are stored under the bound account.

### Verify Account Setup

After successful authentication, you should see:
- Your email address listed under "My Accounts"
- Inbox view populated with recent messages
- Folder navigation showing standard folders (INBOX, Sent, Drafts)

For manual setup, the account is saved before the initial connection test. A
failed test keeps the account and offers **Retry Connection**, editing, or
**Remove Saved Account**; retrying updates the existing account instead of
creating a duplicate.

### Provider endpoint rules

Gmail, Outlook, and Yahoo use fixed provider endpoints. Host and port overrides
for these providers are rejected; the transport always uses the canonical
provider configuration:

| Provider | IMAP | SMTP |
|---|---|---|
| Gmail | `imap.gmail.com:993` | `smtp.gmail.com:587` |
| Outlook | `outlook.office365.com:993` | `smtp.office365.com:587` |
| Yahoo | `imap.mail.yahoo.com:993` | `smtp.mail.yahoo.com:587` |

The **Custom** provider may override IMAP and SMTP hosts and ports. Hosts must
not contain whitespace, and ports must be integers from **1 through 65,535**.
When changing an existing account to Custom, provide all four values (IMAP host,
IMAP port, SMTP host, and SMTP port); invalid endpoint data is rejected before
credentials are accessed.

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|--------------|-----|
| OAuth2 redirect fails (404) | Callback URI not registered | Add `http://localhost:3000/mail/oauth/callback` to authorized redirect URIs |
| "Access denied" error | OAuth scopes too limited | Re-authorize account via dashboard |
| Account shows in dropdown but no emails | Initial connection test failed or credentials are invalid | Keep the saved account; edit its settings and retry the connection, or remove it explicitly |

## Security Notes

- **Credentials encrypted**: All OAuth2 secrets are stored using AES-256-GCM. Compose requires the owner-only `INGENIUM_EMAIL_ENCRYPTION_KEY_FILE`; the inline `INGENIUM_EMAIL_ENCRYPTION_KEY` is only a local-development fallback.
- **No plaintext storage**: Never see raw client IDs/secrets — decrypted at runtime only
- **Deployment-scoped key continuity**: Each deployment should have its own encryption key, which must remain available to decrypt its stored credentials
- **Rotation**: Run `scripts/bootstrap-local-secrets.sh --rotate-email-encryption-key` only with the one-shot empty-transition gate; any remaining mail/account/credential/OAuth/cache/queue/watcher reference blocks startup without changing continuity metadata.

## Account Removal

Removing an email account follows a three-step cleanup flow:

1. **Worker stop** — The sync engine stops any active IMAP watcher and IDLE connections for the account.
2. **Settings removal** — The account entry and its encrypted credential bundle are deleted from the database.
3. **Cache cleanup** — All cached email data (headers, bodies, summaries, smart-reply caches) for the account is purged.

This cleanup occurs only after an explicit **Remove** action; a failed initial
connection test does not trigger it.

To remove an account, go to **Settings → Mail** and click **Remove** next to the account name. You will be prompted to confirm.

## Account Hiding

If you want to keep an account configured but remove it from the sidebar, use **hide** instead of remove:

- **Hide/show controls**: In the FolderSidebar, click the eye icon (👁) next to the account name, or right-click and select "Hide account" / "Show account".
- **Hidden accounts continue syncing** — background sync, smart replies, and IMAP watchers remain active.
- See [Mail Usage: Account Hiding](../usage/mail.md#account-hiding) for full details.

## Re-Authentication After Key Rotation

If the deployment's email encryption key or protected key file is rotated, all
stored credentials become undecryptable — both OAuth2 tokens and app-password
credentials. The sync engine parks the affected workers (no infinite retry loop)
and the dashboard shows a **Reconnect** button for each affected account.

For an installation with no mail data, the protected-file operator path may use
`INGENIUM_EMAIL_ENCRYPTION_KEY_EMPTY_TRANSITION=1` for one restart. The API
updates continuity metadata only after a transaction proves every mail data and
reference surface empty and records a content-free audit event. If any row
exists, the transition fails closed; use a separately reviewed decrypt/re-encrypt
procedure instead of deleting or overwriting credentials.

Recovery path depends on the account's `authType`:

- **OAuth2 accounts** (Gmail, Outlook) — Must re-authorize through the full OAuth consent flow. The reconnect button opens the provider's consent screen.
- **App-password accounts** (Yahoo, Custom) — Can recover by providing a new app password through the in-place PATCH credential update. The reconnect button opens the manual credential form pre-filled with existing host/port settings.

See [Credential Rotation](../security/credential-rotation.md) for the full rotation procedure.

## Recovery Behavior

After a restart, late account discovery, or authentication failure, the sync engine and dashboard handle recovery automatically:

- **Worker reconciliation** — Idempotent `startEngine()` reconciles workers for accounts discovered after engine startup without disrupting existing syncs.
- **Zero-worker accounts** — An OAuth2 account with no sync worker and no cached folders shows **Reconnect** instead of a stuck "Setting up your mailbox" state.
- **Interactive consent** — Google OAuth re-authorization always requires interactive consent (`prompt=consent`), guaranteeing a refresh token on every flow. (OAuth accounts only — app-password accounts use the PATCH credential update.)
- **Server-only tokens** — OAuth tokens are exchanged, stored, encrypted, and refreshed entirely server-side; the frontend never sees them.
- **App-password credential recovery** — Manual (app-password) accounts use `PATCH /emails/accounts/:id/credentials` to replace the encrypted password in place. The engine restarts automatically after the update. See [App-Password Credential Recovery via PATCH](../usage/mail.md#app-password-credential-recovery-via-patch).

See [Mail Usage: Recovery Behavior](../usage/mail.md#recovery-behavior) for the full technical details.

## Related Docs
- [Mail Usage](../usage/mail.md) — Using the email client, recovery behavior
- [Variables](../develop/variables.md) — Email environment variables
- [Credential Rotation](../security/credential-rotation.md) — Encryption key rotation and re-authentication
