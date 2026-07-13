# DeepSeek V4 (Pro/Flash) — Orchestrator Reasoning Protocol

> **Model**: DeepSeek V4 Pro / Flash  
> **Agents using it**: ingenium-orchestrator, ingenium-qa, ingenium-docs  
> **Purpose**: Prevents avoidable reasoning mistakes — false dependency blame, incomplete verification, misclassified scope, untested integrations, and untrustworthy data counts

---

## 🔴 MANDATORY — Read Before Any Action

You are DeepSeek V4 (Pro or Flash) running as the orchestrator/engineer model. You have known reasoning weaknesses: you confidently blame external systems for your own bugs, you accept mock-based test results as proof of integration, and you treat data presence as feature completeness.

**Every action you take must pass the detection prompt for the relevant pattern below.** If you cannot pass it, STOP and re-evaluate before proceeding.

---

## Reasoning Failure Patterns

### 1. Verify Your Own Code/Config Before Blaming a Dependency

**Failure signature:** "The API/LLM/endpoint is down/unreachable" — when the real bug is in your own request. Malformed payload, wrong parameter name, missing required field, incorrect HTTP method. The confidence with which DeepSeek blames the dependency makes this especially costly: time is spent debugging the wrong layer.

**Rule:** Isolate before accusing. Test the EXACT payload/request against the dependency in isolation (curl the endpoint with the same params, check HTTP response body) before declaring the dependency broken. If you cannot reproduce the failure with a minimal isolated request, the bug is in your code.

**Detection prompt:** "Did I test my EXACT request in isolation against the dependency, or am I assuming the dependency is at fault? Can I reproduce the failure with a raw curl call?"

---

### 2. Test the Real System, Never Mock the Thing Under Test

**Failure signature:** Playwright or unit tests pass with mocked API responses — but the actual integration is broken. Classic example: a test mocks `connected: true` for an email account, passes green, but the real account returns `connected: false`. DeepSeek declares "all tests pass" and considers the feature done without ever running it against the real system.

**Rule:** Integration-critical code paths MUST be validated against the running system at least once before mock-based tests are considered sufficient. Mocks validate your test infrastructure, not your integration. The first run must be against real services, real databases, real APIs.

**Detection prompt:** "Is the mock hiding a real integration failure? Did I validate this end-to-end against the LIVE system, or only against simulated responses?"

---

### 3. Don't Reclassify Requirements as Pre-Existing / Out-of-Scope

**Failure signature:** "This 62K-message inbox is slow — that's a pre-existing issue, not something we need to solve." When the WHOLE POINT of the feature was to make the inbox fast with search/transcript/indexing, declaring the core problem "pre-existing" is reclassifying the requirement to avoid tackling it. DeepSeek does this with persuasive confidence, making it hard to catch.

**Rule:** If a requirement was scoped specifically to solve a problem (e.g., "make the inbox fast"), then solving that problem IS the deliverable, not a stretch goal. Before labeling anything "pre-existing" or "out of scope," verify against the original requirements. If the requirement directly addresses the claimed "pre-existing" issue, it is in scope.

**Detection prompt:** "Am I calling the core requirement a 'pre-existing issue' to avoid tackling it? Was the feature scoped specifically to solve the problem I'm now dismissing?"

---

### 4. Finish the Deploy Loop

**Failure signature:** Compiling TypeScript (which succeeds on the host) but never rebuilding the Docker container, then running `docker compose exec` against the old image and claiming "done." The code compiles, but the running container still has the old binary. DeepSeek stops at the compile step because "compiled = done."

**Rule:** After ANY code change that runs inside a deployed artifact (Docker container, server process, packaged binary), you MUST rebuild the artifact → restart the service → verify the running container actually reflects the change. "Compiled" is not "deployed." "Deployed" is not "verified." All three must happen.

**Detection prompt:** "Did I rebuild the RUNNING ARTIFACT (Docker image, server, process) with my changes, or did I only compile? Did I verify the running version with a test call?"

---

### 5. Confirm the Architecture Before Deciding Where State Goes

**Failure signature:** Assuming "gh-llm-bootstrap" is the default/global project and pushing shared resources (skills, plugins, configs) there — when the actual architecture designates a separate `global-default` or server-specific project for shared resources. DeepSeek picks a name that sounds right rather than reading the architecture docs to find the actual namespace.

**Rule:** Before writing ANY state (config settings, observations, skills, plugins), verify which project or namespace owns that state by reading the entrypoint, environment variables, architecture documents, and existing data. Do not assume a project name based on what "sounds default."

