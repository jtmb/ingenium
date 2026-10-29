"""Explicit CPU ONNX/Kokoro and faster-whisper adapters; never a GPU fallback."""

from __future__ import annotations

import hashlib
import hmac
from pathlib import Path
import threading
import time
from typing import Any, Iterator

from inference_control import check_inference
from veyra_worker import Job, Models, Settings, WorkerError, request_id


def verify_cpu_manifest(root: Path, manifest: object) -> dict[str, object]:
    """Verify only the deliberately selected CPU profile and its exact assets."""
    if (
        not isinstance(manifest, dict)
        or set(manifest)
        != {
            "version",
            "backend",
            "voice",
            "kokoro",
            "transcription",
            "license",
            "revision",
        }
        or manifest["version"] != 3
        or manifest["backend"] != "cpu-onnx"
        or not manifest["license"]
        or not manifest["revision"]
    ):
        raise WorkerError("MODEL_MANIFEST_INVALID")
    kokoro, transcription = manifest["kokoro"], manifest["transcription"]
    if (
        not isinstance(kokoro, dict)
        or set(kokoro) != {"model", "voices", "revision", "license", "presets"}
        or not kokoro["revision"]
        or not kokoro["license"]
    ):
        raise WorkerError("MODEL_MANIFEST_INVALID")
    if (
        not isinstance(transcription, dict)
        or set(transcription) != {"directory", "files", "revision", "license"}
        or not transcription["revision"]
        or not transcription["license"]
        or not isinstance(transcription["directory"], str)
        or not isinstance(transcription["files"], list)
        or not transcription["files"]
    ):
        raise WorkerError("MODEL_MANIFEST_INVALID")
    entries = [kokoro["model"], kokoro["voices"], *transcription["files"]]
    declared: set[Path] = set()
    for entry in entries:
        if (
            not isinstance(entry, dict)
            or set(entry) != {"file", "sha256"}
            or not isinstance(entry["file"], str)
            or not isinstance(entry["sha256"], str)
            or len(entry["sha256"]) != 64
            or any(character not in "0123456789abcdef" for character in entry["sha256"])
        ):
            raise WorkerError("MODEL_MANIFEST_INVALID")
        relative = Path(entry["file"])
        file = (root / relative).resolve(strict=True)
        if (
            relative.is_absolute()
            or ".." in relative.parts
            or not file.is_relative_to(root)
            or not file.is_file()
        ):
            raise WorkerError("MODEL_PATH_INVALID")
        with file.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        if not hmac.compare_digest(digest, entry["sha256"]):
            raise WorkerError("MODEL_HASH_MISMATCH")
        if entry in transcription["files"]:
            declared.add(file)
    directory = (root / transcription["directory"]).resolve(strict=True)
    if not directory.is_relative_to(root) or not directory.is_dir():
        raise WorkerError("MODEL_PATH_INVALID")
    if declared != {
        file.resolve(strict=True) for file in directory.rglob("*") if file.is_file()
    }:
        raise WorkerError("MODEL_FILES_UNVERIFIED")
    presets = kokoro["presets"]
    if not isinstance(presets, list) or not 1 <= len(presets) <= 20:
        raise WorkerError("MODEL_VOICES_INVALID")
    ids: set[str] = set()
    for preset in presets:
        if (
            not isinstance(preset, dict)
            or set(preset) != {"id", "label", "language"}
            or preset["language"] not in ("en-us", "en-gb")
            or not isinstance(preset["label"], str)
            or not 1 <= len(preset["label"]) <= 80
        ):
            raise WorkerError("MODEL_VOICES_INVALID")
        voice = request_id(preset["id"])
        if voice in ids:
            raise WorkerError("MODEL_VOICES_INVALID")
        ids.add(voice)
    if manifest["voice"] not in ids:
        raise WorkerError("MODEL_VOICES_INVALID")
    return manifest


class CpuTranscriber:
    """Pin faster-whisper to local CPU int8 models and one serialized decoder."""

    def __init__(
        self,
        root: Path,
        config: dict[str, Any],
        threads: int,
        model_factory: Any = None,
    ) -> None:
        if model_factory is None:
            from faster_whisper import WhisperModel

            model_factory = WhisperModel
        self.model = model_factory(
            str(root / config["directory"]),
            device="cpu",
            compute_type="int8",
            cpu_threads=threads,
            num_workers=1,
            local_files_only=True,
        )

    def transcribe(self, pcm: bytes, job: Job) -> str:
        """Use qualified segmentation/confidence settings; cancellation drops results."""
        import numpy as np

        check_inference(job)
        audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        if float(np.sqrt(np.mean(audio * audio))) < 0.002:
            return ""
        segments, _ = self.model.transcribe(
            audio,
            language="en",
            beam_size=1,
            temperature=0,
            condition_on_previous_text=False,
            vad_filter=True,
            vad_parameters={
                "min_speech_duration_ms": 250,
                "min_silence_duration_ms": 700,
            },
            no_speech_threshold=0.6,
            log_prob_threshold=-1,
            compression_ratio_threshold=2.4,
        )
        result: list[str] = []
        for segment in segments:
            check_inference(job)
            if segment.no_speech_prob <= 0.6 and segment.avg_logprob >= -1:
                result.append(segment.text.strip())
            if sum(map(len, result)) > 2000:
                raise WorkerError("TRANSCRIPT_LIMIT", 502)
        check_inference(job)
        return " ".join(result)


