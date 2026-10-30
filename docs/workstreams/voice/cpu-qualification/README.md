# CPU qualification recipe: separate Root envelope

This is source for coordinator-operated qualification, not a production approval
or an executed installation. The worker fetched only small authoritative JSON
metadata and read known inputs. It did not execute Python, import models, download
binaries, install packages, create cgroups, build these sources or start runtime.
The hosted agent original-settlement gate remains separate and open.

## Authority and unchanged storage

Read the existing phase `output-ownership.json` and its paired Native exception.
`DECLARED_ROOT` is the existing registered C-backed WSL task root; `PHASE` is its
existing `real-gmail-ui/veyra-phase-1`. Register only this additional subdirectory:

```text
QUAL = PHASE/coordination/voice/cpu-qualification
QUAL/input          exact locks/manifests and private operator grants
QUAL/wheels         one lock-keyed wheelhouse, no retry copies
QUAL/runtime/site   one compatible CPU dependency closure
QUAL/runtime/worker the exact closed eleven-file Veyra code bundle
QUAL/runtime/models exact six-file model set plus v3 manifest
QUAL/private        API-uid0700 profile/token/approval
QUAL/bin            reviewed original kernel owner
QUAL/<runUUID>      one genuine original's bounded logs/receipt/tmp
```

Do not create another task root, use D:/F:, duplicate an active build, install into
the base interpreter, copy active Stratus, or fall back to user caches. The entire
existing Windows/WSL pair still has a 20GiB ceiling. Before **each** build/download/
install/qualification stage, Root measures Windows C: free space, destination
filesystem free space, combined currently retained task bytes and outstanding
active reservations. Both filesystems must retain at least15GiB after the stage.
Wait for the actual Native build lease and reconcile eligible obsolete outputs
before considering a larger ceiling. Linux deletions do not establish C: recovery.

`storage-budget.mjs` gives the complete staged **disk** formula. Exact known input
sizes: Linux wheels174,890,471 bytes; Windows wheels130,621,928; six models839,818,565.
Download wheels first. Stream each exact artifact into one bounded `.part`, verify
SHA256/size and rename on the same filesystem; do not keep `.part` plus full copies.
No model-weight bytes or wheel sizes are converted into a RAM estimate.

Expanded installation size is genuinely unknown until Root obtains the wheels.
After their locked hashes pass, `inspectWheel` reads their central directories,
bounded metadata and bundled VAD RECORD. It imports/extracts/executes nothing.
`qualificationStoragePlan` then computes exact compressed/uncompressed totals plus
conservative fixed-pip generated-script/metadata bounds, including two overlapping
expanded trees. Missing ZIP layout refuses installation. Those source bounds are
storage guards, not measurements. Root verifies actual installed bytes against
them, removes eligible wheelhouse/TEMP only after install/RECORD/ABI consumers end,
then measures again before the model stage. Models add839,818,565 bytes to the
measured sealed environment; qualification captures have a separate bounded
allowance. Compiler outputs require the existing Root build lease and their own
measured/guarded stage; none is built here.

The plan takes actual fixed retained QUAL bytes (owner binary, input metadata,
earlier required failure evidence) as a required measurement. Its stage figures
are total QUAL-tree bounds. Before each stage, subtract the actual current QUAL
tree via `additionalStageBytes`, then add only that remaining growth to the fresh
combined-pair inventory. Do not double-charge already retained files or omit fixed
artifacts. Retries outside the eight bounded initial cases require a new inventory
and cleanup, not another output root or an assumed unused allowance.

## Exact inputs and conditional reuse

`pypi-metadata.json` enumerates all32 CPU lock pins, one compatible binary wheel
per target, exact URL/SHA256/compressed size and Requires-Python metadata. Every
selected SHA256 was checked against existing `requirements-cpu.lock`; no sdist or
resolver fallback is permitted. Linux selection targets CPython3.12, x86-64 and
glibc2.36 with supported manylinux tags; actual ABI, Requires-Python and host/image
compatibility still need verification. Windows wheel availability does not qualify
a native interpreter or owner. Preserve the original lock unchanged.

`model-artifacts.json` enumerates the exact six model URLs, hashes, sizes and
authoritative metadata endpoints. STT is Systran small.en at immutable revision
`d1d751a5f8271d482d14ca55d9e2deeebbae577f`; Kokoro is release `model-files-v1.1`,
with upstream release-asset SHA256 matching the pinned Veyra manifest. Use the
version3 CPU manifest from the owned worker; the historical Stratus v1 manifest
and GPU pth/safetensors are not substitutes. Piper remains a historical lock
dependency but is not this selected CPU model backend.