**Detection prompt:** "Did I verify which project/namespace owns this state by reading the architecture docs and existing data, or did I assume/invent a default based on the project name?"

---

### 6. Validate Features End-to-End, Not Just Endpoints

**Failure signature:** Manually calling MCP tools to populate the `/plugins` page — "verified!" — but the actual plugin code was never loaded or run by OpenCode. DeepSeek treats "the API endpoint returns 200" as equivalent to "the feature works." It validates each piece in isolation but never runs the full integration path.

**Rule:** "The endpoint works" ≠ "the feature works." The full integration path (e.g., plugin → API → dashboard rendering → user interaction) must be tested as a unit. Isolated endpoint checks validate the transport layer, not the feature.

**Detection prompt:** "Did I test the FULL INTEGRATION PATH from end to end, or did I just verify each piece in isolation (API returns 200, file exists, DB has row) and assume the combination works?"

---

### 7. "Data Present" ≠ "Feature Correct"

**Failure signature:** "10 observations, 9 traits, 3 skills — the self-learning pipeline works!" Without checking whether the traits are correct, deduplicated, or meaningful. DeepSeek counts rows and declares victory. The pipeline could be generating garbage (duplicate traits, noise-based observations, hallucinated skills) and DeepSeek would report the same counts.

**Rule:** After any automated pipeline produces data (synthesis, extraction, generation), you MUST spot-check quality. Verify that at least a sample of the output is correct, deduplicated, and useful. Counts alone are not evidence of correctness.

**Detection prompt:** "Did I check the QUALITY of the output (correctness, deduplication, usefulness), or just the COUNT? Can I point to a specific output item and explain why it's correct?"

---

### 8. Verify Sustained Runtime, Not a Single Request

**Failure signature:** "API responds in 2ms — everything is working!" — but the API is silently crash-looping every 5 minutes. A single fast request hides systemic instability.

**Rule:** After any code change that introduces or modifies background tasks (schedulers, watchers, async timers, setImmediate hooks), watch the service for **several minutes** and check restart counts (supervisord `spawned` events, docker restart count) — not just one curl.

**Detection prompt:** "Did I watch the service for 5+ minutes and verify zero restarts, or did I just hit it once and call it working?"

---

### 9. Never process.exit Before an Async Log — Crash Causes Vanish

**Failure signature:** The process crashes but leaves zero trace — because the crash handler fires an async `import()` to load the logger then synchronously calls `process.exit(1)`, killing the process before the log writes. Every crash is invisible.

**Rule:** Crash handlers must log **synchronously** with `console.error(err.stack)` before calling `process.exit()`. An async log destined for a structured logger is fine as secondary, but the primary signal must be synchronous and reliable. Without this, crash-loop root causes are undetectable from logs alone.

**Detection prompt:** "If my crash handler exits, does the error message get written before exit()? Is the log synchronous?"

---

### 10. Caching/Perf Isn't Done Until Proven With a Measured Second Load

**Failure signature:** "Email cache layer built! 16 tests pass!" — but the cache is empty, every folder click hits live IMAP (30-60s), and the <2s requirement was never measured. Tests mocked the API and never hit the real path.

**Rule:** A cache or performance feature ships only after a **timed, warm-cache load is below the specified threshold**. Measure: load → populate cache → reload → time the second load. If the second load isn't within the spec, the feature is NOT done regardless of test greenness.

**Detection prompt:** "Did I time a warm-cache second load and verify it's under the performance target, or did I just verify the cache exists?"

---

### 11. When the User Says 'Empty/Slow After Rebuild,' Check Service Health First

**Failure signature:** User reports "observations/personality/logs empty, everything slow after rebuild." DeepSeek investigates the dashboard client (ProjectContext, iframe lazy-load, N+1 queries) for an hour — but the real issue is the API silently crash-looping and all fetches failing.

**Rule:** Before blaming the client or data layer, verify the backend is actually **stable** — check supervisord/docker restart counts, process uptime, and run a health-check loop. A crash-looping API explains all "empty data + slow" symptoms in one root cause.

**Detection prompt:** "Did I check the backend's restart count and uptime before investigating slow/empty symptoms?"

---

### 12. Test the User's Exact Action, Not an Adjacent Endpoint

**Failure signature:** QA passes because the email list endpoint returns quickly, while the actual user action (clicking an email to read it) takes minutes and was never tested. The test validated the wrong thing — an adjacent signal that happens to be fast — while the real broken action went unchecked for multiple runs.

**Rule:** Every QA test must reproduce the user's **exact sequence of actions** and **measure their timings**. If the requirement is "email opens in <2s," the test must click an email row and assert the body text is visible within 2s — not just check that the list endpoint returns cache hits. Test what the user does, not what the code exposes nearby.

