# Projects and execution integration slice

Source-ready implementation for the approved parallel stream. This is not a deployed feature, a completed phase, a real PTY qualification or a production migration approval. The coordinator owns shared contracts, migrations, auth/router wiring, builds, release and attended verification.

## Implemented ownership boundaries

- `packages/veyra-projects/domain.mjs`: explicit Windows/WSL/cluster binding validation; workspace identity/mapping hash/owner instance/revision/epoch checks; no cross-host fallback; worktree recovery policy; bounded terminal replay.
- `packages/veyra-projects/contracts.d.ts`: proposed transport shapes. `context.mjs` preserves the existing conversation owner and explicit null project; no transcript store.
- `services/ingenium-api/lib/projects-v2/catalog.mjs`: API-owned folder/non-Git/multi-root catalog, stable IDs, scoped reads, pagination, CAS rename/pin/archive/restore and one-time attested root binding for imported projects. Rename never moves a directory.
- `native-catalog.mjs`: delegates native-owned projects to the existing native owner. It preserves native project IDs/revisions and instance identity; it does not create an API mirror. Root proofs come from the host adapter.
- `execution.mjs`: immutable request/scope snapshots before asynchronous admission; exact-request, scoped operation receipts before effects; repeated pending/unknown requests do not execute again; changed requests conflict. Read-only reconciliation queries the original owner receipt without dispatching effects. The existing host owner executes PTY/Git/worktree/setup effects with the original operation identity.
- `reads.mjs`: refreshed admission before terminal/output/actions/Git/worktree reads; bounded output with sequence/gap information. No second PTY or persistent output store.
- `installation.mjs`: installation preference facade over the retained legacy owner. `chat_defaults` and Docs `chat_selection` remain separate exact values. Secret keys are not exposed. Writes require the existing settings owner's CAS/admission implementation.
- `handlers.mjs`: unmounted authenticated-scope handlers, safe errors and 202 for pending/unknown outcomes. Existing auth must supply scope; request bodies do not choose actor ownership.
- Dashboard `projects-v2/`: controlled project/execution picker, terminal tabs/input/resize/close and run/setup/worktree controls. These consume real owner state and callbacks; no fixture success, auto-target selection or local project persistence.

`OwnerScope.ownerUserId` is the target record's ownership identity, not an unchecked caller field. The injected authorization closure must capture the actual authenticated principal and preserve current organization/project membership and capabilities. Shared project access must resolve the same owner scope; do not clone a row per collaborator.

`ProjectRef.archived` is authoritative for archive state. Native projects expose an archive boolean, so `archivedAt` stays null when no timestamp exists. Do not fabricate a native timestamp. `source` carries source system/instance/revision. Global aliases and the catalog do not confer execution permission.

## Integration contract

1. Select the source owner explicitly. Use `ProjectCatalog` for API-owned metadata and `NativeProjectCatalogAdapter` for native-owned projects. Never seed both owners from a UI list.
2. Inject the existing API database and transaction/checkpoint helpers. The modules never open a runtime database; only tests use Node's built-in SQLite. Coordinator decides final core-library placement before writable production wiring.
3. Supply synchronous authorization to API catalog methods, and the current native authenticated owner/root resolver to the native adapter. Native list pages/cursors must already be scoped to the permitted native catalog; per-project filtering is defense in depth, not a replacement for owner-side authorization.
4. Refresh execution admission for every read/mutation/receipt read. Admission must attest the exact project or private projectless workspace, runtime/workspace identity and mapping hash, host/environment, directory/shell, epoch, native instance/revision and operation-specific terminal/action/worktree ownership.
5. Dispatch only to that owner, with the original operation ID. Resolve project action IDs through the existing reviewed saved-command/grant owner; never turn action labels or arbitrary request fields into shell commands. Worktree paths/revisions/recovery references are verified by the existing native recovery/ownership service. All Git invocation remains argument-vector based.
6. A host failure, stale binding, revoked permission or unsupported capability remains an error. WSL requires both recorded distro and explicit user. Cluster requires an authorized runtime and storage mapping. No Windows-to-WSL/cluster fallback.
7. The coordinator must package the shared modules before API distribution. The current isolated source imports are source-relative and work in the focused tests. They must become a reviewed workspace package/import or an equivalent declared build-copy layout before `dist/` execution; TypeScript currently does not copy these `.mjs` files automatically. Do not call a source test a built-server check.
8. Mount the handlers only after existing auth/CSRF/origin/capability middleware, deriving owner scope server-side. Proposed HTTP shapes are in `api-contract.json`. The generic create handler targets API-owned metadata; native creation uses the exact native `ProjectCreateRequest` through its adapter.
9. Wire the controlled components through Work's shared slots. Key terminal views by binding identity; a terminal revision advances after owner reconciliation, not merely after rerender/reconnect. An unknown input blocks resending that original draft until the owner resolves it.
10. Persist terminal sessions and output at the existing terminal owner. New terminal creates/inputs/resizes/closes require operation receipts. Output reads are bounded to 1 MiB per response and 64 KiB per chunk; a too-small page reports `requiredBytes` instead of dropping bytes.

The frozen coordinator contract `docs/contracts/veyra-parallel-v1.md` remains authoritative. These DTO additions require coordinator review, not silent changes in another stream.

## Run focused checks

From this app checkout using the already available Node 22 runtime:

