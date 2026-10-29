# Veyra MVP visual review

Updated 2026-10-29. This is a review inventory, not visual approval or full feature acceptance. The original 47 baseline images and 74 legacy dispositions are unchanged. Actual screenshots remain operator-private; their identifiers/hashes and the local companion locate the proof without publishing installation data.

The historical 47-view fixture archive has verified image hashes, including loading, empty and error presentations; some captures predate the latest Home composer. Current immutable-image live captures cover the observations below. Fixture pages do not qualify live providers or mutations. The full machine-readable inventory is [veyra-mvp-review.json](../design/veyra-mvp-review.json).

## Shared normalization proposed for approval

Use one dark shell, the selected blue mascot, centered Chat/Work toggle, quiet collapsed Chat rail and grouped expanded feature navigation. Keep real project/model/data labels rather than the drawings' sample values. Many Settings categories link to existing full feature/account workspaces. These choices need explicit visual review; they do not waive missing controls. Home Needs Attention, global search, appearance controls, mic and other additions stay tracked.

## User-directed Chat composer revision

The 2026-10-29 composer reference supersedes the earlier pending compact Chat direction. Use its wide rounded input, aligned attachment/model/microphone/send controls, centered welcome heading and quiet suggestion rows while keeping Veyra's existing charcoal surfaces, blue accent and colour tokens. The supplied reference's private email/task examples are not application content. Dictation remains visibly unavailable until implemented. Home keeps its separate composer.

The standard and Fast native model selections must remain distinct even when OpenCode reports the same underlying API model ID. The saved standard openai/gpt-6-luna choice must display GPT-6 Luna; Fast remains an explicit alternative. This revision is pending review and does not accept the 47-view inventory or close unfinished functional gates.

## Contracted views

