# Visual QA Validation Protocol

## Mandatory Gates

After UI implementation plus normal QA, test, and deployment verification, the orchestrator MUST dispatch `@ingenium-qa-vision` for every changed UI route. The agent must inspect each route at 1440x900 and 390x844, capture descriptive screenshots, inspect DOM/accessibility state, check keyboard/focus behavior, and report console errors and non-2xx network responses.

Before final completion or commit, the orchestrator MUST dispatch a safe, non-mutating full-site desktop/mobile sweep of every primary route at the same viewports. Do not submit forms, save, delete, authenticate, or invoke data-changing controls.

The agent returns PASS, FAIL, or BLOCKED with exact evidence. FAIL or BLOCKED blocks completion: route the problem to a writer, then re-run visual QA for the affected route. The agent closes its browser before returning.

## Luna Smoke Test After Restart

After OpenCode restarts, invoke `@ingenium-qa-vision` against a known non-sensitive PNG or safe dashboard state. If it cannot inspect the image or browser output, it must return BLOCKED. The orchestrator must stop and reconfigure visual QA rather than recording a PASS.
