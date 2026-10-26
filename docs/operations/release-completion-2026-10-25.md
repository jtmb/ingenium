# Ingenium release completion - 2026-10-25

The local compatibility release is accepted with the configured integrations and scope below. All development and review stayed in the current Codex window. OpenCode was used only as the product runtime; models, variants and saved defaults were preserved. Multichat orchestration remains cancelled.

## Fixed and migrated

- Manual/app-password Mail background synchronization now uses IMAP rather than requiring Gmail OAuth tokens. Workers own isolated connections, retain folder-specific UIDVALIDITY and reject bodies from a changed UID namespace. Gmail OAuth retains its existing REST provider.
- Private mail servers can use an operator-owned CA bundle through `INGENIUM_EMAIL_CA_FILE`. Public trust roots, certificate validation and hostname checks remain enabled. Invalid bundles fail closed.
- Mail lists refresh after background cache changes. Refresh queues the selected folder and keeps pending body/status polling alive. Long subjects now wrap within the mobile reader; all actions fit a 390-pixel viewport.
- Native migration reports completed. No further database migration source changes were needed. The usage collector's current authenticated source and verified `/workspace` native project are now explicitly mapped to the canonical dashboard project through the supported API: 6 sessions processed, 12 events imported, freshness now Fresh. The old mapping is preserved; 3 unrelated sessions remain quarantined rather than guessed into this project. Provider token/cost fields retain their partial/unavailable labels.

## Configured integrations

Mail is configured as `release@ingenium.test` against an authenticated, TLS-protected local SMTP/IMAP sandbox. A generated mailbox password and private CA were installed; the sandbox binds only the Docker bridge and does not forward internet mail. Its hardened system service starts automatically. A retained mailbox snapshot survived service restart with 8 test messages across INBOX, Drafts and Archive. This proves the local integration, not personal Gmail/Outlook authorization or production internet mail hosting.

The previously empty vault was reset only after the supported eligibility check proved no encrypted items or credential references existed. A generated passphrase initialized it. The mailbox credential is stored encrypted there. UI create, reveal, metadata edit/save, lock, reload and unseal passed; the same passphrase still decrypts the credential after image replacement. Owner step-up remains enforced. Secrets and recovery material are held in root-only local files, never in Git or this report.

## Independent UI acceptance

Each route was opened in an independent authenticated browser context. All 26 routes loaded without unexpected page/API errors: Home, Chat, OpenCode, VS Code, Mail, Tasks, Docs, Skills, Agents, Observations, Personality, Context, Pipeline, Jobs, Backups, Logs, Usage, Status, Projects, Organizations, Plugins, MCP Servers, Config, Secrets, Settings and Account. Embedded VS Code's actual workbench loaded. Twenty Settings panels were checked independently, including validation without changing saved model/provider settings.

| Feature | Real acceptance evidence |
|---|---|
| Fresh free Zen chat | A new empty session made one real prompt request using `opencode/beam-free` and returned the exact unique marker. No old assistant messages existed before the request. |
| Skill synthesis and upload | The [accepted recovery](skill-zen-recovery-2026-10-23.md) proves upload/edit/reload, the unchanged Beam Free synthesis batch, grounded proposal, UI approval/activation and persistent three-file projection. Its source remains unchanged in this image. |
| Mail | Authenticated TLS connection, actual UI send and receive, positive/negative search, HTML body and reload persistence, saved draft and reload, reply, forward composer and archive passed. Mobile reader bounds and screenshot reviewed on the final image. Forward was inspected and discarded, not sent. |
| Vault | Generated configuration, encrypted credential storage and UI lifecycle above; persistence rechecked on the final image. |
| Tasks | Create, edit, reload, search and Board/List/Timeline passed in an owned QA project. |
| Docs | Create, edit, reload, search, attachment upload/download, tag add/remove, comment/reply/resolve, history preview/restore and publish passed. |
| Jobs | Create, edit, disable, reload and delete passed for the owned test job. No execution agent/model was changed or job dispatched. |
| Account | Scoped token created through UI after step-up: permitted read 200, forbidden write 403, UI revoke followed by 401. The key was never logged or retained. |
| Usage | Explicit migration above imported real events and cleared stale freshness. Existing date/filter/CSV checks remain recorded. |

