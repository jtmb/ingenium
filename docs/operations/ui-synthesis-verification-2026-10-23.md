# Independent UI and synthesis verification

This follow-up checks a genuinely new free Zen chat and independent UI workflows. Model mappings, variants and saved defaults remain unchanged. All development stays in the current Codex window.

Current follow-up, October 25: [skill/Zen recovery results](skill-zen-recovery-2026-10-23.md) supersede the upload-permission and synthesis blockers below. Upload/edit/reload passes, and the unchanged Beam Free model completed the retained batch, generated a grounded proposal, and passed UI approval/activation and persistence checks. A separate fresh chat also passed. The original verification evidence below is retained as history; broader integration coverage is unchanged.

## Verified before the follow-up build

- A newly created, empty chat sent one prompt to OpenCode Zen / Beam Free and received its exact unique marker. The persisted session contains one user message and one newly generated assistant message, with no tool calls. Desktop and mobile screenshots were reviewed.
- An isolated QA project was created through the UI. Tasks passed create, edit, persistence after reload, Board/List/Timeline navigation, and positive/negative search.
- An actual synthesis attempt in that isolated project remained pending with `TRAIT_LLM_UNAVAILABLE`; that project has no authorized automation runtime. This is not a synthesis pass.
- In the existing Ingenium workspace, the enable-learning UI action failed because the local runtime's idle lease had expired, despite the compatibility page showing ready.

## Corrections

The explicit, recently confirmed workspace-owner action can renew an expired idle lease, bounded by the existing absolute expiry. It does not replace credentials, revive revoked grants, bypass workspace/member/epoch checks, or extend the absolute lifetime. Core callers retain strict lease validation unless the server supplies the renewal policy.

The cockpit now reports that synthesis has started and points to Pipeline. Accepting a background request no longer claims completion.

## Deployment and source validation

The 49 focused runtime route/automation tests and two synthesis action tests passed. Core, API and dashboard type checks passed. Denied callers, revoked bindings/grants, expired absolute lifetimes, inactive principals and unrelated workspaces remain covered. The exact build source's production dependency audit reports zero findings; the runtime image omits its lockfile, so an in-container `npm audit` is not represented as a successful check.

The deployed image is `ingenium-ingenium:release-20261023-56d706c26edb`, built from `ffdd3c79c8ee7da3a5c1be79b89c5b0221e4781e`. It became healthy in 32 seconds. All existing mounts and port bindings were preserved. Protected native configuration and trusted application code checks passed. Fourteen model/configuration/profile source files and the production projected configuration remained byte-for-byte unchanged. Subsequent changes to this report do not change the runtime code.

The actual enable-learning UI now succeeds after account confirmation, including renewal of the previously expired idle lease. The actual synthesis trigger shows “Synthesis started. Check Pipeline for results.”

## Actual provider results

At 01:12 UTC on October 24, a genuinely new empty chat received its exact unique reply from Zen / Beam Free. There was exactly one prompt request and the assistant message was created during this test. This is new inference proof, not reloaded historical content.

At 01:37 UTC, real background synthesis in the authorized Ingenium workspace did **not** complete. The broker created a session using the unchanged `opencode/beam-free` selection and the existing tool-denied synthesis agent. A bounded diagnostic reproduced native `provider.auth`, HTTP 403: “OpenCode's free tier can only be used from within OpenCode.” The synthesis batch remained at `created` with `TRAIT_LLM_UNAVAILABLE`; no trait or proposal was generated. No restriction was bypassed and no alternate model was selected.

At 01:39 UTC, a second genuinely new chat reported “Free usage limit reached.” Both the earlier successful fresh reply and the later quota failure are retained. The earlier pass does not establish current free-provider availability.

## Independent UI coverage

Each area was opened in a separate authenticated browser context with its project selected explicitly where applicable. The table distinguishes exercised controls from unverified integrations or mutations. It does not claim every branch of every feature passed.

