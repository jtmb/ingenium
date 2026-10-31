# GPU preference and fixed CPU backup: bounded source proposal

This packet is READY FOR INTEGRATION REVIEW of independent negative/data pieces.
It is NOT a working GPU implementation, a provider qualification, a physical
resource lease, or overall voice acceptance. No worker tests/builds/runtime or
GPU/CPU inference were performed. Root alone changes canonical sources.

## Current actual split

`directml_models.py` has genuine AMD DirectML allocation, STT/TTS inference and
startup fixture matching. `Device.memory()` reports this allocator's pool/usage;
physical capacity and budget come from operator settings/environment. Those
are not a global free-VRAM measurement or a process-retirement original.

The managed Linux path is a different producer: `ManagedCpuProfile` requires
cpu-onnx, its measured bundle omits directml_models.py, bootstrap masks CUDA/HIP/
ROCR, `managed_entry.py` and `Worker(cpu_operations=...)` reject non-CPU models,
and CPU resource approval validates the CPU manifest. Production composition
constructs only `createLinuxCpuSupervisor`. No CUDA/ROCm voice model source or
managed DirectML GPU process/resource owner was found. Windows engine remains
untouched; a Windows DirectML inference engine cannot run through Linux pidfds.

Core `VoiceKind` and parent checks currently allow `voice-cpu-supervisor` only.
Do not relabel a GPU child as CPU, broaden CPU proof predicates, or treat a CPU
capacity admission as permission to allocate VRAM. Root must explicitly migrate
the parent/backend identity and signed restoration/negative controls before GPU
children can use the common Core128/134 machinery.

## Implemented independent sources

`linux-gpu-observation.mjs`: fixed native Linux AMDGPU sysfs reads, no device open,
ioctl, subprocess, driver library, model import or writes. Binds boot/release,
canonical PCI device directory identity, driver and source filesystem; samples
total and used twice and takes the larger used value. Missing/inconsistent/
stale facts fail closed. WSL is unavailable: these guest facts cannot establish
Windows-host occupancy. Domain is explicitly `visible-amdgpu-driver`; host-wide
coverage, provider compatibility and a resource lease are NOT established.

`gpu-budget.mjs`: measured-plan DATA validation and conservative arithmetic for
cold/hot/retirement peaks, VRAM reserve plus external-growth allowance, RAM,
tasks and CPU quota. Existing global used VRAM already includes other allocations;
do not subtract the LLM/desktop twice. A successful fit explicitly returns
`admissionAuthorized:false`. Hash-shaped DATA cannot establish that measurements
were made; the future genuine protected profile owner must verify them.

`gpu-prelaunch-fallback.mjs`: once-only private original recording that THIS
current code path entered no GPU producer. It permits selecting existing CPU
backup before call resource creation, without creating any CPU authorization.
This is not a post-start fallback or a promise of complete GPU preference. A
copy, health report, CPU proof or unrelated physical proof cannot consume it.
The guarded production-system splice leaves the genuine CPU factory/profile/
approval/ledger unchanged. No backend can mutate under an active call's lease,
source plan, STT operation, SQL132 identity or Core134 source claim.

## Exact next genuine operations for Root

1. Implement a provider-specific original adapter-device owner. DirectML needs
   Windows adapter LUID/actual allocation and the corresponding original Windows
   process/job/pipe owner; do not route it through Linux. Linux needs an actually
   supported ROCm/CUDA STT and TTS provider implementation and pinned dependencies,
   models, warmup and provider/device compatibility evidence. Presence of a GPU,
   library name or healthy HTTP server is insufficient. Unsupported stays CPU.
2. `beginOriginalGpuScope` must retain its actual scope/Promise before any
   allocation or warmup. Acquire ONE API-owned voice allocation slot (not all
   hardware VRAM), bind current kernel accounting/host coverage and verified
   per-profile cold/hot/reserve peaks, and recheck host RAM/tasks and available
   VRAM before transitions. Concurrent desktop/LLM workloads remain running;
   changed headroom causes refusal/fencing rather than an exclusivity promise.
   No public injected positive admit/health/capacity callback belongs here.
3. Enroll the original GPU worker process, inherited pipe, boot/device/provider/
   profile identity and Core control before model import. Its operations need
   the same original-dispatch, EOF/terminal/result checks and negative process
   custody as CPU, plus original GPU-allocation lifecycle coverage. Use a distinct
   versioned parent/backend discriminant; retain existing CPU hash/identity and
   all CPU fixtures unchanged until an explicit migration is accepted.
4. `releaseOriginalGpuScope` must positively join actual cancel, pending request,
   inherited pipe EOF and process tree, and the driver's original allocation
   owner/release before freeing its voice slot. A lower global used reading,
   process exit event alone, pool status or caller `{retired:true}` is insufficient.
   Unknown cleanup retains the scope/slot and blocks CPU fallback.
5. Prefer fixed backend for each call. After a genuine started-GPU retirement,
   fence/dispose its plans and operations; create a NEW profile/control/call
   incarnation for CPU through its actual approval/admission. Never move an
   existing prepared plan/PCM dispatch to CPU or replay unknown SQL132 admission.
   New caller input may be retried only through its real new operation owner and
   explicit workflow, not by hidden unchanged replay. No backend flip in a lease.

These operations are requirements, not callable implementations or reserved SQL
migration numbers. Source compatibility and CPU proof independence are a Root
review gate. GPU preference cannot be claimed complete by installing this packet.

## Integration and validation

Copy the six `.mjs/.d.mts` sources alongside existing voice-v2 modules. Apply
only exact pinned `production-system` import/prelaunch splices; observations and
budget math are not wired into an admission path. Root may run
`node --test gpu-production.test.mjs` here, then its real package/compiler and
existing CPU/134 negative suites. Tests import only DATA/negative code and READ
source strings; they never invoke the kernel probe, GPU APIs or model code.
Thirty-eight authored controls are unrun by this worker. Root's real provider,
headroom races, allocation retirement, restart, fallback, STT/TTS/audio and UI
acceptance all remain OPEN. No CPU/GPU benchmark or physical qualification exists.

Documented kernel counters: Linux AMDGPU exposes total VRAM and currently used
VRAM as byte-valued sysfs attributes. Our sampling is a conservative observation
of the visible driver, not a reservation or proof that other tenants cannot grow.
Primary source: [Linux kernel AMDGPU sysfs documentation](https://www.kernel.org/doc/html/latest/gpu/amdgpu/driver-misc.html).

## Resource reconciliation

Same declared C-backed WSL root and global20GiB ceiling; original packet immutable.
This packet budget98381B, combined source cap524288B. No downloads, dependencies,
builds, caches, temporary files, GPU/model initialization, device/network probes,
runtime/desktop/Stratus/shared writes. Only unique source/recipes/tests/review/
receipts remain for Root integration. Removed paths:none; removed bytes:0.
No Linux or Windows disk recovery claimed. Protected13Native drafts untouched.
