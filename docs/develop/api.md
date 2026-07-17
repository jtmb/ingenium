---
title: API Reference
description: REST API design reference for the Ingenium system — endpoint catalog, data flow, and configuration.
---

# API Reference

## Overview

The Ingenium REST API runs on port 4097 and is the sole database authority. All data flows through HTTP to this API.

## Configuration

- **Port**: 4097 (configurable via `INGENIUM_API_PORT`)
- **Body limit**: `express.json({ limit: "2mb" })` for large skill/plugin uploads
- **Security**: helmet for security headers, CORS (configurable via `CORS_ORIGIN`), optional bearer token auth
- **Rate limit**: 100 req/min per IP (configurable via `INGENIUM_API_RATE_LIMIT`)

## API Endpoints by Category

### Dashboard Summary
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/dashboard/summary` | Aggregated home dashboard endpoint |

### Projects
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/projects` | List all active projects |
| POST | `/api/v1/projects` | Create a new project |
| PATCH | `/api/v1/projects/:name` | Rename a project |
| DELETE | `/api/v1/projects/:name` | Archive a project |
| POST | `/api/v1/projects/:name/restore` | Restore an archived project |
| GET | `/api/v1/projects/archive` | List archived projects |
| POST | `/api/v1/projects/purge` | Purge expired projects |

### Skills
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/skills` | List all skills |
| GET | `/api/v1/skills/:name` | Get a skill by name |
| POST | `/api/v1/skills` | Create a new skill |
| PATCH | `/api/v1/skills/:name` | Update a skill |
| DELETE | `/api/v1/skills/:name` | Archive a skill (soft-delete) |
| GET | `/api/v1/skills/search?q=...` | FTS5 search across skills |

### Observations
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/observations` | List observations |
| POST | `/api/v1/observations` | Store observation |
| GET | `/api/v1/observations/search?q=...` | FTS5 search |
| GET | `/api/v1/observations/stats` | Pipeline statistics |
| POST | `/api/v1/extraction/run` | Trigger server-side extraction |

### Personality
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/personality` | List traits |
| GET | `/api/v1/personality/profile` | Get aggregated profile |
| POST | `/api/v1/personality/:id/disable` | Disable trait |

### Synthesis
| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/v1/synthesis/run` | Trigger synthesis pipeline |
| GET | `/api/v1/synthesis/status` | Check pipeline status |

### Config
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/config` | Get project config |
| PUT | `/api/v1/config` | Update project config |
| POST | `/api/v1/config/sync` | Sync config from disk to DB |

### Email

All email routes are prefixed with `/api/v1/emails`. All email data is global (project-level scoping is ignored — email is always global).

> 🔴 `GET /accounts` by default returns only non-hidden accounts. Pass `?include_hidden=true` to include hidden accounts.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| **OAuth** | | |
| GET | `/accounts/oauth/url?provider=` | Get OAuth authorization URL |
| POST | `/accounts/oauth` | Exchange OAuth code for tokens |
| **Account Management** | | |
| GET | `/accounts` | List email accounts (`?include_hidden=true` for all) |
| POST | `/accounts` | Create a new email account |
| PATCH | `/accounts/:id` | Update account metadata (e.g., `{"hidden": true}`) |
| DELETE | `/accounts/:id` | Delete an email account (stops sync worker, clears cache) |
| POST | `/accounts/:id/test` | Test IMAP connection |
| **Email Reading** | | |
| GET | `/?account=&folder=&page=&limit=&refresh=` | List cached emails in a folder |
| GET | `/:uid?account=&folder=` | Get a single email by UID (body fetch with 12s timeout) |
| **Search & Triage** | | |
| GET | `/search?account=&folder=&q=` | Search cached emails by keyword/sender/subject/date |
| GET | `/triage?account=&limit=` | Triage unread emails (cache-only) |
| **Folders** | | |
| GET | `/folders?account=` | List IMAP folders (engine-first, cache fallback) |
| **Smart Replies** | | |
| GET | `/suggest/:uid?account=&folder=` | Smart-reply suggestions (cache-first, LLM-generated) |
| GET | `/summarize/:uid?account=&folder=` | LLM-generated email summary (cache-first) |
| POST | `/review-draft` | LLM-powered draft review and improvement |
| **Send & Draft** | | |
| POST | `/draft` | Save a draft email |
| POST | `/` | Send an email |
| **Move & Flags** | | |
| PATCH | `/:uid/move` | Move an email to another folder |
| PATCH | `/:uid/flags` | Set flags on an email |
| DELETE | `/:uid` | Delete an email (moves to Trash via IMAP) |
| **Attachments** | | |
| GET | `/:id/attachments/:attachmentId` | Download an attachment by part ID |
| **Sync Engine** | | |
| POST | `/sync` | Hint the sync engine to prioritize a folder |
| GET | `/sync-status` | Per-folder sync status from the engine |
| **IMAP Watcher** | | |
| POST | `/watch/start` | Start IMAP IDLE watcher for real-time monitoring |
| POST | `/watch/stop` | Stop IMAP IDLE watcher |
| GET | `/watch/status` | Get watcher status for an account |

### Jobs
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/jobs` | List all jobs |
| POST | `/api/v1/jobs/suggest` | Derive job config from description |

### Pipeline
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/pipeline/events` | List pipeline events |
| GET | `/api/v1/pipeline/timeline` | Get grouped timeline |

### Documentation (Docs Workspace)
All routes prefixed with `/api/v1/docs`. See [Docs Workspace Reference](../reference/docs-workspace.md) for the full 52-endpoint catalog.

## Data Flow

```
Dashboard → HTTP → API → Core → SQLite
MCP Server → HTTP → API → Core → SQLite
Email Client → OAuth2 + Gmail REST API / SMTP → Gmail Provider
```

### API-First Frontend
- Dashboard imports ZERO core/server code. All data via HTTP to API.
- MCP server talks to the API over HTTP. Zero DB access.

### Response Format

**Success:**
```typescript
{ "data": T, "total"?: number }
```

**Error:**
```typescript
{ "error": { "code": string, "message": string } }
```

## Related Docs
- [Architecture](../concepts/architecture.md) — System architecture and data flow
- [Database](database.md) — Database migrations and WAL safety
- [Variables](variables.md) — Environment variables