class CpuKokoro:
    """Bind ONNX to CPUExecutionProvider without automatic provider selection."""

    def __init__(
        self,
        root: Path,
        config: dict[str, Any],
        threads: int,
        ort: Any = None,
        engine_factory: Any = None,
    ) -> None:
        if ort is None:
            import onnxruntime as ort_module

            ort = ort_module
        if engine_factory is None:
            from kokoro_onnx import Kokoro

            engine_factory = Kokoro.from_session
        options = ort.SessionOptions()
        options.intra_op_num_threads, options.inter_op_num_threads = threads, 1
        session = ort.InferenceSession(
            str(root / config["model"]["file"]),
            sess_options=options,
            providers=["CPUExecutionProvider"],
        )
        if session.get_providers() != ["CPUExecutionProvider"]:
            raise WorkerError("CPU_PROVIDER_MISMATCH", 503)
        self.engine = engine_factory(session, str(root / config["voices"]["file"]))
        if any(
            preset["id"] not in self.engine.get_voices() for preset in config["presets"]
        ):
            raise WorkerError("MODEL_VOICES_INVALID")


class CpuPreset:
    """Share one CPU engine among explicitly listed voices."""

    def __init__(self, engine: CpuKokoro, voice: str, language: str) -> None:
        self.engine, self.voice, self.language = engine, voice, language

    def chunks_for_job(
        self, text: str, job: Job
    ) -> Iterator[tuple[int, int, int, bytes]]:
        """Check cancellation around native ONNX work; no hard-preemption claim."""
        import numpy as np

        check_inference(job)
        audio, rate = self.engine.engine.create(
            text, voice=self.voice, lang=self.language, speed=1.0
        )
        check_inference(job)
        if (
            rate != 24000
            or audio.ndim != 1
            or audio.size > rate * 15
            or not np.isfinite(audio).all()
        ):
            raise WorkerError("INVALID_MODEL_AUDIO", 502)
        yield rate, 1, 2, (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()


def load_cpu_models(settings: Settings, manifest: dict[str, Any]) -> Models:
    """Warm both deliberately selected CPU models before readiness or socket bind."""
    import numpy as np

    if settings.backend != "cpu-onnx" or settings.cpu_threads is None:
        raise WorkerError("CPU_CONFIG_INVALID")
    engine = CpuKokoro(settings.model_root, manifest["kokoro"], settings.cpu_threads)
    voices = {
        preset["id"]: CpuPreset(engine, preset["id"], preset["language"])
        for preset in manifest["kokoro"]["presets"]
    }
    catalog = [
        {**preset, "engine": "kokoro"} for preset in manifest["kokoro"]["presets"]
    ]
    transcriber = CpuTranscriber(
        settings.model_root, manifest["transcription"], settings.cpu_threads
    )
    phrase = "Hello. We can keep talking naturally."
    job = Job("startup:veyra-cpu", threading.Event(), time.monotonic() + 30)
    rate, _, _, raw = next(voices[manifest["voice"]].chunks_for_job(phrase, job))
    values = np.frombuffer(raw, dtype="<i2").astype(np.float32)
    positions = np.arange(int(len(values) * 16000 / rate)) * rate / 16000
    pcm = (
        np.interp(positions, np.arange(len(values)), values)
        .round()
        .astype("<i2")
        .tobytes()
    )
    text = transcriber.transcribe(pcm, job)

    def normalized(value: str) -> str:
        """Compare only the known synthetic round-trip phrase, not human accuracy."""
        return " ".join(
            "".join(
                character if character.isalnum() else " " for character in value.lower()
            ).split()
        )

    if normalized(text) != normalized(phrase):
        raise WorkerError("CPU_STARTUP_ROUNDTRIP_FAILED", 503)
    info: dict[str, object] = {
        "qualified": True,
        "backend": "cpu-onnx",
        "faulted": False,
        "warmup": {"knownPhraseMatched": True},
    }
    return Models(voices, catalog, transcriber, info, backend="cpu-onnx")