```sh
export TEMP=/path/to/assigned/coordination/projects
export TMP="$TEMP" TMPDIR="$TEMP"
export VEYRA_PROJECTS_NATIVE_SOURCE_ROOT="$PHASE/windows-source"
node --experimental-sqlite --test services/ingenium-api/tests/veyra-projects-*.test.mjs services/ingenium-dashboard/tests/veyra-projects-*.test.mjs
```

Set PHASE to the existing absolute phase root. No alternate native checkout is inferred. Use the actual assigned coordination directory, within the existing approved root. Tests use in-memory SQLite and no npm/dependency install, service, network, model or GPU. No build cache or database file is produced. The current dependency-free suite passes 81 tests. The five-case React interaction suite is written but awaits the coordinator resource lease/tooling; it is not included in that count. TypeScript/React rendering and integrated auth/runtime tests are coordinator build requests, not claimed passes.

## Migration and rollback

Read `migration.md` before using `schema.sql`. It is an unnumbered additive draft, not installed into the shared migration directory. Legacy rows, encrypted bytes, settings, resource history, credentials and FK/provenance remain in place. The human-installed `phased-checkout-orchestration` resource remains part of the installation library; do not reinstall or invalidate prior approval.

The fixture proves a narrow property: the additive draft/import does not mutate legacy data. Production-copy provenance, unknown logical references, alias consumer compatibility, restore/rollback, persistent native/runtime workflows and global-row retirement remain open.

## Remaining feature gates

| Rows | Owned implementation/reuse | Required integrated acceptance |
| --- | --- | --- |
| F06–F07 | Catalog, native adapter, explicit projectless selection, pin/rename/archive/restore | Non-Git/multi-root/same-name-host projects; native catalog parity; shared sidebar read/unread/sections/sorting owner integration |
| F08 | Additive identity/provenance migration; existing native backup/import/export owner retained | Actual copied-data import/export, untouched originals, restore and failure recovery |
| F09–F11 | Exact native/WSL/cluster binding policy and target picker | Native V2 tools; pinned WSL distro/user/shell; genuine host cwd/identity/reconnect |
| F12 | Conversation/binding identity checks and no automatic relocation | Existing exact-original native task/workspace handoff; explicit cross-location move/rollback |
| F30–F31 | Terminal UI/read/mutation adapter, replay bounds and saved action IDs | Real PTY resize/input/persistence/output limits; reviewed run/build/test/setup; restart cleanup |
| F35–F36 | Worktree controls, mutation receipts and recovery requirements; existing native registry/snapshot owner retained | Real create/attach/conflicts and recoverable dirty/untracked/unpushed/ignored archive/restore |
| F62–F64 | Scoped owner/admission ports; no fallback; existing remote/hosted owners retained | Pairing/revocation/reconnect, mobile/web approvals/attachments/steering, hosted environments and actual cluster storage |
| F65 | One scoped conversation/project identity; existing snapshot/share owner retained | Immutable shared snapshots, collaboration authorization and revoke behavior |

No row is accepted by this source milestone. The original 74 dispositions, 47 baselines, 20 Settings categories and 11 Windows rows remain unchanged.

## Native reuse and requests

The verified native baseline already has `ProjectStore`, `task_workspaces`, `workspace_archive`, Git review/worktree routes and recovery snapshots. This stream leaves native source unchanged and consumes those owners instead of introducing alternate authority.

The legacy workbench terminal router lacks resize, but the separate native interactive_terminal router already exposes ConPTY create/input/resize/close/receipts and pinned WSL shells. Use the concrete transport entrypoints in [native-integration.md](native-integration.md). Native source reports client reconnect retention, not service-restart survival. Real-machine qualification remains open.

Native Git review/worktree creation is currently Windows-only. True native projectless execution is unsupported; /v1/scratch creates a real project and is never used as a null-project fallback. A small unapplied native receipt-fingerprint patch request is included for coordinator review; no native files were edited.

## Output reconciliation

Owner: projects stream; generated-output root and physical volume remain the original approved paired C-backed task roots. No dependency installation/copy, build, native run, runtime data copy or scratch database was created. No generated bulk was deleted: 0 bytes. Owned source/tests/docs are retained for coordinator review, merge and regeneration. The small coordination ownership/status/test receipts are retained for that review and final evidence. No unrelated or previously rejected cleanup target was touched. No Windows disk recovery is claimed.

## Private projectless follow-through

The coordinator-requested bounded native proposal is in [private-workspaces/README.md](private-workspaces/README.md). It adds no hidden Project or scratch/global fallback. The seven-file patch and schema-v6 copy fixture are unapplied; the proposed native route stays unmounted until existing authenticated actor and actual custody/execution owner ports are provided. Thirteen source/model/migration tests cover negative admission and reconnect preservation. This is not a claim that native projectless execution is already available.

Request execution composition and native ownership follow-through are documented in [request-integration.md](request-integration.md).

## Native local custody follow-on

See [native-local-v6/README.md](native-local-v6/README.md) for the unapplied actual local-bearer/OS-custodian schema-6 and typed execution proposal, exact original-file preimages, native integration recipe, 95 passing CPU tests and nine real Linux FD metadata checks. Native compilation, original resource retirement and full Windows/WSL/hosted/UI acceptance remain open. The earlier abstract private-workspace proposal is superseded; Node migrations 122–124 are unchanged.

## Actual private WSL Git custody follow-on

See [wsl-git-custody/README.md](wsl-git-custody/README.md) for the separate actual subreaper/pidfd owner, opaque original closure receipts, exact Root retirement hook and inert Linux evidence. This remains an unapplied/uncompiled proposal; Windows WSL transport and full workflow qualification belong to Root.