The inventory found a Linux CPython3.12.13 distribution at the exact resolved
location recorded in the private inventory. Its binary, libpython and header
metadata are hashed; ancestors/binary are0755 and the binary has one link. It is
only a candidate for **same-WSL read-only** reuse after actual ABI qualification.
Use the resolved regular executable, never its symlink alias. A Kubernetes image
or native Windows deployment must identify and qualify its own existing interpreter;
these WSL paths are not evidence of image availability. No interpreter copy is
authorized by this recipe; if reuse fails, identify the required deployment
consumer/interpreter stage under the same existing storage before proceeding.

The configured Stratus GPU environment has19 missing/different CPU-lock versions,
and its D: ancestors/site-packages are0777. The surviving voices file is also0777.
Current profile/resource custody rejects those modes even on a read-only bind.
Therefore the default recipe does **not** reuse that environment or voices file,
chmod/remount them or weaken custody. It budgets all six upstream models. Nothing
was copied from Stratus. The existing base's bundled pip25.0.1 wheel matches
upstream metadata; `tooling-and-vad.json` gives its exact hash/size for optional
read-only bootstrap without modifying that base.

CPU transcription enables faster-whisper's bundled Silero VAD. The pinned wheel
contains `faster_whisper/assets/silero_vad_v6.onnx` (1,245,151 bytes), with upstream
Git blob SHA1 `9febab9bc0aa5ae2b27e69243d813427212bfb36`. Its SHA256 is intentionally
not guessed: Root's verified-wheel inspection derives it, checks wheel RECORD and
that upstream blob, and records the dependency-model closure before install seal.
No separate unpinned VAD download is allowed. The model is not in the old GPU env.

## Protected install and source profile

Root creates only the declared directories with actual owned identities. Set
process-scoped TEMP/TMP/TMPDIR, XDG/HF/Torch caches and any build-only AppData under
QUAL before tools start; set `PYTHONDONTWRITEBYTECODE=1` and disable Node compile
cache. Use no npm, cargo, network-enabled package installer or machine/user setting.
The original constructor clears the child environment and keeps CPU/offline keys.

After wheel hashes/layout and storage guards, Root runs the following **through
the bounded qualification owner**, not as an unbounded host Python command. The
fixed `-c` bootstrap prepends only the verified pip wheel and calls
`pip._internal.cli.main.main(sys.argv[2:])`. Its argv is equivalent to:

```text
resolved-python -I -S -B -c <reviewed pip bootstrap> verified-pip.whl
  --isolated --disable-pip-version-check --no-cache-dir install
  --no-index --no-deps --no-compile --require-hashes
  --find-links QUAL/wheels --target QUAL/runtime/site
  -r QUAL/input/requirements-cpu.lock
```

There is no base/user-site installation and no automatic dependency resolution.
Validate every installed RECORD/hash and actual required versions, obtain the VAD
closure, and run actual `pip check`/CPU ABI probes within bounded originals. Only
the declared target and its scratch may be writable. Root seals installed code and
dependency directories/files against the non-root model child before warmup;
do not chmod/chown external roots. Retain one content manifest of installed file
hashes and the exact locked wheels that generated them, not a second environment.

The protected ManagedCpuProfile has its exact existing closed fields: CPU backend,
loopback endpoint, own instance, own token_file, approved scratch and CPU threads,
resolved interpreter hash, readonly qualified pythonPaths and all11 worker-file
hashes. Use actual `ManagedCpuProfile.load` under the actual API uid to obtain its
digest/helper/witness source hashes. Do not copy Stratus's token, `.env`, profile,
model aliases or mutable state. `memoryBytes` is a qualified per-worker address-space
cap, not the aggregate kernel envelope or a file-size-derived RAM number.

## Original kernel owner: existing Root authority

Read-only observations on this WSL kernel6.6.87.2: global cgroup2 is mounted at
`/sys/fs/cgroup`; existing parent controllers are already enabled for CPU/memory/
pids. Root has write access; brajam has no direct root/leaf write access.
`init.scope` is not delegated and has unbounded memory/CPU; user@1000.service has
CPU/memory/pids delegation, but a writable ancestor is not used as an escape-prone
qualification boundary. Global-root controller-limit files are legitimately absent;
do not mistake them for a finite grant. Host available memory is only a transient
capacity fact, never a measured model peak.

