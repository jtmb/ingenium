# Learnings

Patterns and learnings discovered during project work. Used by the observer plugin as a fallback when the synthesis API is unavailable. Each entry captures a reusable pattern discovered through implementation or debugging.

---

## 2026-07-16 (commit af1a471)

### credential-failure-parking

When credential decryption fails, park the sync worker immediately rather than retrying. Do not return ciphertext as tokens. Discovered via gh-llm-bootstrap Phase 4.

### decode-tokens-never-returns-ciphertext

decodeTokens must throw on failure, never return encrypted data as if it were valid credentials. The previous silent-fallback turned AES-256-GCM ciphertext into garbage bearer tokens, causing infinite retry loops with repeated auth errors.

### selection-tokens-separate-from-surface

Use separate `--color-selection-bg/text` tokens for selected items (navigation, file tree, folder sidebar), keeping `--color-surface-selected` as a neutral surface color. This prevents blue-tinted selected states from clashing with neutral near-black themes like OpenCode's default dark mode.

### codemirror-destroy-on-host-change

When React remounts a CodeMirror host div due to a mode switch (e.g., source→split in a docs editor), always destroy the existing EditorView and create a new one. The old view stays attached to the destroyed DOM node, producing a blank editor in the new host element.
