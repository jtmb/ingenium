
2026-07-10 | pattern | Test fix: `ingenium-core` mock with store Map must sync `getDb().prepare().run()` DELETE back to the store. Otherwise `removeAccount` test fails because settings still sees the deleted entry. | tests/oauth.test.ts, tests/accounts.test.ts [IMPORTED]

2026-07-10 | pattern | Test fix: OAuth tests mocking `ingenium-core` need full mock (settings.getSetting, settings.setSetting, getDb with prepare/run/all). exchangeCode calls state validation (getSetting) then state deletion (prepare/run). Seed a state via setSetting before calling exchangeCode to bypass CSRF check. | tests/oauth.test.ts [IMPORTED]

2026-07-10 | insight | AES-256-GCM requires 32-byte (64 hex char) key. Test key "abcdef0123456789abcdef0123456789" was 32 hex chars (16 bytes). Fixed to 64 hex chars for AES-256-GCM compliance. | tests/oauth.test.ts, tests/accounts.test.ts [IMPORTED]

2026-07-10 | pattern | Test fix: When production code adds javascript: href sanitization, update test from toContain("javascript:") to notContain("javascript:") and remove "KNOWN LIMITATION" comment. | tests/parser.test.ts [IMPORTED]
