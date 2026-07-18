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
export INGENIUM_EMAIL_ENCRYPTION_KEY=a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2
export OAUTH_REDIRECT_URI=http://localhost:3000/mail/oauth/callback
```
These are passed through to `docker compose` via the `${VAR:-}` expansion in `docker-compose.yml`.

> 🔴 **Security**: Never commit these values. The encryption key must be 64 hex characters (32 bytes) or a 64-character base64url secret; the latter is deterministically reduced to an AES-256 key. Generate a unique key per project — do not reuse across deployments.

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

### Verify Account Setup

After successful authentication, you should see:
- Your email address listed under "My Accounts"
- Inbox view populated with recent messages
- Folder navigation showing standard folders (INBOX, Sent, Drafts)

## Troubleshooting

| Problem | Likely Cause | Fix |
|---------|--------------|-----|
| OAuth2 redirect fails (404) | Callback URI not registered | Add `http://localhost:3000/mail/oauth/callback` to authorized redirect URIs |
| "Access denied" error | OAuth scopes too limited | Re-authorize account via dashboard |
| Account shows in dropdown but no emails | Account not fully authenticated | Remove and re-add via setup flow |

## Security Notes

- **Credentials encrypted**: All OAuth2 secrets are stored using AES-256-GCM with `INGENIUM_EMAIL_ENCRYPTION_KEY`
- **No plaintext storage**: Never see raw client IDs/secrets — decrypted at runtime only
- **Project-scoped keys**: Each project should have its own encryption key

## Account Removal

Removing an email account follows a three-step cleanup flow:

1. **Worker stop** — The sync engine stops any active IMAP watcher and IDLE connections for the account.
2. **Settings removal** — The account entry and its encrypted credential bundle are deleted from the database.
3. **Cache cleanup** — All cached email data (headers, bodies, summaries, smart-reply caches) for the account is purged.

To remove an account, go to **Settings → Mail** and click **Remove** next to the account name. You will be prompted to confirm.

## Account Hiding

If you want to keep an account configured but remove it from the sidebar, use **hide** instead of remove:

- **Hide/show controls**: In the FolderSidebar, click the eye icon (👁) next to the account name, or right-click and select "Hide account" / "Show account".
- **Hidden accounts continue syncing** — background sync, smart replies, and IMAP watchers remain active.
- See [Mail Usage: Account Hiding](../usage/mail.md#account-hiding) for full details.

## Re-Authentication After Key Rotation

If `INGENIUM_EMAIL_ENCRYPTION_KEY` is rotated, all stored credentials become undecryptable — both OAuth2 tokens and app-password credentials. The sync engine parks the affected workers (no infinite retry loop) and the dashboard shows a **Reconnect** button for each affected account.

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
