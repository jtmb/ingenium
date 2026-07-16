/**
 * ingenium-email — Full email engine: IMAP/SMTP, OAuth2, triage, response suggestions, IMAP IDLE, DB-backed sync.
 *
 * @module ingenium-email
 *
 * This package provides a complete email integration layer including:
 * - IMAP connection pool with OAuth2 and app-password auth
 * - SMTP sending via nodemailer
 * - Gmail REST API provider (delta sync via historyId)
 * - Mail Provider interface for pluggable backends
 * - OAuth2 token management (Google, Microsoft) with AES-256-GCM encryption
 * - RFC 2822 MIME parsing with HTML sanitization
 * - Email triage (keyword-based categorization + priority scoring)
 * - Response suggestion engine (skill pattern-matching + LLM-powered)
 * - Background sync engine with priority queue (P0–P5)
 * - IMAP IDLE watcher for real-time notifications
 *
 * 🔴 All account data lives in the global project — `projectId` parameters are
 *    accepted for backward compatibility but ignored.
 */

export * from "./lib/types.js";
export * from "./lib/providers.js";
export * from "./lib/providers/mail-provider.js";
export * from "./lib/providers/gmail.js";
export * from "./lib/providers/gmail-api.js";
export * from "./lib/imap.js";
export * from "./lib/smtp.js";
export * from "./lib/parser.js";
export * from "./lib/accounts.js";
export * from "./lib/oauth.js";
export * from "./lib/triage.js";
export * from "./lib/responder.js";
export * from "./lib/watcher.js";
export * from "./lib/sync.js";
export * from "./lib/sync-engine.js";
export * from "./lib/suggest-llm.js";