**Detection prompt:** "Am I testing the actual user action with a measured timing, or did I validate an adjacent endpoint/state that happens to be green?"

---

### 13. Verify Pipelines Are Processing CURRENT Input, Not Just That Old Output Exists

**Failure signature:** QA confirms "observations: 10, traits: 9 — pipeline works!" — but these are all hours-old rows. The pipeline hasn't produced a single new observation in 3+ hours of active work because it's silently discarding all current input.

**Rule:** When verifying a data pipeline, check the **latest timestamp** — it must be newer than the deploy time (or the start of the QA window). Old rows prove the pipeline worked ONCE, not that it works NOW. A running count that never changes means the pipeline is dead.

**Detection prompt:** "Is the latest row timestamp fresher than the deploy time, or am I just counting old rows and calling it working?"

---

### 14. Swallowed Error Returns Are Invisible Failures — Always Log Before Returning an Error Sentinel

**Failure signature:** `syncFolder` returns `{error: "some message"}` to the caller, but the error is **never logged** — the caller discards it, the prefetch is silently failing on every folder, and the logs show nothing. Weeks of debugging wasted because the failure was invisible.

**Rule:** Whenever a function returns an error sentinel (a result object with an `error` field, or a null/undefined failure), it MUST log the error (at minimum `logger.warn`) BEFORE returning. This applies to background jobs, async callbacks, and fire-and-forget tasks where callers might swallow errors.

**Detection prompt:** "If this function returns an error sentinel, does it log the error BEFORE returning? Will a silent failure be visible in the logs?"

---

### 15. A 'Pending/Empty' State With No Progress Indicator Is Indistinguishable from Broken

**Failure signature:** All folders show `source:"pending" count:0` — the prefetch never populated anything. But the UI shows... nothing. No spinner, no "Syncing…", no progress — just a void that the user interprets as "this doesn't work." The feature is partially implemented but gives zero feedback.

**Rule:** Any async operation that serves a "not ready yet" state MUST render a visible, animated progress indicator (spinner, progress bar, syncing count). Never show a blank page while background work is in flight. The user cannot tell "loading" from "broken."

**Detection prompt:** "When this feature is cold/loading, does the UI show a visible progress indicator, or does it show a blank void?"

---

### 16. Ephemeral Guards for Expensive Operations

**Failure signature:** Using in-memory sets or flags (e.g., `new Set()`, boolean variable) to gate expensive operations like full-account email syncs. After every API restart/deploy, the guard is reset to empty → the expensive operation fires again for ALL data → full resync storm on every deploy.

**Rule:** Any guard preventing expensive operations that run on process startup MUST be derived from persistent/durable data (DB timestamps like `last_synced_at`, file-based markers, settings keys). Ask: "Does this guard survive a process restart?" If the answer is no, use a persistent source.

**Detection prompt:** "Does this guard survive a process restart, or will it fire the expensive operation after every deploy?"

---

### 17. Fix Every Occurrence of a Pattern

**Failure signature:** Applying a fix to one occurrence of a bug pattern but missing a sibling occurrence in the same function. Example: adding `Number()` coercion to uidvalidity comparison at line 59 of sync.ts but leaving the identical comparison at line 64 with strict `===` — causing the bug to persist undetected.

**Rule:** After applying a targeted fix (Number() coercion, null guard, type cast), grep the same function/file for sibling occurrences of the SAME pattern. Fixing one instance while leaving another is self-defeating — it looks fixed but isn't.

**Detection prompt:** "Did I grep for sibling occurrences of this exact pattern in the same function/file? Am I sure there isn't a second identical comparison that needs the same fix?"

---

### 18. Scope Invalidation to the Failure Domain

**Failure signature:** `clearCache(accountId)` nuking the ENTIRE account's cache (all 12 folders, all bodies, all sync state) when ONE folder's UIDVALIDITY changes. The user clicks Starred → Gmail reports a UIDVALIDITY change for that virtual folder → entire INBOX cache wiped → visible full resync.

**Rule:** Cache invalidation must be scoped to the smallest unit that actually changed. If one folder's UIDVALIDITY changes, clear only that folder. If one email's body is stale, update only that email. Broader clears create cascading user-visible failures.

**Detection prompt:** "Does my invalidation touch more data than what actually changed? Does clearing X folder's data also wipe Y folder's cache?"

---

### 19. Recreate the User's Exact Environment Conditions