| View | Route | Live captures | Current disposition / remaining gate |
|---|---|---:|---|
| home | / | 2 | Needs Attention review/job actions and complete Home composition remain open.
| chat-reference-v3 | /chat | 2 | Microphone, global search and full keyboard/scaling behavior remain open.
| opencode-upstream-actual | /opencode | 1 | Actual upstream UI and fresh pinned skill loading passed; individual external capabilities remain separate gates.
| vscode | /vscode | 1 | Actual code-server loaded in its existing Restricted Mode; no trust change was made.
| mail | /mail | 1 | Fresh background sync completed for four folders; new send/receive and smart replies remain Phase 2 gates.
| tasks | /tasks | 1 | Existing board rendered; complete create/edit/transition/dependency persistence remains open.
| docs | /docs | 2 | Existing saved verification page reopened; editing, publish, RAG and attachments require independent workflows.
| skills | /skills | 2 | Existing nine-skill library rendered; complete upload/edit/archive/restore/proposal lifecycle requires Phase 2 verification.
| agents | /agents | 1 | Existing profiles rendered; model examples do not authorize changing profiles.
| observations | /observations | 1 | Existing records and detail rendered; complete edit/archive/isolation workflows remain open.
| personality | /personality | 1 | Existing 23 active and 103 archived traits rendered; full lifecycle remains open.
| context-current-v2 | /context | 1 | Current empty memory/conversation state rendered; refresh/upload/search/checkpoint/restore-as-new remain explicit gates.
| pipeline | /pipeline | 1 | Existing pipeline rendered; full synthesis to approval, activation and fresh-chat use remains open.
| jobs | /jobs | 1 | Existing Jobs/Event queue/Trusted events rendered; run logs/output/approval/Vault audit require independent workflows.
| backups-current-v2 | /backups | 1 | Existing backup management rendered; isolated restore and schedule workflows remain open.
| logs | /logs | 1 | Existing logs rendered; filtering/export and recovery behavior remain open.
| usage | /usage | 1 | No project mapping, zero requests and no sync timestamps; attribution/sync remains an explicit functional gate.
| status-current-v2 | /status | 1 | Twelve runtime and four application service entries rendered; each feature still needs independent workflow evidence.
| projects | /projects | 1 | All five existing project identities survived replacement; complete lifecycle/isolation remains open.
| organizations | /organizations | 1 | Existing workspace rendered; invitation/account/isolation behavior remains open.
| plugins | /plugins | 1 | Existing plugin workspace rendered; lifecycle and permissions remain open.
| mcp-current-v2 | /mcp-servers | 1 | One child server and 264 discovered tools rendered; full tools/lifecycle/scope/browser preset/Vault references remain open.
| config-current-v2 | /config | 1 | Actual existing configuration rendered; validation and mutation workflows remain open.
| secrets | /secrets | 1 | Initial sealed/admin-verification state captured; existing Vault recovery later passed via normal API. Consumers/rotation/audit remain open.
| settings-account | /account | 2 | Settings links to the actual Account workspace; inline baseline layout differs.
| settings-general-v2 | /settings | 1 | Existing System theme and seven-day project retention rendered; depicted typography/motion controls remain open.
| standalone-doc | /standalone | 1 | Standalone space picker returns to the saved document; inline standalone editing and pop-up behavior remain open.
| mail-detail | /mail/[id] | 1 | Owned existing verification message opened; cached body persistence is distinct from fresh sync.
| mail-oauth-callback | /mail/oauth/callback | 0 | Controlled fixture/error presentation only; no new authorization or provider consent flow was attempted.
| observation-detail | /observations/[id] | 1 | Existing detail rendered; record mutations remain unverified.
| oidc-callback | /auth/oidc/callback | 0 | Controlled fixture/error presentation only; actual cross-origin desktop identity-provider flow remains open.
| bootstrap | /bootstrap | 0 | Controlled fixture/auth presentation only; existing production account was preserved.
| forgot-password | /forgot-password | 0 | Controlled fixture only; no reset message sent.
| invitation | /invitation | 0 | Controlled fixture only; no invitation accepted or sent.
| login | /login | 0 | Saved existing development login passed in API, native WebView and browser; complete auth visual approval remains open.
| mfa-clean-v2 | /mfa | 0 | Controlled fixture only; no new factor enrollment or credential change.
| reset-password | /reset-password | 0 | Controlled blank new-password form only; no credential entered or changed; actual reset workflow remains open.
| verify-email | /verify-email | 0 | Controlled fixture only; no new verification message or account change.
| chat-conversation-v3 | additional state | 1 | Live Luna send, navigation recovery, cancel, history and reload passed; New conversation URL identity remains open.
| navigation-all-features-v4 | additional state | 0 | All existing route groups remain discoverable; global search, recent-item and normalized widths require visual approval.
| context-saved-memory | additional state | 0 | No saved memory selected; edit/forget behavior and baseline composition remain open.
| settings-security | additional state | 1 | Account security workspace/anchor rendered; no password or MFA change.
| settings-sessions | additional state | 1 | Account sessions workspace/anchor rendered; no other session revoked.
| settings-api-tokens | additional state | 1 | Account token workspace/anchor rendered; no token created or revoked.
| settings-providers-schedule-v2 | additional state | 1 | Requested Chat/synthesis Luna selection persisted through replacement; one-hour provider schedule, empty secondary and other provider settings preserved.
| settings-cloudflare | additional state | 1 | Existing information-only connector resumed with existing Vault credential; homepage/privacy/terms 200 and private routes 404.
| settings-mail | additional state | 1 | Existing OAuth configuration and retention rendered; no provider credential/consent change.

## Additional Windows states

Eight hash-verified actual native states were personally reviewed: connection, library, selected Windows project, selected WSL project, executed Windows terminal output, executed WSL terminal output, reconnect and closed terminal. [Proposed Windows view record](../design/veyra-windows-mvp-views.json) binds each to its GUI hash, size and capture time. First-run/service recovery, creation dialog, tray/whole-service exit and scaling/focus still need targeted coverage. The existing 47 route baselines alone cannot accept these platform flows.

## Approval boundaries

Visual approval remains false for every view. Review the concrete shared-shell normalizations and proposed Windows states; retain all listed functional gates for subsequent phases. No baseline rewrite, page-load count or fixture success closes a workflow gate. Both source/runtime verification and platform limitations remain in [the MVP report](veyra-mvp.md).
