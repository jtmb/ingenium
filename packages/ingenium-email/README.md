# ingenium-email

IMAP/SMTP email client for the Ingenium MCP Server.

**Features:**
- IMAP email reading via `imapflow` — list, read, search, and triage emails
- SMTP sending via `nodemailer` — compose and send with HTML formatting, CC/BCC
- MIME parsing via `mailparser`
- **OAuth2 support** for Gmail (google-auth-library) and Outlook (@azure/msal-node)
- IMDb IDLE watcher for real-time email monitoring and auto-drafting
- AES-256-GCM credential encryption

**Constraint:** No direct database access. Communicates through the API layer only.
