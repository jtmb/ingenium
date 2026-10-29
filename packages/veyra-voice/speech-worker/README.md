# Veyra speech worker

Veyra-owned implementation of the bounded Stratus speech wire protocol. This package does not attach to Stratus's active service, state, credentials or caches. It contains no model weights and has not been started with a neural backend by the worker chat.

## Explicit backend selection

| Config `backend` | Implemented source path | Platform prerequisite | Exact assets |
| --- | --- | --- | --- |
| `cpu-onnx` | Kokoro ONNX 0.6.1, `CPUExecutionProvider`; faster-whisper 1.2.1, CPU/int8/local-only | Python 3.12 x86_64 Linux or Windows/WSL; compatible locked wheels and native libraries | `model-manifest-cpu.example.json`: Kokoro ONNX and six-voice style archive, Systran small.en four-file model |
| `directml` | Frozen Stratus Kokoro/Whisper DirectML kernels with Veyra-only explicit memory settings | Python 3.12 Linux x86_64 in WSL with `/dev/dxg`, matching DirectML wheels and WSL graphics libraries | `model-manifest-gpu.example.json`: Kokoro Torch/config, six-voice archive and Whisper base.en eleven-file snapshot |

There is no `auto` backend, CUDA selection, remote provider, paid API, downloaded-at-start model or automatic CPU fallback. A failure leaves the selected backend unavailable. The deliberate CPU path was explicitly requested by the coordinator for Linux voice; it does not change Stratus's GPU-only policy or Veyra's existing Windows inference engine.

These source profiles are English-only (American/British voice presets); multilingual accuracy is not claimed. Backend/provider support does not imply human speech acceptance.

Both paths require real startup synthesis and recognition of a known synthetic phrase before a socket opens. This is a readiness preflight, not human speech, noise, echo, latency, physical-memory or full platform acceptance. The worker tests inject model-free ports and do not run that neural preflight. Native Windows/Linux wheel compatibility, CPU performance and current DirectML cancellation/recovery still require coordinator qualification. ARM, unsupported CPU instructions, missing offline assets or another Python ABI remain unavailable, not substitution opportunities.

## Dependency and asset preparation: coordinator only

Use a leased task-owned Python 3.12 environment and backend-specific hash-locked dependencies. No install was run by this source worker. For an already approved offline wheelhouse:

```sh
"$VEYRA_SPEECH_PYTHON" -m pip install --require-hashes --no-index \
  --find-links "$APPROVED_WHEELHOUSE" -r requirements-cpu.lock
```

For DirectML select `requirements-directml.lock` instead. These invocation variables must identify coordinator-approved existing paths; the recipe does not imply that a wheelhouse, runtime or assets exist. Online preparation, wheel builds and model acquisition require the coordinator's measured resource lease. Do not install both backend trees speculatively or copy an active Stratus environment.

The CPU lock retains the source-qualified historical dependency closure, including Piper. The selected Veyra CPU implementation never instantiates Piper and requires no Piper weight. The lock was retained rather than claiming an untested dependency minimization; packaging may regenerate a smaller reviewed lock under its own lease. DirectML's host Torch wheel has a CPU build label because torch-directml supplies the GPU backend; the selected DirectML models still enforce GPU tensors and quarantine fallback/operator faults.

Populate a dedicated operator-approved **read-only** asset mount using the chosen example manifest. Copy the manifest as the configured `model_manifest` filename only after the coordinator verifies every file/hash/revision and required model card/notice. No personal source/runtime path is a default. No model download, copy or hash scan of actual user weights was done here. The manifest verifier rejects traversal, files resolving outside the asset root, changed bytes and unlisted files inside the STT/TTS model component directories.

## Configuration and start

Select `config-cpu.example.json` or `config-directml.example.json`, then supply actual approved absolute paths. `--check-config` checks shape only and never probes a device, reads weights or loads a model:

```sh
python3 -B veyra_worker.py --config config-cpu.example.json --check-config
```

The examples are not installed runtime configuration. `/models`, `/run/secrets/veyra-speech-token` and `/run/veyra-speech` are mount contracts to be provisioned by the coordinator. Windows CPU configuration uses the same fields with actual approved Windows absolute paths; Python's `Path` handles the selected platform. Do not infer a username, drive or repo root from these examples.

| Field | Required meaning |
| --- | --- |
| `version` / `backend` | `1`, and exactly `cpu-onnx` or `directml`; no default/fallback |
| `instance_id` | Dedicated Veyra service identity, checked by the API consumer when configured |
| `host` / `port` | Default example loopback `127.0.0.1:3011`; `0.0.0.0` requires explicit `private_network:true` and actual private-network policy |
| `model_root` / `model_manifest` | Approved read-only root and a filename inside it for the selected exact manifest |
| `token_file` | Dedicated Veyra-only 32–192 character ASCII bearer secret; no Discord, provider, database or Stratus credential reuse |
| `scratch_root` | Approved writable root for all service temp/cache directories; canonical path and storage/retention owner remain coordinator responsibilities |
| `cpu_threads` | CPU-only, explicit integer 1–8; models remain one worker/one decoder with no parallel neural requests |
| `physical_vram_mib` / `budget_mib` | DirectML-only explicit physical capacity and selected 512 MiB-step budget. The example is an 8 GiB declaration, not a measurement of this machine; budget is limited to the retained 4–8 GiB qualification envelope |