| Area | Actual checks | Remaining limitation |
|---|---|---|
| Home | Refresh pause/resume; real synthesis trigger and queued feedback | Synthesis provider rejection |
| Chat | New empty session, one prompt, unique new reply; desktop/mobile review; second new-session retest | Free usage quota now reached |
| OpenCode | Web/CLI switching with visible embedded interfaces | No development or model changes performed there |
| VS Code | Actual editor workbench and fullscreen enter/exit | Optional vendor WASM/auth assets return existing 404s |
| Mail | Account picker and custom account setup form | No account configured; send/receive, OAuth and AI mail workflows unverified |
| Tasks | Create with status/priority, edit/save, reload, Board/List/Timeline, positive/negative search | Owned fixture only; dispatch and notification delivery unverified |
| Docs | Create, edit/save, reload persisted content, page search | AI, attachments, comments, history and publishing not exhaustively tested |
| Skills | Actual Markdown upload attempted; actual synthesis attempted | Upload fails with protected-directory EACCES; no generated proposal to review |
| Agents | Existing agent detail | Creation/editing omitted to preserve existing agent/model configuration |
| Observations | Status/type filtering and owned observation detail | Synthetic fixtures seeded through API, not claimed as UI creation |
| Personality | Sort choices and trait detail | Existing user traits were not dismissed or edited |
| Context | Refresh, fresh conversation index, actual unique reply/checkpoint content | Saved-memory mutation not repeated in this UI batch |
| Pipeline | Event-source filtering, failed-batch detail, polling pause/resume | No successful synthesis event/proposal |
| Jobs | Independent Jobs/Event queue/Trusted events tabs; empty-form validation | QA project has no execution agent; schedule/dispatch not proven |
| Backups | Completed backup listing and schedule controls | Create invokes retention; production restore/delete not performed on user data |
| Logs | Positive/negative message search | Read-only controls |
| Usage | Date preset and real nonempty CSV download | Existing telemetry freshness warning remains |
| Status | Live API service detail and process logs | Detail overlay is visible; exhaustive accessibility testing not performed |
| Projects | UI create, search, details, archive and archived-list confirmation | Only the owned QA project was archived; records preserved |
| Organizations | Membership/project-access controls and empty invitation form | No external invitations or existing permission changes |
| Plugins | Required-field guard and cancel | No executable plugin installed for testing |
| MCP Servers | Real tool catalog tab, refresh, empty-registration guard | No new child process/server registered |
| Config | Project/global/provider tabs and parsed configuration | No Save, provider selection or model mutation |
| Secrets | Sealed-vault dialog and empty-passphrase guard | Passphrase unavailable; secret CRUD unverified |

The initial rapid inventory hit rate limits. Functional checks were paced and the affected controls retested; server limits were preserved. Test selector mismatches for the home toggle, status overlay and plugin input were corrected and retested successfully. The optional missing Docs draft returns 404 and did not prevent save/reload/search.

## Remaining release blockers

1. Free Zen currently limits new chat use, and rejects the tested hidden synthesis-agent request with HTTP 403. A completed batch, generated proposal and approval/activation are **not verified**.
2. Non-global skill upload commits its database row and then fails to project files into the root-owned `/app/.opencode/skills` directory. This is a real functional defect; changing the protected directory's ownership would weaken the deployed trust boundary. A writable, persistent resource projection needs a scoped fix and end-to-end validation.
3. Mail, secret storage operations and other integration-dependent mutations above lack the required configuration or credentials. Readable pages and enabled controls do not establish those integrations work.

The isolated QA project is archived with its records retained. The three explicitly synthetic Ingenium observations and failed durable batch are retained as reproducible failure evidence; no existing user observations were pending when that batch was created, and no existing traits were changed by it. Batch membership prevents deleting those observations independently. A supported cancellation/recovery path should be included with the remaining synthesis work rather than editing production SQLite directly.

The two scoped corrections are accepted. **Full release acceptance remains blocked; “all features work” and “skill synthesis works” are not established.**