Root may compile `kernel-owner.c` with `VEYRA_QUALIFICATION_ROOT` defined as the
**exact registered QUAL prefix ending with /**, under its existing build lease.
Use the existing compiler only; missing compiler or required kernel interfaces is
a refusal, not install permission. Compilation and execution are unrun here.

Under Root's idle build/storage lease, the fixed one-translation-unit recipe is:

```sh
TMPDIR="$QUAL/tmp" TMP="$QUAL/tmp" TEMP="$QUAL/tmp" \
  "$QUALIFIED_CC" -std=c11 -O2 -Wall -Wextra -pipe \
  "-DVEYRA_QUALIFICATION_ROOT=\"$QUAL/\"" \
  "$SOURCE/kernel-owner.c" -o "$QUAL/bin/kernel-owner"
```

QUALIFIED_CC is the actual existing compiler executable, not a cache wrapper;
Root pins its version/identity and scopes all compiler scratch. Root supplies a
bounded compiler-stage disk allowance and file-size limit before invocation,
records actual peak/output bytes, and re-measures afterward. There is no claim
that an unknown compiler expansion has already been measured by this worker.

The constructor requires Root and creates a fresh UUID leaf directly under the
already-enabled parent. It never changes parent subtree_control or moves an
existing workload. It retains the original leaf fd/device/inode, boot/namespace,
actual unreaped fork's pidfd/start ticks, admission pipe and stdout/stderr.
Before opening the gate it writes/readbacks finite `memory.max`, swap0, oom.group1,
`cpu.max`, `pids.max`; checks an explicit operator host reserve against current
MemAvailable; assigns only its fresh blocked child and verifies exact membership.
The child drops groups/uid/gid/capabilities, sets no-new-privileges and closes other
fds before fexecve of its retained interpreter fd. The Root-owned ancestor prevents
the non-root child from migrating outside this leaf. No new Docker image is
required merely because brajam cannot write cgroups.

Before dropping privileges, the fresh child also creates a private mount namespace,
makes propagation private, and read-only binds the exact base/code/dependency/model
directories inside **that child view**. Host mounts and external file permissions
are unchanged. This protects the candidate user-owned base against child writes;
it does not freeze changes by another external owner, so input hashes/identities
are rechecked after joins too. Root must qualify namespace/mount authority as well
as cgroup authority; missing capability refuses before interpreter execution.
Never include writable scratch in readonlyMounts or use a broad/root mount. This
is a required reuse condition, not permission to change active Stratus inputs.

Deadline/cancel requests kill **only this retained leaf**. Completion still waits
for the exact original child, kernel populated0 and both real pipe EOFs. A stalled
kernel remains retained; elapsed time cannot yield success. Only the exact verified
empty leaf is removed. The owner reports real memory.peak, pids.peak, leader wait4
maxRSS, CPU/memory/pids event counters and positive joins. Its output is qualification
evidence, never a production retirement/credit/operation receipt. Root must first
qualify this source with inert cases including leader exit while descendants hold
pipes, output refusal, deadline/partial launch and successful empty-leaf cleanup.
Unexpected creation/controller/pidfd/privilege failures stop before model admission.

`run-envelope.mjs` holds the actual owner Child, exit/close/pumps and bounded private
files. Root-owned0600 grants bind exact input hashes, hard limits, existing storage
ownership/preflight and command. `qualification-grant.template.json` has **null**
limits/identities and cannot run. Root fills a separate operator qualification
envelope from actual authority/headroom. It never writes a temporary production
approval. Run with the actual existing Node binary and explicit Root invocation:

```js
const { runEnvelope } = await import(SOURCE + '/run-envelope.mjs');
await runEnvelope(actualRootOwnedQualificationGrantPath);
```

No kernel leaf is created just by importing a module. If actual Root leaf creation
or hard limits fail, retain the gate. An already-authorized original container/CRI
manager with verified pre-entrypoint memory/CPU/pids/time bounds is an alternative;
do not toggle host policy, borrow Stratus or infer retirement from Pod disappearance.

## Cold, hot, helper, witness and probe capture

`qualify_cpu.py` is a real model-only driver for a new bounded original. Its fixed
command is the exact resolved Python with `-I -S -B`, this hashed script, runUUID
and private qualification grant. Before any model import it checks exact cgroup
membership/limits, non-root uid, interpreter/code hashes, CPU/offline environment
and the profile address-space cap. It uses the production CPU loader and its real
warmup, then actual synthesis/transcription for every selected voice. It captures
raw /proc status/stat/smaps, getrusage and cgroup memory/tasks/CPU counters before
cold, at ready and before/after hot. It saves no audio or human transcript.
No fake model loader, positive SupervisorOwner fixture or upstream engine is used.

The model-only driver deliberately emits `productionWireValidated:false` and
`productionApprovalEligible:false`. It does not prove actual API/private-channel,
helper/witness or full workload-envelope qualification. Root must additionally
run genuine helper-only, witness-only and actual resource-probe cases using the
same protected code/profile, each in its own fresh bounded original. Witness-only
must execute the real fixed witness against its actual retained original helper
and join that Child/stdin/stdout/stderr; an ACK server fixture is insufficient.
Probe-only must execute the actual admission/hash probe, not renamed labels.

Finally run actual CPUv2 STT/TTS/cancel/no-start/uncertain/result-loss and scope
retirement through the existing single Core writer/real authenticated selected
scope under the qualification kernel authority. Root supplies that existing
private-context/operation bridge and genuine original helper/witness driver.
Those are required inputs, not ports supplied positive fixture implementations by
this recipe. Missing actual drivers/positive original joins means **no approval**.
Do not create fake sessions/auth rows, a second SQLite writer or use the hosted
agent settlement gap as a CPU speech replacement. Preserve all release gates.

## Evidence to protected production approval

`evidence-to-approval.mjs` requires successful Root-owned captures and their exact
log hashes, unchanged interpreter/code/model/dependency bindings, real original
joins, sealed installed RECORD/VAD closure, actual Core CPUv2/physical-retirement
receipt from its original writer, and a separate Root review. The review template
starts approved:false and has no measurements. A local model-only success cannot
satisfy these gates. Event/idle/PID/health/timeout labels cannot supply physical proof.

Component numbers are derived from raw measurements only: ready process/kernel
resident bytes, cold peak minus ready resident, hot lifetime high-water minus its
actual starting resident, and separately measured helper/witness/probe case bounds.
The full real-wire case must also supply raw wire-before-hot/wire-after-hot
snapshots and cover the complete payload envelope. Its actual peak bounds both
cold residual and hot workspace/task accounting; a smaller direct-model result
cannot hide server/private-channel/body-copy overhead. This requires the genuine
single-writer qualification bridge and driver; none is replaced by a flag fixture.
Lifetime hot high-water can conservatively include earlier warmup; it is not
described as an independently reset instantaneous peak. Task bounds sum actual
case task peaks and observed incremental hot tasks; CPU milli is the **actually
enforced qualified CPU envelope**, not guessed utilization. The exact existing v1
component/stage equations are preserved. Any required zero/missing component
refuses; never invent1byte or relax policy to create a file. Root must resolve a
legitimate zero/schema issue explicitly if encountered.

The generator binds qualificationDigest to the actual reviewed source/log/Core/
dependency receipts, verifies actual sealed model assets through the existing
resource module, validates a private candidate with the real decoder, and creates
the final API-uid0600 authority exclusively. It overwrites nothing. Invalid/partial
candidates stay outside the authority path as small failure evidence; Root
reconciles them after their last consumer. Source review, a digest or schema match
alone is not proof of execution. Root's review authority must verify actual driver
and single-writer receipts; no JSON structure can manufacture a missing original.

Environment dependencies must remain sealed and their closure checked by the actual
Root factory; any source/dependency/model/platform change invalidates qualification.
Do not copy this Linux approval to Windows or another unqualified deployment.

## Windows boundary and cleanup

`platform-adapters.mjs` implements the Linux selection and refuses Windows with an
exact missing-original-accounting/interpreter reason. Windows needs its own real
native3.12.13, locked wheel closure, existing Native CPU Original/OwnedProcessJob
constructor with suspension/assignment before resume, non-breakaway aggregate
memory/CPU/task limits and retained process/thread/job/pipe/witness joins. Capture
actual Windows RSS/commit/accounting with the original handles; Linux cgroup bytes
cannot be relabelled. No Windows approval is emitted by these sources. The Native
managed draft remains unapplied/uncompiled until Root's existing integration gate.

Keep deployable environment/models only for their actual qualification/packaging/
runtime consumers. Wheelhouse, installer temp, compiler output and reproducible
inactive retries end after their final consumer; use the same lock-keyed paths.
Before deletion Root checks exact resolved ownership, source/lock/unique-evidence
preservation, known regeneration and no process/container/mount references. A
failed check protects that target; never retry another deletion path or stop an
unrelated workload. Keep minimal manifests, hashes and genuine failure evidence,
not duplicate environments/images/audio. Record exact paths/bytes and retained
reasons, remove reconciled empty scratch, and separate Linux bytes from measured
Windows free space. No compaction, WSL shutdown or blanket pruning is implied.

Primary mechanisms: [Linux cgroup v2](https://docs.kernel.org/admin-guide/cgroup-v2.html),
[Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
This source set is **uncompiled/unexecuted qualification tooling**, not qualified
resource measurements, runtime acceptance or completed Phase1/release.
