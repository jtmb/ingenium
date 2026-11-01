"""ROOT FUTURE EXECUTION ONLY, inside kernel-owner's fresh hard-limited leaf.

Real production CPU model code, no fake loader/owner/positive proof or network.
This measures model cold/hot behavior; it cannot qualify the API/private helper
wire or emit production approval. Root must qualify those exact originals too.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import resource
import sys
import threading
import time


def positive(value):
    return type(value) is int and value > 0


def bounded(path, limit=65536):
    with open(path, "rb") as handle:
        value = handle.read(limit + 1)
    if len(value) > limit:
        raise ValueError("qualification fact bound")
    return value.decode("utf-8", errors="strict")


def kernel(run_id, envelope):
    expected = f"0::/veyra-cpu-qualification-{run_id}\n"
    if bounded("/proc/self/cgroup") != expected:
        raise ValueError("not the actual fresh qualification original")
    root = Path("/sys/fs/cgroup") / f"veyra-cpu-qualification-{run_id}"
    if root.is_symlink() or root.stat().st_uid != 0:
        raise ValueError("qualification kernel custody")
    memory = bounded(root / "memory.max", 128).strip()
    pids = bounded(root / "pids.max", 128).strip()
    cpu = bounded(root / "cpu.max", 128).strip()
    if memory != str(envelope["memoryBytes"]) or pids != str(envelope["pids"]):
        raise ValueError("qualification hard limits mismatch")
    if cpu != f'{envelope["quotaUsec"]} {envelope["periodUsec"]}' or bounded(root / "memory.swap.max", 128).strip() != "0":
        raise ValueError("qualification CPU/swap limit mismatch")
    if os.geteuid() == 0:
        raise ValueError("model child must have dropped Root authority")
    return root


def snapshot(root, phase):
    fields = ("memory.current", "memory.peak", "memory.events", "pids.current", "pids.peak", "pids.events", "cpu.stat")
    result = {"phase": phase, "monotonicNs": time.monotonic_ns(), "pid": os.getpid(),
              "procStat": bounded("/proc/self/stat", 4096),
              "procStatus": bounded("/proc/self/status"),
              "smapsRollup": bounded("/proc/self/smaps_rollup"),
              "ruMaxRssBytes": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss * 1024,
              "kernel": {name: bounded(root / name) for name in fields}}
    print(json.dumps(result, separators=(",", ":")), flush=True)


def main():
    if sys.platform != "linux" or sys.version_info[:3] != (3, 12, 13) or len(sys.argv) != 3:
        raise ValueError("exact qualified Linux CPython3.12.13 and protected plan required")
    run_id, plan_path = sys.argv[1:]
    plan = json.loads(bounded(plan_path))
    if plan.get("kind") != "cpu-model-qualification-input-v1" or plan.get("productionApproval") is not False:
        raise ValueError("separate non-authority model input required")
    if plan.get("runId") != run_id or set(plan) != {"kind", "productionApproval", "runId", "hardLimits", "profile", "profileFileSha256"}:
        raise ValueError("closed original model input required")
    envelope = plan["hardLimits"]
    if not all(positive(envelope.get(key)) for key in ("memoryBytes", "pids", "quotaUsec", "periodUsec", "timeoutMs")):
        raise ValueError("actual finite operator hard limits required")
    root = kernel(run_id, envelope)  # BEFORE importing NumPy/ONNX/model code.
    profile_path = Path(plan["profile"])
    profile_bytes = profile_path.read_bytes()
    if hashlib.sha256(profile_bytes).hexdigest() != plan["profileFileSha256"]:
        raise ValueError("actual protected profile changed")
    profile = json.loads(profile_bytes)
    if profile["settings"]["backend"] != "cpu-onnx" or profile["enableInference"] is not True:
        raise ValueError("explicit CPU profile required")
    if not positive(profile.get("memoryBytes")):
        raise ValueError("exact production worker address-space cap required")
    resource.setrlimit(resource.RLIMIT_AS, (profile["memoryBytes"], profile["memoryBytes"]))
    executable = Path(sys.executable).resolve(strict=True)
    with executable.open("rb") as handle:
        if hashlib.file_digest(handle, "sha256").hexdigest() != profile["pythonSha256"]:
            raise ValueError("actual interpreter hash changed")
    for name, expected in profile["bundle"].items():
        file = Path(profile["workerRoot"]) / name
        if file.is_symlink() or file.stat().st_size > 1048576:
            raise ValueError("code bundle custody/bound")
        with file.open("rb") as handle:
            if hashlib.file_digest(handle, "sha256").hexdigest() != expected:
                raise ValueError("code bundle changed")
    for directory in [profile["workerRoot"], *profile["pythonPaths"]]:
        path = Path(directory)
        if not path.is_absolute() or path.is_symlink() or not path.is_dir():
            raise ValueError("approved immutable code/dependency path required")
        sys.path.insert(0, str(path))
    for variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS"):
        os.environ[variable] = str(profile["settings"]["cpu_threads"])
    for variable in ("CUDA_VISIBLE_DEVICES", "HIP_VISIBLE_DEVICES", "ROCR_VISIBLE_DEVICES"):
        if os.environ.get(variable) != "":
            raise ValueError("CPU-only environment required")
    snapshot(root, "before-cold")
    from veyra_worker import Settings, Job
    from cpu_models import verify_cpu_manifest, load_cpu_models
    settings = Settings.parse(profile["settings"])
    manifest = json.loads((settings.model_root / settings.model_manifest).read_text())
    verify_cpu_manifest(settings.model_root, manifest)
    models = load_cpu_models(settings, manifest)  # Actual production warmup.
    snapshot(root, "cold-ready")
    import numpy as np
    phrase = "Hello. We can keep talking naturally."
    normalize = lambda text: " ".join("".join(c if c.isalnum() else " " for c in text.lower()).split())
    snapshot(root, "before-hot")
    for preset in manifest["kokoro"]["presets"]:
        job = Job("qualification:" + preset["id"], threading.Event(), time.monotonic() + 15)
        chunks = list(models.voices[preset["id"]].chunks_for_job(phrase, job))
        if len(chunks) != 1:
            raise ValueError("unexpected CPU chunk contract")
        rate, channels, width, raw = chunks[0]
        if channels != 1 or width != 2 or len(raw) > rate * 15 * 2:
            raise ValueError("bounded actual audio contract")
        values = np.frombuffer(raw, dtype="<i2").astype(np.float32)
        positions = np.arange(int(len(values) * 16000 / rate)) * rate / 16000
        pcm = np.interp(positions, np.arange(len(values)), values).round().astype("<i2").tobytes()
        text = models.transcriber.transcribe(pcm, job)
        if normalize(text) != normalize(phrase):
            raise ValueError("actual selected-voice synthetic roundtrip failed")
        print(json.dumps({"phase": "hot-roundtrip", "voice": preset["id"], "knownPhraseMatched": True,
                          "pcmBytes": len(pcm), "audioSha256": hashlib.sha256(raw).hexdigest()}), flush=True)
        del chunks, raw, values, positions, pcm, text
    snapshot(root, "after-hot")
    print(json.dumps({"phase": "model-case-returned", "productionWireValidated": False,
                      "productionApprovalEligible": False, "actualModelCodeUsed": True}), flush=True)


if __name__ == "__main__":
    main()
