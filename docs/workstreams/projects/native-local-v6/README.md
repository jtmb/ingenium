# Native local custody and projectless execution source proposal

This is an unapplied source proposal against native tree `a04ab38bd0e0c7b96f40689733cad3f2332b9a0b`. It replaces the earlier abstract organization/user-port proposal in `../private-workspaces/`; do not apply both. Native application, shared integration, Rust compilation, Windows/WSL execution and release acceptance belong to the coordinator. Node migrations 122–124 are unchanged. Linux Docker/Kubernetes execution stays with the existing hosted API owner; this adds no Linux native desktop or PTY release gate.

## Actual authority and preservation

The protected local bearer middleware stamps an opaque local-request extension only after the original bearer and no-Origin check. The original remote pairing/proxy allowlist is unchanged. Caller organization, account, user header, project name and global Project cannot enroll a private workspace. The new DTO has installation/custodian/workspace/revision/service/environment fields and rejects extra fields.

The production startup borrows its original frozen `ServiceGuards` directory. Adapters observe the actual process SID, original volume/file identity and owner-only ACL. The installation ID is the existing `utility_operations::Store.library_id`, not a new account registry or current request identity. The portable Linux custody type uses the real euid, machine ID and physical metadata; it does not create a native Linux executor.

`ProjectStore::open_local` enrolls schema 6 through the existing single-writer connection. It validates original v5 data, fingerprints every legacy table value (including BLOB/Unicode/null/numeric representations), performs additive DDL and writes an immutable migration receipt in one transaction. It checks the fingerprint and actual custody again before commit. Restart requires the same installation, OS scheme/subject, physical root and custody hash and the exact local DDL. Partial local schema, mismatched account/root/library and changed final custody refuse without reassignment. Original SQL 0001–0005, Project IDs/paths/permissions, credentials and engine data are not rewritten. Ordinary unenrolled Source/legacy constructors remain schema 5; production enrollment is explicit. Original project presentation/search readers accept the additive v6 shape.

No Project is fabricated for execution. Reserved or unknown UUIDs never repeat allocation or adopt existing directories. Operations hash the exact typed request, persist intent and fence unknown before effects. A lost acknowledgement stays unknown; the same UUID does not resend input or recreate work. Current service instance, revision, actual custody and environment are checked. `LocalWorkspaceBinding::verify` checks physical custody only: it does not grant continuing registry permission. The coordinating review found that the initial acquired registry snapshot could become stale while waiting on an engine/terminal/Git owner. The follow-on adds `verify_current(&ProjectStore, instance)` against the actual original registry plus exact stored root evidence. Service-owned guard closures use that method under the original nonblocking `try_lock`, immediately before effects and before publishing results, including after asynchronous provider work. This avoids waiting on the catalog while holding an engine lock. Registry contention, retirement or revision/root changes refuse; a fenced original stays unknown without replay. Cleanup still uses the exact retained owner/account and does not require new workspace execution permission. An arbitrary success callback is not authority: these internal adapters must receive the genuine service registry closure. Memory must revalidate its actual original registry owner at each read/admission and after async capture; `verify` alone is insufficient. The registry retains ownership/receipts rather than a second engine conversation store. Actual engine sessions are referenced only through a unique committed session-created receipt.

## Physical namespace and resource ownership

Windows private directories are UUID children of the protected state directory, created once with a strict ACL installed at birth. Their actual root and ancestors use the existing NT Capture and checked-close primitive. The carrier retains each capture before its first open/query, including failures. Reverification uses the pinned original handles. The original state root is borrowed from ServiceGuards rather than reopened as a second close authority. A refused logical SQLite close returns all custody fields with the original store.

Before private allocation and before new Project create/import/unarchive grants, physical namespace checks refuse a Project root that contains or lies inside protected private storage. Conflicting original Projects remain untouched. Windows checks use original native physical ancestor identities. WSL uses fixed selected-distro/explicit-user helpers, no-follow directory FDs and fresh physical ancestor chains. It compares actual helper snapshots, never caller claims. Missing legacy WSL user custody refuses; it is not filled from the current account. WSL private storage requires a supported local block filesystem and persistent filesystem/inode/uid/machine identity. Network storage is not silently treated as local.

Private terminals retain the real ConPTY original and bounded output ring under a typed local binding. Input/resize checks the binding; close matches the exact retained owner/request and actual OS account. Ordinary HTTP admission still rejects drain-time POSTs; internal Runtime retirement owns shutdown cleanup. Fixed-argv Windows Git uses the original Git executable resolver and a separately typed private failed-launch scope over the original suspended-process/job ledger. Partial launch, process/job and reader originals are retained before subsequent effects. Cleanup does not drain another subsystem's launch scope.

