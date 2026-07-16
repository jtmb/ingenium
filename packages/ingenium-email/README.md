# ingenium-email

IMAP/SMTP email client for the Ingenium MCP Server.

**Features:**
- IMAP email reading via `imapflow` — list, read, search, and triage emails
- SMTP sending via `nodemailer` — compose and send with HTML formatting, CC/BCC
- MIME parsing via `mailparser`
- **OAuth2 support** for Gmail (google-auth-library) and Outlook (@azure/msal-node)
- IMDb IDLE watcher for real-time email monitoring and auto-drafting
- AES-256-GCM credential encryption
- Background smart-reply precomputation with durable queue and retry

**Constraint:** No direct database access. Communicates through the API layer only.

### Background Suggestion Queue (`email_suggestion_queue`)

New messages detected by the sync engine's delta poll are enqueued into the durable `email_suggestion_queue` table (survives container restarts). A dedicated worker processes the queue sequentially per account: for each message it calls the Synthesis LLM to generate 3 tone-diverse reply suggestions and caches them in `email_suggestions`. Retry with exponential backoff (30s → 1m → 2m → 5m → 10m, max 5 attempts) handles LLM failures. The worker respects `mail_smart_replies_enabled` and noreply-sender skip gates. Each generation uses `max_tokens: 8192` with LLM timeout safety — reasoning traces are never exposed to users.
