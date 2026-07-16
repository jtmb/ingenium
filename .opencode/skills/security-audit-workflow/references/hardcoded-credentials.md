# Hardcoded Credentials Detection

Security audits must detect and report hardcoded credentials across all domains.

## Critical Credential Types

### 1. JWT Tokens
- Location: opencode.json, config files, environment variables
- Impact: Complete authentication bypass
- Example: `"jwt": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."`

### 2. Email Encryption Keys
- Location: docker-compose.yml, .env files
- Impact: Data breach if exposed
- Example: `encryption_key: "secret123"`

### 3. API Authentication Defaults
- Location: config files, service definitions
- Impact: Unprotected endpoints
- Example: `auth_enabled: false` (defaults to disabled)

## Detection Rules

1. Scan all YAML, JSON, and environment files
2. Look for base64-encoded strings that decode to credentials
3. Check for hardcoded secrets in docker-compose.yml
4. Verify API auth is not optional/disabled by default