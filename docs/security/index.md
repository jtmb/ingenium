---
title: Security Documentation
description: Security documentation including credential management, iframe sandboxing, and threat models.
---

# Security

Security documentation and procedures for the Ingenium system.

## Pages

| Document | Description |
|----------|-------------|
| [Credential Rotation](credential-rotation.md) | Git history secret remediation and credential rotation |
| [Iframe Sandbox](iframe-sandbox.md) | Iframe sandbox baseline configuration and risk assessment |
| [LLM Endpoint SSRF Protection](#llm-endpoint-ssrf-protection) | DNS-level validation of LLM provider endpoints, private-network blocking, and opt-in bypass |
| [Vault Security Model](#vault-security-model) | scrypt key derivation, AES-256-GCM envelope encryption, passphrase-is-key design, no recovery |

## LLM Endpoint SSRF Protection

**Source**: `packages/ingenium-core/lib/tools/endpoint-policy.ts`

All LLM provider endpoints are validated by `validateEndpointUrl()` before any HTTP request is made. The system uses a two-layer defense:

### Layer 1 — URL Parse
- Rejects non-HTTP(S) protocols
- Rejects URLs with embedded credentials (`username:password@host`)
- Rejects hostnames matching `localhost`, `*.localhost`, or private IPv4/IPv6 ranges (10.x, 172.16-31.x, 192.168.x, 127.x, ::1, fc00::/7, etc.)

### Layer 2 — DNS Resolution
- Resolves the hostname via `dns.lookup` with `{ all: true, verbatim: true }`
- Rejects if ANY resolved address falls in a private range
- Prevents DNS rebinding: the hostname is re-resolved on every call

### Safe Fetch
`safeLlmFetch()` wraps every LLM HTTP request with:

1. **Pre-request validation** — calls `validateEndpointUrl()` before the fetch
2. **Redirect following** — follows HTTP redirects (up to 10) and validates each redirect target via `validateEndpointUrl()`
3. **Timeout** — configurable via `EndpointPolicyOptions.timeoutMs` (default 60s) using `AbortSignal.timeout`

### Opt-in for Local Endpoints
Set `allowPrivateNetwork: true` on the provider block to bypass private-address rejection. This is required when using local inference servers (Ollama, LM Studio, vLLM on localhost). See the [synthesis configuration](../configure/synthesis.md) docs for the security warning.

### Usage Across the System

`validateEndpointUrl` and `safeLlmFetch` are used by:
- **Provider config save** — `PUT /api/v1/settings/provider-configs` validates `baseURL` on every provider
- **Legacy LLM config save** — `POST /api/v1/settings/llm-config` validates primary and backup endpoints
- **LLM test connection** — `POST /api/v1/settings/test-llm` validates the ad-hoc endpoint
- **Synthesis pipeline** — `synthesis-llm.ts` uses `safeLlmFetch` for all LLM calls
- **Email suggestions/summaries** — `suggest-llm.ts` and `emails.ts` route
- **Docs AI** — `docs-ai.ts` LLM calls
- **Job suggestions** — `job-suggest-llm.ts`
- **Observation extraction** — `extraction.ts` LLM calls

## Vault Security Model

**Source**: `packages/ingenium-core/lib/tools/vault-crypto.ts` and `vault.ts`

The vault uses a **passphrase-is-key** design with no recovery mechanism. If the passphrase is lost, all secrets are irrecoverably lost.

### Key Derivation (scrypt)

- Passphrase is combined with a random 32-byte salt
- Derivation uses scrypt with parameters: `N=16384, r=8, p=1`
- Output is a 256-bit master key
- A SHA-256 HMAC tag is stored at initialization to verify passphrase correctness on unseal (constant-time comparison via `timingSafeEqual`)

### Envelope Encryption (AES-256-GCM)

Each vault item is encrypted with its own **data encryption key (DEK)**:

1. A random 256-bit DEK is generated via `crypto.randomBytes(32)`
2. The plaintext secret is encrypted with the DEK using AES-256-GCM (12-byte IV, 16-byte auth tag)
3. The DEK is **wrapped** (encrypted) with the master key using a second AES-256-GCM operation
4. Both the ciphertext and wrapped DEK are stored in the `vault_items` table
5. The DEK is zeroed in memory immediately after use

This means:
- The master key alone cannot decrypt items without unwrapping each DEK
- Each item has a unique DEK — a compromised DEK compromises only one item
- Re-keying (passphrase change) re-wraps all DEKs without re-encrypting item data

### In-Memory Key Management

- The master key is stored **only in process memory** (a `Buffer` in the Node.js heap)
- `sealVault()` zeroes the key buffer with `key.fill(0)` and sets it to `null`
- The key is never written to disk in any form
- A new `vault_config` row with fresh salt and HMAC tag is the only initialization artifact

### Audit Trail

All vault operations are logged to `vault_audit_log`:
- `vault_initialize` / `vault_unsealed` / `vault_sealed` / `vault_unseal_failed`
- `secret_created` / `secret_read` / `secret_updated` / `secret_deleted` / `secret_rotated`

### Important Security Properties

| Property | Detail |
|----------|--------|
| **No recovery** | There is no backdoor, password reset, or recovery key. Loss of passphrase = loss of all secrets. |
| **No plaintext on disk** | Secrets are encrypted before reaching the DB. `vault_items.encrypted` is always ciphertext. |
| **Soft-delete** | Deleting an item sets `access_policy` to `{"mode":"deleted"}`; the ciphertext remains in the DB until a future purge. |
| **Audit immutability** | Audit log is append-only; entries are never modified or deleted. |