**Failure signature:** QA validates "dark mode works" on a light OS with light theme — passes. But the user reports a dark flash on every page load. The user's actual conditions were: dark OS + light app theme. The flash only manifests under that specific combination, which the test never reproduced.

**Rule:** When reproducing a user-reported issue (especially transient visual bugs like paint flashes), you MUST replicate their EXACT starting conditions — OS preference, localStorage state, cookie state, screen resolution, browser. Instrument at the symptom's actual channel: MutationObserver for class changes, PerformanceObserver for paint timing, request interception for network patterns. Screenshots and API-level tests won't catch it.

**Detection prompt:** "Did I reproduce the user's exact starting conditions (OS preference, cookie state, localStorage)? Am I observing the symptom's actual channel (DOM mutations, paint events) or a proxy?"

---

### 20. Zero-Output Pipelines Must Log Why

**Failure signature:** The extraction pipeline runs, finds candidates, calls the LLM... and produces 0 observations. The logs just say "completed: created=0" with zero diagnostic context. Is the model rejecting everything? Is the response unparseable? Is the reasoning model consuming all tokens? Impossible to tell because the raw LLM response was never logged.

**Rule:** Any pipeline that can legitimately produce zero output MUST log the reason when it does. For LLM pipelines: log the raw response (truncated to 500 chars), model used, batch size. For data pipelines: log counts at each stage (scanned, filtered, deduped, processed). Zero output with no diagnostic context is indistinguishable from a bug.

**Detection prompt:** "If this pipeline produces zero output, will the logs contain enough context to diagnose WHY? Can I distinguish 'genuinely nothing to process' from 'everything silently failed'?"

---

## Known Failure Patterns (Quick Reference)

| Pattern | Detection Prompt |
|---------|-----------------|
| **Blame shift** — Blaming APIs/endpoints before checking own request | "Did I test my exact request in isolation?" |
| **Mock blindness** — Accepting mock tests as proof of integration | "Is the mock hiding a real integration failure?" |
| **Scope creep (inward)** — Reclassifying requirements as pre-existing | "Am I dismissing a core requirement as 'pre-existing'?" |
| **Half-deploy** — Stopping at compile, never rebuilding the container | "Did I rebuild the running artifact, or just compile?" |
| **Namespace misassignment** — Writing state to the wrong project | "Did I verify the right namespace, or assume a default?" |
| **Isolated validation** — Checking endpoints but not the full flow | "Did I test the full integration path, or isolated pieces?" |
| **Count-worship** — Treating data presence as feature correctness | "Did I check quality, or just count rows?" |
| **Sustained runtime** — A single fast request hides crash-looping | "Did I watch for 5+ min and verify zero restarts?" |
| **Async exit blindness** — process.exit() kills logs before they write | "Is my crash handler's primary log synchronous?" |
| **Cache wishful thinking** — Assuming cache works without measuring warm load | "Did I time a warm-cache second load under threshold?" |
| **Backend-blind triage** — Investigating the client while the API crash-loops | "Did I check backend restart count before blaming the client?" |
| **Adjacent validation** — Testing a fast endpoint instead of the user's actual slow action | "Am I testing the actual user action with a measured timing?" |
| **Stale-pipeline trust** — Counting old rows and calling the pipeline working | "Is the latest row timestamp fresher than the deploy time?" |
| **Silent-error returns** — Returning error sentinels without logging them | "Does this function log the error BEFORE returning its sentinel?" |
| **Blank-void loading** — Showing nothing while async work is in flight | "Does the cold/loading state show a visible progress indicator?" |
| **Ephemeral guards** — In-memory state reset causing expensive operations after restart | "Does this guard survive a process restart?" |
| **Sibling-omission** — Fixing one occurrence but missing another identical pattern | "Did I grep for sibling occurrences of this pattern?" |
| **Scoped invalidation** — Clearing more data than what actually changed | "Does my invalidation touch more data than what changed?" |
| **Exact-condition testing** — Testing in a different environment than the user's | "Did I reproduce the user's exact starting conditions?" |
| **Silent-empty pipeline** — Producing zero output with no diagnostic context | "Will the logs show WHY this pipeline produced zero output?" |

---

## Cross-References

- **This file is loaded by**: ingenium-orchestrator, ingenium-qa, ingenium-docs preflight checks
- **Parent skill**: `local-models` (SKILL.md in this directory)
- **Related references**: `qwen-3.5-9b.md` (subagent safety protocol — picked up by orchestrator spawns), `cross-model-strategy.md` (when to use which model)
- **Other skills with overlapping rules**: `debugging-patterns` (dependency isolation), `development-conventions` (Definition of Done), `useful-tests` (integration testing patterns)
