---
name: mail-app-ui-conventions
description: "Mail app UI/UX standards for sync operations — automatic job-based syncing, visible progress indicators, explicit interface."
---

# Mail App UI Conventions

## 🔴 HARD RULEs
- Sync must run automatically as separate jobs without manual triggers (user preference)
- UI must show progress during sync, never appear unavailable (importance: 6)
- Progress display must be visually appealing and explicit, not hidden or ambiguous (importance: 6)
- Interface must be explicit — no guessing required (importance: 6)

## Reference Files

| File | Content |
|------|--------|
| [`references/mail-app-automatic-syncing.md`](references/mail-app-automatic-syncing.md) | Job-based sync behavior and automation rules |
| [`references/mail-app-progress-indicators.md`](references/mail-app-progress-indicators.md) | Visual progress UI elements and states |
| [`references/mail-app-ui-explicitness.md`](references/mail-app-ui-explicitness.md) | Explicit interface standards for mail app |


## 🔴 HARD RULEs
- email_suggestions cache: folder must pass through unchanged from email.folder (no defaulting)
- noreply senders matching /no[-_.]?reply|do[-_.]?not[-_.]?reply patterns must be handled correctly
- mail_smart_replies_enabled checkbox setting must be documented and applied

## Reference Files

| File | Content |
|------|--------|
| [`references/email-cache-constraints.md`](references/email-cache-constraints.md) | Email suggestions cache folder and noreply sender rules |
| [`references/mail-settings.md`](references/mail-settings.md) | Mail SmartReply settings and documentation requirements |