Only after the coordinator authorizes actual inference and completes platform/resource admission:

```sh
python3.12 -B veyra_worker.py --config "$APPROVED_CONFIG" --serve --enable-inference
```

Both flags are required. Missing credentials, dependencies, platform, hashes, selected model/voice or startup round-trip prevent listener creation. The worker configures `TEMP`, `TMP`, `TMPDIR`, `HF_HOME`, `HF_HUB_CACHE`, `TRANSFORMERS_CACHE`, `TORCH_HOME` and `XDG_CACHE_HOME` under `scratch_root`, checks child containment and sets offline/telemetry-disable flags before importing model packages. No machine/user environment or existing runtime profile is changed. DirectML receives only process-scoped `VEYRA_SPEECH_PHYSICAL_VRAM_MIB` and `VEYRA_SPEECH_BUDGET_MIB`; no `STRATUS_*` setting is consulted.

Packaging must supply CPU shared-library prerequisites required by the locked ONNX/Whisper/phonemizer stack, or the WSL DirectML graphics-library mount for that explicit backend. Use an approved pinned base and check the exact dependencies on each release platform. Startup/shutdown, dependency consistency and actual model/voice availability are still runtime gates; a syntax/config check cannot establish them.

## Authenticated wire contract

All routes require the dedicated bearer. Raw audio/transcript/text are memory-only and omitted from logs.

The complete private wire schema is [speech-worker-openapi.json](../../../docs/workstreams/voice/speech-worker-openapi.json).

| Route | Semantics |
| --- | --- |
| `GET /health` | Identifies `service:veyra-speech`, `instanceId`, selected backend, STT/TTS readiness, actual `gpuReady` and busy state. Ready is false/HTTP 503 after quarantine. CPU readiness explicitly reports `backend:cpu-onnx,gpuReady:false` |
| `GET /v1/voices` | Explicit installed manifest catalog and default voice, never an arbitrary path/catalog |
| `POST /v1/transcriptions` | `application/octet-stream`, `X-Request-Id`, normalized 16 kHz mono s16le; 8,000–480,000 bytes. Returns final `{text,language:en,durationMs}`; empty text means suppressed silence. No fabricated partial transcript |
| `POST /v1/speech` | Exact JSON `{requestId,text,voice}`; max 600 Unicode characters/2,400 UTF-8 bytes; configured voice only; at most 15 seconds mono s16 PCM WAV |
| `POST /v1/cancel` | Exact `{requestId}`; idempotent named cancellation, including a bounded 30-second pre-admission tombstone; at most 128 tombstones |

No file/URL/audio path, model selection, runtime memory mutation or arbitrary command endpoint exists. HTTP framing rejects transfer encoding, duplicate/invalid lengths and over-limit bodies before model admission. Each connection has a six-second read timeout, at most eight handlers and one nonblocking shared inference lock. Inference requests have a five-second cooperative deadline.

Cancellation invalidates results and future cooperative work. A submitted CTranslate2/ONNX or GPU kernel can continue until it returns; the inference lock stays held, so a replacement cannot overlap it. DirectML checks at GPU dispatch boundaries as in the frozen source. A cancelled/deadline job returns 409/504 without claiming hard preemption, refund, or 250 ms hardware stop. Actual stop latency remains an attended gate. Genuine model/library faults quarantine readiness; the worker never swaps backend.

The API consumer must now configure `backend:'cpu-onnx'` explicitly for CPU or `backend:'directml'` for DirectML and should configure the matching `instanceId`. It rejects a Stratus service marker, wrong instance, mismatched backend or CPU response under a DirectML selection. A source-compatible wire is not proof of service ownership/readiness.

## Source-only tests and cleanup

The dependency-free `unittest` suite requires an empty `speech-fixtures` child of this stream's declared coordination directory, with `VEYRA_VOICE_TEST_ROOT` pointing there and `TEMP/TMP/TMPDIR` pointing to its parent. It uses tiny fixture files and fake model ports; no server binds and no neural package imports. The coordinator/worker cleanup receipt inventories, verifies, measures and removes those fixtures after the consumer exits. Never run tests against real model assets.

Authored Python modules pass Ruff and strict mypy (Python 3.12 target, external model imports skipped); model-free execution here used the available Python 3.14 standard library. The frozen DirectML kernel is retained with its original style and provenance, not claimed as type-checked or requalified by these wrapper checks. See `provenance.json` and [the coordinator integration request](../../../docs/workstreams/voice/speech-backend-integration.md).