This coverage does not claim every branch of every integration. No external invitations, untrusted executable plugin installation, existing organization permission changes, model/agent edits, destructive production restore, or user-data purge was performed. Existing backup/restore continuity acceptance remains recorded in the earlier ledgers. Transient test rate limits were paced and rechecked; server limits were preserved.

## Validation and deployed identity

- 114 email tests and 23 affected dashboard tests pass. Email and dashboard type checks pass.
- Production dependency audit: **zero critical, high, moderate, low or informational advisories**. The previous 21 moderate findings were resolved in the [bootstrap/dependency follow-up](bootstrap-dependency-follow-up-2026-10-23.md).
- Protected configuration and trusted-core checks pass on the final image. The host's missing default Docker bridge was handled only for these loopback-only disposable checks with `--network none`; no assertion was weakened and Docker was not restarted. Builds used host networking.
- Final image: `ingenium-ingenium:release-20261025-ee83c21e95a8`.
- Image ID: `sha256:1ddd8b736c4ea3946c96ad1f46ce4f311164b4229b6b966a5622aca887f32c72`.
- Runtime source revision: `3fd93277533ea94c5b00cdc34e228beab29524dd`.
- Curated source SHA-256: `ee83c21e95a8f33d4c8d35063f147c081f2697589fc1c0be71cf94990c0f1162`.
- Composite readiness after final replacement: 32 seconds. All 14 mounts and published ports match the preceding candidate; the sole addition to the original 13 mounts is a read-only public mail CA file. All four named data volumes remain intact.
- Fourteen model/config/profile files and the projected production configuration match the preserved baseline. The three existing installation encryption/signing keys match their original hashes.

The image is labelled with its actual runtime build revision. Later acceptance documentation does not require a new runtime image. Publication is [PR #7](https://github.com/jtmb/ingenium/pull/7); its merged commit is the source publication record.

## Fixture and storage reconciliation

Only the owned QA document (page 71) and project `release-ui-qa-1792974457663` were archived, retaining their records. The owned job was deleted and scoped token revoked. The configured sandbox account, encrypted credential and test mailbox remain available. Original source, 35 unrelated dirty paths, existing records, historical evidence, rollback images and volumes were preserved.

One existing output root was reused: `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845` on the authorized Windows C: WSL filesystem. Beneath its `release-completion/` directory, these verified inactive outputs were removed:

| Removed path relative to that directory | Measured bytes |
|---|---:|
| `image-source/context` | 19,879,741 |
| `tmp` | 2,662,688 |
| `cache` | 31,068 |
| `build-appdata` | 0 |
| `build-localappdata` | 0 |
| Total | 22,573,497 |

The retained source manifest, pinned Git revision, lockfiles and build/test scripts regenerate these outputs. Original sources were hash-verified; no active process or container/namespace mount referenced the removed targets. Unique audit evidence was retained separately before cache cleanup. Linux filesystem free space increased from 624,821,673,984 to 624,850,210,816 bytes; concurrent writes mean this delta is not the measured deleted-file total. Windows C: free space was separately measured at 102,838,235,136 bytes. No Windows disk recovery is inferred from Linux deletion and no VHDX compaction was performed.

Retained exceptions: `release-completion/integration-runtime` is required by the active mail service, including its JRE, pinned jar, TLS keys, mailbox snapshot and generated credentials. Its reproducible 52,181,297-byte JRE download archive is retained because the parent directory is bound into an active service namespace; cleanup must not disturb that workload. The systemd unit symlinks and `/run/ingenium-release-mail/root` mount target are required installation pointers. `/var/lib/docker` contains shared build cache and active/rollback images with no exclusive ownership proof; no image/cache/volume prune was attempted. Pre-existing compatible dependencies in the shared curated checkout are likewise retained. Root-only private recovery files and unique success/failure receipts remain in the owned evidence root.