Private agent methods use the actual engine lock/client and existing durable prompt journal. A Project credential/plugin/isolation-bound engine cannot be relabeled private. Current model/agent/directory/environment are checked. This is ownership separation, not an OS sandbox claim.

WSL Git is deliberately refused before operation admission: the original Windows WSL bridge does not establish ownership of arbitrary Linux Git descendants. Fixed helper code is not proof of that missing original tree owner. The coordinator must supply and qualify that actual owner before enabling WSL Git/worktree effects. WSL shell/agent, Windows jobs, ACL/SID, process exit, original NT/SQLite retirement and real workflows still require native qualification.

Startup effects retain the genuine guard/resource graph even on acquisition failure, and the completed Runtime shares the same inventory. This source proposal does not prove physical disposition of the failed-startup or completed-service graph; the coordinator must integrate those originals into its existing retirement proof. A logical close, passing source assertion or Linux FD fixture cannot close that gate.

## Exact integration inputs

`proposal.json` records each existing file's exact Git preimage and proposed hash, every canonical new source's bytes/hash, and the delta patch hash. `sources/` contains only new canonical Rust/Python/SQL source. `integration.patch` contains only deltas to original files. No native checkout, Git index or full source snapshot is written by this worker.

From this directory, regenerate only against the exact frozen source:

```sh
python3 -B prepare-integration.py --native-root /absolute/path/to/windows-source
```

The generator refuses changed preimages and new-file collisions. The coordinator should verify the manifest, compose overlapping Voice/shared changes explicitly, copy only the listed canonical new files to their exact native-relative paths, and apply the delta with its normal reviewed integration workflow. First run `git apply --check integration.patch` against the matching original. Do not silently retarget/rebase the generator to a different native tree or copy a dependency/build tree.

## Verification and remaining acceptance

The Projects CPU suite passed **93/93**, zero skips. Twelve new cases execute original native SQL 0001–0005 plus canonical SQL 0006 in memory, testing preservation, atomic rollback, immutable custody, no reallocation/replay and original-source seams. They model the migration protocol and do not execute Rust. Two proposed Rust contract tests are included but have not run. Python sources pass AST syntax checks. The delta passes read-only Windows Git `apply --check` against the frozen native source.

The closed metadata fixture exercises the actual Python namespace functions with real Linux FDs: disjoint roots pass; equality, ancestor, descendant, symlink alias, missing path, missing realm, malformed identities and empty candidate refuse. It checks stable FD count after each case and removes every owned fixture object in finally after inventory/reference/mount checks. Run only in the already declared Projects coordination root:

```sh
python3 -B namespace-fixture.py --scratch-root /absolute/phase/coordination/projects
```

Nine fixture checks passed; 177 measured bytes (18-byte sentinel and 159-byte symlink target) and all empty fixture directories were removed. This is Linux metadata evidence, not Windows disk recovery, native helper execution or live cluster acceptance.

Run the dependency-free Node suite with the existing Node binary, `--experimental-sqlite --test`, every `veyra-projects-*.test.mjs` in API and dashboard test directories, and `VEYRA_PROJECTS_NATIVE_SOURCE_ROOT` explicitly pointing to canonical native source. Set process TEMP/TMP/TMPDIR to the declared Projects coordination directory. No dependency installation is required. Current full TAP and fixture cleanup receipt are in that directory.

Open gates include coordinator native composition/compilation, original startup and final retirement, Windows SID/ACL/reparse/alias races, actual selected-user WSL/controller ownership, WSL Git helper-tree custody, real agent/session/terminal/Git/worktree workflows, Node-to-native owner binding, full UI/screenshot acceptance, restart/rollback/persistence and Windows plus Linux Docker/Kubernetes release acceptance. No build, download, runtime migration, model load, inference, GPU work or deployment was performed here.

## Output inventory and cleanup

Owner: existing Projects worker `01a18934-fe43-76a0-940e-6766d96f5770`. All generated source/receipts remain under the previously authorized C-backed Ubuntu VHDX root `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845`; no additional root or drive was created. Source is confined to this worker's app/docs and its coordination directory. Expected peak for this source-only stage is below 2 MiB. Original native checkout, legacy SQL, old unique proposal source, manifests, lockfiles and user runtime data are protected.

Canonical new source, generator, delta, manifest and tests remain required inputs for the coordinator's concrete integration/review. Keep those durable source artifacts. Full TAP and the small real-FD receipt remain the current verification consumer; redundant subset TAP is retired after the full run. There are no compiler outputs, dependency copies, downloads or caches to retain. Fixture objects are removed by their recorded exact paths; no Linux measurement is presented as Windows free-space recovery.
