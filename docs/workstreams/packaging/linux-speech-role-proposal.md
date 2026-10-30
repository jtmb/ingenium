# Linux CPU speech: original Node/subreaper packaging and topology

SOURCE-only proposal, updated to Root's 2026-10-30 integration decision: Linux uses existing init → Node API → retained subreaper → Python3.12 CPU. Root/Voice implement the actual process/control producer and SAME original Core128 durable Voice owner. A Linux full Rust service or new Rust speech role is NOT required. Windows Native original Rust Speech journal remains unchanged. No worker build/install/download/model read/listener/inference/GPU or engine work was performed.

## Why ordinary Native startup is unsuitable

Read-only Native inspection found ordinary non-Windows `apps/service/src/server.rs` constructing `Backend::new` plus full `ServiceState`, and `speech/http_worker.rs` explicitly returning `Unconfigured` for non-Windows protected-token loading. These are recorded compatibility limits, not instructions to weaken them. Do not package or start that full service on Linux, set model/engine profile variables, copy the Windows engine, or turn a Windows retained-handle primitive into a Linux claim. Root's direct Node/Python integration avoids those unrelated constructors altogether.

## Exact ownership and process topology

```text
existing container init/supervisord (PID1)
  existing ingenium-api Node child
    retained original Linux subreaper helper
      /opt/veyra-speech/venv/bin/python3.12 -B <owned CPU bootstrap> <fixed arguments>
        actual phonemizer descendants, if any, retained/reaped by the same scope
```

The existing API original Voice manager retains the actual subreaper Child and inherited private channel at creation. Its child helper is a real Linux subreaper/process owner, never PID1, a detached daemon, an adopted PID, or a new sibling started independently by supervisor. The helper must retain the actual Python original and reaped descendants, relay original authenticated owner metadata, and provide positive completion of the owned scope. Root's worker7 supplies this producer; its ACTUAL source/artifact/path/argv/handshake must be frozen before build/acceptance. This document does not invent a helper binary or claim the current baseline implements it.

Root's worker5 supplies the FIRST durable CPU ACK/control metadata in the SAME original Core128 Voice ledger. No helper SQLite writer, journal, principal, transcript store or scheduler. Node reserves and retains the exact original request/digest/boot/owner generation before inference; Python `SupervisorOwner` delegates `enroll/validate/retain` over the original inherited authenticated channel. `acceptTerminal` matches the committed original transition UUID against Core128. A lost ACK may finalize that SAME already-returned candidate; it cannot execute inference again. Unknown process/request state stays quarantined. Do not pass caller `verified:true`, env UUIDs, PID/start-time, health or missing-socket assertions as enrollment/retirement authority.

Python v1 `--serve` alone does NOT inject a v2 SupervisorOwner. Worker7's concrete CPU bootstrap/control adapter must compose the actual v2 owner before readiness and activation. Do not silently downgrade reconnect to v1. The existing Python/Node v2 identity/proof/client contracts are documented in `docs/workstreams/voice/cpu-reconnect/README.md` and implemented in `cpu_ownership.py` / `voice-v2/cpu-ownership.mjs`; packaging adds no alternate protocol authority.

Use the exact approved fixed Python executable, owned source/config paths, no shell/detaching, private cwd/cache/tmp and descriptor-safe dedicated Veyra token handoff. API and helper retain original child/channel custody throughout; no new public enrollment endpoint or external process command is accepted. Loopback-only speech endpoint127.0.0.1:3011 within the same namespace has no ingress/host port or proxy. If worker7 chooses private framed IPC instead, use its actual reviewed fixed protocol; do not infer HTTP2/v2 activation from a health response.

Credential material belongs to original API/manager and worker only. A Kubernetes Secret volume normally uses symlinks: the original trusted secret owner must hand a retained FD or copy ONLY that selected value into existing private tmpfs and validate original descriptor identity, regular/single-link ownership/permissions/size and stable reads. Do not weaken no-follow checks or import Stratus secrets. The fixed config may refer to that verified private file; token bytes are never argv/Env/logs/receipts/image layers.

## Shutdown, retirement and restart

Stop original API admission, cancel the exact original request, drain/join its real inference scope, signal the owned Python original with the source-qualified SIGINT recipe, and preserve the existing20-second graceful window. The retained subreaper must positively observe wait/join completion of Python AND actual descendants before reporting scope retirement to the original API owner. Node separately retains and joins the subreaper original. A timer, kill success, cancel ACK, helper exit alone, idle/health, missing PID, `/proc` scan or process-group signal is not positive whole-scope completion.

If it has not drained, retain unknown/quarantine and block replacement; do not auto-restart overlap. Existing supervisor continues to manage Node; do not add separately auto-restarting Python/helper siblings with no original API custody. Its stopwaitsecs must cover API→helper→Python cooperative shutdown before any existing final supervisor policy, and actual shutdown must be tested. No new generic process killer, blanket cleanup or workload stop is proposed.

## Fixed compatible image/build inputs

Root adds a dedicated CPU Python stage/closure to the existing Linux API image and the ACTUAL reviewed subreaper artifact/source. Keep the existing init/manager ENTRYPOINT; Python/helper never become PID1. There is no Rust/Tauri/Cargo/desktop/Windows engine build stage for this topology, no engine/profile/model-default file, no CUDA/DirectML/Torch runtime and no GPU device.

Required independently selected and measured inputs:

1. Exact immutable Linux/amd64 Python3.12.x base/config digest and actual executable version/hash, plus the existing final Node/base digest. Match actual distro/glibc suite, architecture and Python ABI. Copying Python from bookworm into moving `node:22-slim` without this proof is unsupported. Pin matching suite/digests and record actual `NEEDED`/SONAME/symbol resolution for Python, helper, ONNX Runtime, CTranslate2, AV, NumPy and phonemizer. Determine libgomp/libstdc++/libgcc/libc/libpython/espeak/audio requirements from exact selected wheels/helper, not a guessed apt list. Resolve exact approved OS package versions/hashes/snapshot or use an already-qualified pinned closure; no unversioned apt fallback.
2. The owned `requirements-cpu.lock` remains authoritative: faster-whisper1.2.1, kokoro-onnx0.6.1, onnxruntime1.31.1, ctranslate2 4.8.4 and historical Piper1.8.0 are pinned. CPU code never instantiates Piper. An approved offline CPython3.12/linux-x86_64 wheelhouse must satisfy EVERY lock requirement/hash with compatible wheels; use `--only-binary=:all: --require-hashes --no-index`, no sdist/runtime fetch. Do not install DirectML or silently minimize the lock. Record each actual wheel SHA and shared-library closure. No wheelhouse exists by implication.
3. Dedicated external read-only CPU assets matching version3 `model-manifest-cpu.example.json`: Kokoro ONNX, voice archive, Systran small.en config/tokenizer/vocabulary/model. Preserve notices/model cards. No Piper weight, GPU/Torch snapshot, active Stratus environment or Windows engine mount. The manifest is a recipe, not proof of present assets or authorization to acquire them. Actual asset preparation and model preflight remain Root's separate scope.
4. Freeze actual worker7 bootstrap/subreaper/control sources, Core128 wire/ACK source, Node manager, owned Python modules, CPU lock, selected wheels/native libraries, image/Source and asset manifest in Root's build/material receipts. The previous Linux full-Rust-role requirement is superseded; do not fall back to it if the actual helper is missing.

Concrete stage recipe AFTER those real inputs exist (Root expands reviewed literal paths/digests; this is not an executable build or approval):

```dockerfile
FROM <approved-python3.12-linux-amd64-image@sha256:digest> AS veyra-speech-cpu
COPY <approved-offline-wheelhouse> /approved-wheels/
COPY packages/veyra-voice/speech-worker/requirements-cpu.lock /approved/requirements-cpu.lock
RUN python3.12 -m venv --copies /opt/veyra-speech/venv
RUN /opt/veyra-speech/venv/bin/python3.12 -m pip install --no-index --only-binary=:all: --require-hashes --find-links=/approved-wheels -r /approved/requirements-cpu.lock
RUN /opt/veyra-speech/venv/bin/python3.12 -m pip check
# Root copies the verified Python3.12 fixed-prefix runtime closure + this venv,
# owned CPU source and ACTUAL reviewed subreaper/bootstrap into existing API target.
# No Node overwrite, venv relocation, full source/env copy, engine or model layer.
# Existing init/manager ENTRYPOINT remains authoritative.
```

Python interpreter prefix/shared libraries must remain compatible (normally `/usr/local`), venv stays `/opt/veyra-speech/venv`; explicitly select copy paths so Node's existing runtime is not overwritten. If helper is compiled, Root's existing leased build owner pins its toolchain/target/source and actual ELF ABI; this proposal does not choose a new compiler or run one. No install helper may initialize caches outside the existing task output root.

Operator-owned worker config is explicit CPU backend, dedicated Veyra instance, loopback host/port or actual approved private channel, `/models` read-only root and exact manifest filename, original dedicated token FD/file, existing private writable scratch, and resource-bound CPU thread count. Configure all Python cache/TEMP under that private scratch, source/runtime/assets read-only. Voice/Chat agent/model defaults and Windows engine config are not inputs. Shape-only `--check-config` and actual dependency import/link checks do not establish readiness: the worker opens its listener only after real known-phrase STT/TTS preflight, which loads/invokes CPU models and requires Root's activation/resource acceptance.

## Resource, cleanup and remaining gates

Before ANY Root build/download, measure Windows C: and destination free space, inventory and actually remove eligible inactive obsolete task outputs after all preservation/process/container/mount/regeneration checks, and budget COMPLETE peak: Python runtime, wheelhouse, installed venv/native libs, helper build outputs if needed, OCI/image layers, selected CPU assets, runtime scratch and required retention. Reuse compatible lock-keyed deps and existing content; no duplicate image/source/env trees. Existing paired C:/WSL20GiB ceiling and15GiB floors remain; no silent relocation/hidden WSL output. Unknown sizes must be measured before starting. Preserve active/protected outputs/refusals; Linux recovered bytes do not imply Windows VHDX recovery.

After each consumer, reconcile eligible wheel/extraction/build/cache outputs with exact owned paths and measured bytes; keep only required runtime/asset content with a concrete consumer/end condition and minimal unique evidence/manifests. This worker generated only small durable source/docs/receipts in the existing root, no dependency/build/cache/temp outputs; removed paths none/0bytes. Prior protected exceptions unchanged.

OPEN acceptance: actual helper/Node control/Core128 ledger producers, private credential custody, Python3.12/wheel/ELF ABI, exact CPU assets/readiness, real original enrollment/ACK-loss/reconnect/retirement, cancellation/descendant drain/restart, human speech/noise/latency/barge-in, persistence, container shutdown and complete platform/product/visual release gates. Coordination goes through authorized Root reports to existing Voice/Core workers, with no new chats or helper DB writer.