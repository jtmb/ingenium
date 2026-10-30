# Private WSL Git original custody proposal

This source-only follow-on supplies the missing Linux descendant owner for private WSL Git status, diff, branch and worktree operations. It is not applied or compiled by this worker. Root owns actual Native composition, normal checks, Windows WSL transport/selected-user qualification and workflow acceptance. The earlier unconditional missing-owner refusal is replaced by real runtime prerequisites and a typed closed-original path. Unsupported prerequisites refuse before Git exec. No synthetic Project, shell fallback, Cloud principal, new database or SQL migration is introduced.

## Concrete original owners

The existing `wsl_engine_owner` explicitly owns a process group and disclaims pidfd/cgroup guarantees; `owned_wsl` remains a prerequisite plan. The old `wsl_workspace::run_wsl` supervises a Windows bridge and may terminate it. Neither establishes that detached Linux Git descendants are gone. This proposal uses a separate `LocalWslGit` transport owner and the same fixed selected-distro/explicit-user private-root acquisition.

The dedicated Linux helper verifies it is single-threaded with no preexisting children, sets and verifies the actual child-subreaper attribute, requires real pidfd and fd-exec support, and sets per-process no-new-privileges. It retains its owner object and fork-attempt phase before forking Git behind a pipe gate. An original pidfd is captured while the direct child cannot exec. The helper emits `prepared` with the exact original nonce/request/observed root identity. The Windows owner rechecks the actual current registry and physical binding before sending the one dispatch. No public metadata can create that permission.

The subreaper adopts orphaned descendants even after setsid/double fork. Cancellation signals only retained pidfds acquired from the kernel's own direct-child list, with the parent retaining unreaped child identity and no competing reaper. There is no PID/name/UID-wide sweep or process-group absence assertion. Final Linux closure requires waitpid with `__WALL` reporting ECHILD, all original child pidfds retired and both captured child output pipes at EOF. Leader exit and stdout EOF alone are insufficient. These are process ownership properties, not filesystem/network isolation or an OS sandbox claim. See the primary [subreaper](https://man7.org/linux/man-pages/man2/PR_SET_CHILD_SUBREAPER.2const.html), [pidfd](https://man7.org/linux/man-pages/man2/pidfd_open.2.html) and [wait](https://man7.org/linux/man-pages/man2/waitpid.2.html) interfaces.

Git uses a verified root-owned regular `/usr/bin/git` fd and fixed argv. Hooks, fsmonitor, pager, optional untracked cache and external diff/textconv are disabled. Credential-bearing inherited environment and Git/GCM overrides are removed. `--git-dir=.git --work-tree=.` prevents discovery of a home/global ancestor repository. Worktree targets are create-new UUID names relative to the actual fd-held cwd. Current registry/root checks are repeated before dispatch and before publishing results. Stdout/stderr each retain at most 64 KiB while draining all bytes; explicit truncation flags prevent a partial result from masquerading as complete output.

## Windows transport, unknown effects and durable closure

The Windows owner retains the real child, job, input worker, bounded protocol reader and diagnostic reader before exposing operation input. It never infers Linux retirement from bridge/job exit, a serialized PID or an elapsed deadline. Timeouts request cancellation through the original channel and retain the actual transport. The Linux helper remains the subreaper until it can prove its original descendants gone. A missing/malformed final proof protects the exact original and blocks new WSL Git. Signals request cancellation rather than throwing out of the helper's cleanup path.

`LocalWslGitClosed` is opaque, with no Clone/Deserialize or public constructor. It is created from the actual final original after child/job/worker completion. It carries both the Linux witness and transport completion result. `ProjectStore::record_local_wsl_git_closed` checks the original enrolled account/library/custodian and exact immutable operation owner, then records the witness in that original operation row. An uncertain effect stays `unknown`; a positive resource-closure witness is not an operation-success claim. IO completion failures are retained as unknown with `original_transport_closed=false`.

The ordinary once-only operation fence still precedes dispatch. New WSL Git is blocked by earlier intent/unknown Git rows lacking positive Linux plus original transport closure, including after service restart. Canonical and old kind encodings are read without rewriting original rows. A distinct later operation may proceed after positive closure even when the earlier effect outcome remains unknown. The earlier UUID is never resent. Read-only operation receipt reconciliation observes the same retained owner and may persist a late opaque witness; it never launches Git or adopts another helper.

