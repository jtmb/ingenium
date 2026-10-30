# Proven global cgroup controller boundary

One-file source proposal for Root's actual `services/ingenium-api/lib/voice-v2/linux-resource-probe.mjs`. Exact current preimage, proposed bytes and protected admission/profile/supervisor/Core source hashes are in `preimages.json`; Root alone applies the patch. No cgroup, namespace, process, model, profile, grant, ledger, device or runtime was changed. The product probe still has no injectable reader/capacity/positive-admission port. Tests substitute filesystem reads only inside a Node VM.

The existing probe reads memory.max/current, pids.max/current and cpu.max at every visible ancestor. A true global cgroup v2 root has no such controller limits. The exception added here recognizes that specific boundary; it does not treat arbitrary absent files as unlimited or finite capacity. All present descendant limits/current usage, ancestor quotas, effective cpuset and host MemAvailable pressure remain in the existing minimum/headroom arithmetic. Memory and task headroom still require finite descendant bounds. A probe from the global root alone, or a descendant with all-unbounded memory/tasks, still refuses.

## Required evidence for the exception

The omission branch is reached only for an ENOENT at the exact fixed cgroup mount point. Missing nested files, malformed values, EACCES, ENOTDIR and partial controller layouts do not enter a permissive fallback. All five root capacity/current files must be absent; any present one rejects the exceptional layout, so a finite root value is never discarded.

The branch requires these facts together:

- One cgroup2 mount at `/sys/fs/cgroup`, filesystem magic0x63677270, reported mount root `/`, and actual directory inode1. A nested/bind-root inode or different mount root cannot use the omission.
- The actual initial cgroup namespace: readlink text cgroup:[4026531835], followed nsfs object inode4026531835 and nsfs magic0x6e736673. Link text alone is insufficient. Different or unknown namespace identities refuse this branch.
- Original proc filesystem for the membership, mountinfo, host meminfo and boot reads, plus one real `/proc` mount rooted at `/`. Relevant masks of proc paths or the process-PID aliases refuse. Any additional cgroup submount, masked controller file/directory or overlapping mount point refuses the global-root exception.
- Actual root cgroup.controllers and cgroup.subtree_control containing cpu, memory and pids, with bounded strict unique controller names. Availability alone is insufficient without subtree enablement.
- Repeated original directory/membership/mount/namespace checks, followed by a second full global-boundary proof including nsfs identity, filesystem facts, absence and controller metadata. Changed facts refuse instead of rebasing the admission identity.

The chain explicitly labels this node `kind:global-controller-root`, with null memory/current/task/quota values. Those are **absent boundary fields**, not measured capacity. The root proof is included in the existing original identity digest. Finite constraints still come from actual descendants; host availability can only reduce memory headroom. Existing fully present finite hierarchy behavior is retained, including its prior qualification requirement for the actual visible ancestry. This patch does not certify hidden host ancestors for a container or relax the missing-file rule for namespaced/nested roots.

These evidence requirements are deliberately restrictive and depend on verified Linux kernel conventions. A kernel/layout that does not satisfy them stays unavailable; no alternate positive branch is provided. The kernel declares the initial cgroup namespace number in [proc_ns.h](https://github.com/torvalds/linux/blob/v6.6/include/linux/proc_ns.h#L37-L45), binds it to init_cgroup_ns in [cgroup.c](https://github.com/torvalds/linux/blob/v6.6/kernel/cgroup/cgroup.c#L191-L198), and allocates the first kernfs directory inode for the actual root in [kernfs/dir.c](https://github.com/torvalds/linux/blob/v6.6/fs/kernfs/dir.c#L882-L922). The [cgroup v2 documentation](https://www.kernel.org/doc/html/v6.1/admin-guide/cgroup-v2.html) describes root/controller exceptions and hierarchy controls. These references support identifying the boundary; they do not supply finite resource measurements or a qualification approval.

## Read-only machine evidence and remaining gates

Observed WSL kernel6.6.87.2-microsoft-standard-WSL2 has cgroup2 mount root `/`, global directory inode1, the initial cgroup namespace number and nsfs magic, available/enabled cpu/memory/pids, and absent global memory.max/current, pids.max/current and cpu.max. The current shell is in `/init.scope`. Its memory.max is max, so the actual proposed read-only probe correctly returns `CPU_FINITE_CGROUP_CAPACITY_REQUIRED` rather than ENOENT. That is a refusal receipt, not successful finite admission or qualification. No process was moved into a leaf to obtain it.

Root/worker7 still own any actual task leaf creation, finite control write/readback, original process placement and cleanup under their separate authorization. A future probe must run in that actual leaf with the same ancestor/current/host checks; merely naming a leaf or observing controls elsewhere grants nothing. Exact profile/model/code/thread cold/hot/witness peak qualification and actual runtime acceptance remain open. Read-only probes are non-atomic pressure snapshots, not exclusive kernel reservations or a guarantee against competing pressure, OOM or throttling.

## Validation and outputs

Twelve in-memory VM cases cover a genuine-layout boundary with finite descendants and host pressure; global-only and all-unbounded refusal; missing nested leaf/ancestor files; partial/unreadable/malformed root files; wrong mount root/inode/namespace/proc/nsfs/cgroup filesystem; cgroup/proc masking; controller availability/enablement; finite ancestor pressure; directory/membership/mount/namespace identity races; repeated absence/controller/nsfs proof; and the unchanged fully present finite path. No fake fact is exposed as a product option. This is bounded source-policy evidence, not actual leaf, process, model or platform acceptance.

From the existing owned checkout with TEMP/TMP/TMPDIR in the same existing coordination/rust-api root and NODE_DISABLE_COMPILE_CACHE=1:

```sh
node --experimental-vm-modules --test docs/workstreams/rust-api/linux-cgroup-boundary/linux-cgroup-boundary.test.mjs
node --check docs/workstreams/rust-api/linux-cgroup-boundary/linux-resource-probe.mjs
node docs/workstreams/rust-api/linux-cgroup-boundary/prepare-proposal.mjs "$INTEGRATION"
git -C "$INTEGRATION" apply --check "$OWNED/docs/workstreams/rust-api/linux-cgroup-boundary/linux-cgroup-boundary.patch"
```

INTEGRATION remains existing `real-gmail-ui/prd-ui-fixes`; OWNED remains `veyra-phase-1/parallel/rust-api` under `/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui`. The sole disposable root is the existing C-backed `veyra-phase-1/coordination/rust-api`, not a new drive/root. Only the final small TAP, single receipt and in-place status are retained there for Root's source review. No disk fixture, dependency/cache/compiler output, download, model or subprocess fixture was created. Removed generated paths none; removed bytes0. Durable source/patch/preimages remain under this owned docs prefix for integration/reproduction. Previous cleanup-rejected/EBUSY exceptions are untouched. No Linux filesystem or Windows/VHDX recovery is claimed.
