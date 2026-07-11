# Email Client — How-To Guide

This document covers setting up and using the Ingenium email client with Gmail and Outlook OAuth2 + IMAP/SMTP support.

## Overview

The Ingenium email client provides:
- **OAuth2 authentication** for secure access to Gmail and Outlook accounts
- **IMAP inbox viewing** via imapflow async client
- **Email composition** through SMTP (nodemailer)
- **MIME parsing** with mailparser for message content extraction
- **Search functionality** across email subjects, senders, and bodies

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
1. **Left sidebar** — folder tree (INBOX, [Gmail]/Sent Mail, etc.)
2. **Middle pane** — email list with subject, sender, date preview
3. **Right pane** — full message content when an email is selected

Click any email to view its complete headers and body in the right pane.

### Composing Messages

1. Click "Compose" button (pencil icon) or press `Cmd/Ctrl + N`
2. Fill in: To, Subject, Message body
3. Attach files using paperclip icon if needed
4. Click "Send" — uses SMTP via nodemailer to deliver through Gmail/Outlook servers

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

Standard IMAP folders are available:
- **INBOX** — incoming messages
- **[Gmail]/Sent Mail** — sent emails (Gmail)
- **[Outlook]/Drafts** — unsent drafts (Outlook)
- Custom labels/folders created in Gmail/Outlook web interface sync automatically

## MCP Tools Reference

The email client registers these tools with the Ingenium MCP server:

| Tool | Description | Parameters | Returns |
|------|-------------|------------|---------|
| `ingenium_email_accounts` | List all configured accounts | — | Array of `{ id, provider, emailAddress }` objects |
| `ingenium_email_send` | Compose and send new email | `{ accountId: string, to: string[], subject: string, body: string, attachments?: File[] }` | Message ID or error message |
| `ingenium_email_search` | Search emails across all accounts | `{ query: string, limit?: number, accountId?: string }` | Array of matching email summaries with highlights |
| `ingenium_email_read` | Fetch full messages by IDs | `{ ids: string[], includeHeaders?: boolean }` | Full message objects with MIME parsing results |

**Example usage in OpenCode:**
```typescript
// List accounts
const accounts = await ingenium_email_accounts();
console.log("Configured:", accounts); // [{ id: "1", provider: "gmail", emailAddress: "user@gmail.com" }]

// Search inbox for invoice-related emails  
const results = await ingenium_email_search({ query: "invoice 2026", limit: 5 });
results.forEach(msg => { console.log(`${msg.subject} from ${msg.sender}`); })

// Compose and send message
await ingenium_email_send({ 
  accountId: accounts[0].id,
  to: ["recipient@example.com"],
  subject: "Project Update",
  body: `Here's the latest status report...`
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
| Inbox empty but no errors | IMAP connection timeout (firewall blocking port 143) | Check firewall allows incoming/outgoing IMAP traffic, verify server is running on :4097 |
| Search returns no results | Query syntax incompatible with FTS5 | Use simpler queries first: `subject:test` or just keywords without operators |
| SMTP send fails (timeout) | Mail provider blocking local connections from container | Verify Docker network allows outbound SMTP, check mail server accepts relay from your IP range |

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
| `services/ingenium-dashboard/src/app/mail/page.tsx` | Dashboard UI for inbox/compose/search | Frontend |

---

*Last updated: July 10, 2026 — Email client fully implemented with OAuth2 + IMAP/SMTP support.*