## Required Root composition hook

Apply the five exact existing-file deltas and two new canonical sources from this folder. `proposal.json` records SHA256 preimages/proposed hashes. The base is the owned 8b canonical proposal plus Root's explicitly mirrored SQLite revision correction: `local_workspace` reads revision through rusqlite i64 and converts with checked `u64::try_from`, refusing invalid values. The earlier canonical source/manifest remains intact apart from that requested correction. Do not copy a Native checkout or dependency tree.

Root must also replace its existing shared `apps/service/src/routes/workspace_retirement.rs` call:

```rust
state.local_workspaces.finish_until(self.deadline)?;
```

with the proposed namespace hook:

```rust
local_workspaces::finish_with_registry(state, self.deadline)?;
```

The new hook closes terminals and actual Git owners, persists opaque late closure witnesses through the original ProjectStore mutex, then retires private root custody. The old namespace method deliberately refuses if witnesses remain unpersisted; it cannot silently discard them before SQL donor movement. This exact one-call shared composition is a Root proposal only; the worker did not modify shared Native. Preserve the original engine-stop/admission/retirement ordering and all existing guards.

Regenerate from this directory with `python3 -B prepare-proposal.py`. It reads only the exact owned canonical source/manifest and writes this delta/manifest. Source drift refuses. A read-only Windows Git `apply --check` against Root's applied Native succeeds for the five emitted deltas; the shared retirement hook still requires Root composition. Node migrations and native schema allocation are unchanged.

## Executed evidence and remaining gates

The full dependency-free Projects suite passes 99 cases with zero skips. Four new cases execute the exact proposed SQLite quiescence query against canonical schema 6, testing canonical/legacy unknown originals, exact scope, immutable no-replay and positive closure separate from unknown outcome, plus artifact integrity. They do not compile or execute Rust.

Ten actual inert Linux fixtures pass: pre-exec gate, setsid/double-fork descendants, pidfd-only cancellation, leader/pipe exit insufficient before ECHILD, bounded output draining, cancellation before exec, a partial fork/pidfd-allocation failure before exec, real Git status/diff/branch/worktree, and production prepared/dispatch plus prepared/cancel handshakes. Git fixtures use an empty commit and zero tracked files. The two handshake cases use an explicit task-local fd root shim and do not qualify the real selected-user XDG root or Windows WSL bridge. The owner cases finish with stable fd counts and actual original tree/pipe closure. No service, workload, model, GPU, native Linux desktop, cluster runtime or user workspace was used.

Run only in the existing task coordination root:

```sh
python3 -B inert-fixture.py --scratch-root /absolute/phase/coordination/projects
```

The first cleanup check incorrectly treated an empty Git index with a TREE extension as tracked source. It stopped and retained the exact fixture. Reconciliation independently verified DIRC v2 entry count zero, valid checksums in both indexes and zero bytes from original `git ls-files --stage -z`, then the same owning script removed it after all ownership/reference/mount checks. No alternate deletion path, active process stop or preservation bypass was used. Later fresh runs verify actual entries/checksums. Exact removed paths/bytes are in `coordination/projects/wsl-git-custody-cleanup.json` and the current `wsl-git-custody-fixture.json`; earlier run counts are reconciled in existing status/source-review receipts. No Linux measurement is a Windows free-space recovery claim.

Open gates remain Root shared-hook composition, Rust compilation and actual Windows selected-user WSL transport, original private root custody, live Git workflows/restart/unknown cleanup/retirement, UI consumption and full phase/release acceptance. The new syscall preconditions are real runtime checks, not a claim that every WSL kernel supports them. Unknown originals without a positive original witness remain blocked and are never retroactively adopted from PIDs or metadata.

## Storage and cleanup inventory

Owner/root/volume/peak/regeneration/protected inputs were recorded in `storage.json` before generating source. All paths reuse the existing authorized C-backed Ubuntu VHDX task root; no migration, drive fallback, build, dependency copy or cache was created. Canonical new source, delta, manifest, fixture recipe/tests and this integration contract remain required Root review/integration inputs. Small current TAP and actual fixture/cleanup receipts remain verification inputs. All reproducible inactive fixture files and empty directories are removed after checks; any refusal protects its exact target until concrete reconciliation evidence resolves the failed check.
