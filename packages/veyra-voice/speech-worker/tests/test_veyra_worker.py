"""Model-free Veyra protocol, manifest and explicitly selected backend checks."""

from __future__ import annotations

import hashlib
from email.message import Message
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
import sys
import threading
import time
import unittest
from unittest.mock import patch
import wave
from typing import Any, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cpu_models import CpuKokoro, CpuTranscriber
from veyra_worker import (
    Application,
    Handler,
    Job,
    Models,
    Settings,
    SpeechWorker,
    WorkerError,
    prepare,
    verified_manifest,
)


class Model:
    """Emit tiny synthetic bytes without importing or invoking a neural backend."""

    def chunks_for_job(
        self, text: str, job: Job
    ) -> Iterator[tuple[int, int, int, bytes]]:
        """Provide one deterministic PCM chunk for wire/cancellation tests."""
        yield 24000, 1, 2, b"\x01\x00" * 240


class Transcriber:
    """Return a fixed fixture transcript, never human audio recognition."""

    def transcribe(self, pcm: bytes, job: Job) -> str:
        """Preserve the empty-result semantics of suppressed silence."""
        return "" if not any(pcm) else "fixture phrase"


def models(backend: str = "directml") -> Models:
    """Construct explicit fixture readiness without external model dependencies."""
    info = (
        {"qualified": True, "neuralCpuFallback": False}
        if backend == "directml"
        else {"qualified": True, "backend": "cpu-onnx"}
    )
    return Models(
        {"af_heart": Model()},
        [
            {
                "id": "af_heart",
                "label": "Fixture",
                "language": "en-us",
                "engine": "kokoro",
            }
        ],
        Transcriber(),
        info,
        backend=backend,
    )


def configuration(backend: str = "cpu-onnx") -> dict:
    """Use declared example paths only; parsing this mapping touches no files."""
    value = {
        "version": 1,
        "backend": backend,
        "instance_id": "veyra-fixture",
        "host": "127.0.0.1",
        "port": 3011,
        "private_network": False,
        "model_root": "/models",
        "model_manifest": "manifest.json",
        "token_file": "/run/secrets/veyra-token",
        "scratch_root": "/run/veyra-speech",
    }
    value.update(
        {"physical_vram_mib": 8192, "budget_mib": 8192}
        if backend == "directml"
        else {"cpu_threads": 4}
    )
    return value


class WorkerTests(unittest.TestCase):
    """Exercise real worker orchestration against model-free injected ports."""

    def setUp(self) -> None:
        self.worker = SpeechWorker(models(), "af_heart", "veyra-fixture")
        self.body = {
            "requestId": "voice:fixture:1",
            "text": "Fixture only",
            "voice": "af_heart",
        }

    def test_imports_do_not_load_model_or_gpu_modules(self) -> None:
        """Even CPU selection remains a configuration action until admission."""
        for name in (
            "torch",
            "torch_directml",
            "numpy",
            "onnxruntime",
            "faster_whisper",
            "kokoro_onnx",
        ):
            self.assertNotIn(name, sys.modules)

    def test_wave_and_transcription_format_limits(self) -> None:
        """Return valid mono WAV and correctly scoped normalized-PCM metadata."""
        with wave.open(io.BytesIO(self.worker.synthesize(self.body))) as audio:
            self.assertEqual(
                (audio.getframerate(), audio.getnchannels(), audio.getsampwidth()),
                (24000, 1, 2),
            )
        self.assertEqual(self.worker.transcribe("voice:empty", bytes(8000))["text"], "")
        self.assertEqual(
            self.worker.transcribe("voice:words", b"\x01\x00" * 4000)["durationMs"], 250
        )
        for pcm in (b"", bytes(7999), bytes(480002)):
            with self.assertRaises(WorkerError):
                self.worker.transcribe("voice:bad", pcm)
        self.assertFalse(self.worker.inference_lock.locked())

    def test_invalid_text_voice_and_options_never_admit_work(self) -> None:
        """No request can select a path, arbitrary voice or extended text."""
        for body in (
            {**self.body, "text": "a" * 601},
            {**self.body, "text": "a\x00"},
            {**self.body, "voice": "../other"},
            {**self.body, "path": "/models/other"},
        ):
            with self.assertRaises(WorkerError):
                self.worker.synthesize(body)
            self.assertIsNone(self.worker.job)

    def test_pre_admission_cancel_and_bounded_tombstones(self) -> None:
        """A cancel arriving first still prevents the named request from running."""
        self.worker.cancel(self.body["requestId"])
        with self.assertRaises(WorkerError) as caught:
            self.worker.synthesize(self.body)
        self.assertEqual(
            (caught.exception.code, caught.exception.status), ("CANCELLED", 409)
        )
        for number in range(127):
            self.worker.cancel(f"voice:other:{number}")
        self.worker.cancel(self.body["requestId"])
        with self.assertRaises(WorkerError) as caught:
            self.worker.cancel("voice:overflow")
        self.assertEqual(caught.exception.status, 429)
        self.assertEqual(len(self.worker.cancelled), 128)

    def test_active_cancel_holds_lock_until_backend_returns_and_discards_audio(
        self,
    ) -> None:
        """No hard-preemption claim or overlapping replacement inference."""
        entered, release = threading.Event(), threading.Event()

        class Blocking:
            """Hold a fixture step until cancellation has been observed."""

            def chunks_for_job(
                self, text: str, job: Job
            ) -> Iterator[tuple[int, int, int, bytes]]:
                """Yield only after the test releases its fake kernel."""
                entered.set()
                if not release.wait(2):
                    raise AssertionError("fixture did not release")
                yield 24000, 1, 2, b"\0\0"

        self.worker.models.voices = {"af_heart": Blocking()}
        failures: list[str] = []

        def run() -> None:
            """Capture only stable cancellation codes from the fixture thread."""
            try:
                self.worker.synthesize(self.body)
            except WorkerError as error:
                failures.append(error.code)

        thread = threading.Thread(target=run)
        try:
            thread.start()
            self.assertTrue(entered.wait(1))
            self.worker.cancel(self.body["requestId"])
            self.assertTrue(self.worker.inference_lock.locked())
            with self.assertRaises(WorkerError) as caught:
                self.worker.transcribe("voice:overlap", bytes(8000))
            self.assertEqual(caught.exception.code, "BUSY")
        finally:
            release.set()
            thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(failures, ["CANCELLED"])
        self.assertFalse(self.worker.inference_lock.locked())
        self.assertTrue(self.worker.ready())

    def test_deadline_and_fault_are_distinct(self) -> None:
        """Deadline drops results; a genuine backend fault quarantines readiness."""

        class Expired:
            """Advance the fixture deadline without sleeping."""

            def chunks_for_job(
                self, text: str, job: Job
            ) -> Iterator[tuple[int, int, int, bytes]]:
                """Return audio after making it obsolete."""
                job.deadline = time.monotonic() - 1
                yield 24000, 1, 2, b"\0\0"

        self.worker.models.voices = {"af_heart": Expired()}
        with self.assertRaises(WorkerError) as caught:
            self.worker.synthesize(self.body)
        self.assertEqual(
            (caught.exception.code, caught.exception.status), ("DEADLINE", 504)
        )
        self.assertTrue(self.worker.ready())

        class Broken:
            """Represent a native engine fault without invoking one."""

            def chunks_for_job(
                self, text: str, job: Job
            ) -> Iterator[tuple[int, int, int, bytes]]:
                """Raise an opaque error; it must never appear on the wire."""
                raise RuntimeError("private engine detail")

        self.worker.models.voices = {"af_heart": Broken()}
        with self.assertRaises(WorkerError) as caught:
            self.worker.synthesize({**self.body, "requestId": "voice:fault"})
        self.assertEqual(caught.exception.code, "SPEECH_BACKEND_FAILED")
        self.assertFalse(self.worker.ready())

    def test_application_auth_health_audio_and_bad_requests_without_server(
        self,
    ) -> None:
        """Exercise the actual wire router in memory; do not bind any socket."""
        application = Application(self.worker, "x" * 32)
        headers = {
            "authorization": "Bearer " + "x" * 32,
            "content-type": "application/json",
        }
        self.assertEqual(application.handle("GET", "/health", {}).status, 401)
        health = application.handle("GET", "/health", headers)
        self.assertEqual(health.status, 200)
        self.assertEqual(json.loads(health.data)["service"], "veyra-speech")
        audio = application.handle(
            "POST", "/v1/speech", headers, json.dumps(self.body).encode()
        )
        self.assertEqual((audio.status, audio.content_type), (200, "audio/wav"))
        self.assertEqual(
            application.handle("POST", "/v1/speech", headers, b"{").status, 400
        )
        self.assertEqual(
            application.handle("POST", "/v1/speech", headers, b"x" * 4097).status, 413
        )
        self.assertEqual(
            application.handle("POST", "/v1/runtime", headers, b"{}").status, 404
        )

    def test_explicit_cpu_readiness_does_not_claim_gpu_or_fallback(self) -> None:
        """CPU is available only as the named selected backend."""
        worker = SpeechWorker(models("cpu-onnx"), "af_heart", "veyra-cpu-fixture")
        self.assertTrue(worker.health()["ready"])
        self.assertFalse(worker.health()["gpuReady"])
        self.assertEqual(worker.health()["backend"], "cpu-onnx")
        worker.models.runtime_info["qualified"] = False
        self.assertFalse(worker.ready())
        with self.assertRaises(WorkerError):
            worker.synthesize(self.body)

    def test_http_framing_authenticates_before_body_and_rejects_ambiguous_lengths(
        self,
    ) -> None:
        """Run the real handler against memory streams, never a listening server."""
        application = Application(self.worker, "x" * 32)

        def wire(
            headers: Message, body: bytes, unreadable: bool = False
        ) -> tuple[int, bytes]:
            """Construct only the handler fields used by its framing path."""

            class ForbiddenRead(io.BytesIO):
                """Fail if an unauthenticated request body is touched."""

                def read(self, size: int | None = -1) -> bytes:
                    """Detect any pre-auth read regardless of requested length."""
                    raise AssertionError("unauthenticated body was read")

            handler: Any = Handler.__new__(Handler)
            handler.server = SimpleNamespace(application=application)
            handler.headers = headers
            handler.path = "/v1/transcriptions"
            handler.rfile = ForbiddenRead(body) if unreadable else io.BytesIO(body)
            handler.wfile = io.BytesIO()
            statuses: list[int] = []
            handler.send_response = lambda status: statuses.append(status)
            handler.send_header = lambda *args: None
            handler.end_headers = lambda: None
            handler.do_POST()
            return statuses[0], handler.wfile.getvalue()

        headers = Message()
        headers["Content-Length"] = "8000"
        headers["Content-Type"] = "application/octet-stream"
        headers["X-Request-Id"] = "voice:http:1"
        self.assertEqual(wire(headers, bytes(8000), unreadable=True)[0], 401)
        headers["Authorization"] = "Bearer " + "x" * 32
        self.assertEqual(wire(headers, bytes(8000))[0], 200)
        self.assertEqual(wire(headers, bytes(4))[0], 400)
        headers["Content-Length"] = "8000"
        self.assertEqual(wire(headers, bytes(8000))[0], 413)

    def test_backend_value_errors_are_not_reported_as_client_json_errors(self) -> None:
        """Sanitize and quarantine unexpected engine failures independently of parsing."""

        class Broken:
            """Represent a library failure that is not a RuntimeError."""

            def chunks_for_job(
                self, text: str, job: Job
            ) -> Iterator[tuple[int, int, int, bytes]]:
                """Never expose the library's private diagnostic message."""
                raise ValueError("private asset path")

        self.worker.models.voices = {"af_heart": Broken()}
        application = Application(self.worker, "x" * 32)
        response = application.handle(
            "POST",
            "/v1/speech",
            {"authorization": "Bearer " + "x" * 32, "content-type": "application/json"},
            json.dumps(self.body).encode(),
        )
        self.assertEqual(response.status, 503)
        self.assertNotIn(b"private", response.data)
        self.assertFalse(self.worker.ready())


class ConfigurationTests(unittest.TestCase):
    """Prove deliberate selection and no startup side effects before admission."""

    def test_explicit_backend_and_private_binding_are_required(self) -> None:
        """Do not interpret CPU as fallback or accept an arbitrary remote listener."""
        self.assertEqual(Settings.parse(configuration()).backend, "cpu-onnx")
        self.assertEqual(Settings.parse(configuration("directml")).budget_mib, 8192)
        for change in (
            {"backend": "auto"},
            {"backend": "cuda"},
            {"version": True},
            {"host": "0.0.0.0"},
            {"cpu_threads": True},
            {"model_manifest": "../manifest.json"},
        ):
            with self.assertRaises(WorkerError):
                Settings.parse({**configuration(), **change})
        self.assertEqual(
            Settings.parse(
                {**configuration(), "host": "0.0.0.0", "private_network": True}
            ).host,
            "0.0.0.0",
        )

    def test_missing_inference_admission_never_invokes_loader(self) -> None:
        """The source/config-only path cannot initialize neural dependencies."""

        def forbidden(settings: Settings, manifest: dict) -> Models:
            """Fail visibly if an unapproved model load is attempted."""
            raise AssertionError("model loader called")

        with self.assertRaises(WorkerError) as caught:
            prepare(
                Settings.parse(configuration()),
                enable_inference=False,
                loader=forbidden,
            )
        self.assertEqual(caught.exception.code, "INFERENCE_ADMISSION_REQUIRED")

    def test_cpu_constructors_pin_provider_and_local_model_options(self) -> None:
        """Inject only third-party factories; do not import them or load assets."""
        seen: dict = {}

        def whisper(path: str, **options: Any) -> object:
            """Capture configured inference device and offline admission."""
            seen["whisper"] = options
            return object()

        CpuTranscriber(
            Path("/models"), {"directory": "small.en"}, 2, model_factory=whisper
        )
        self.assertEqual(seen["whisper"]["device"], "cpu")
        self.assertEqual(seen["whisper"]["compute_type"], "int8")
        self.assertTrue(seen["whisper"]["local_files_only"])

        def session(path: str, **options: Any) -> SimpleNamespace:
            """Capture explicit ORT provider selection."""
            seen["onnx"] = options
            return SimpleNamespace(get_providers=lambda: ["CPUExecutionProvider"])

        ort = SimpleNamespace(SessionOptions=SimpleNamespace, InferenceSession=session)

        def engine(session: object, path: str) -> SimpleNamespace:
            """Expose a fixture catalog without invoking speech inference."""
            return SimpleNamespace(get_voices=lambda: ["af_heart"])

        config = {
            "model": {"file": "kokoro.onnx"},
            "voices": {"file": "voices.bin"},
            "presets": [{"id": "af_heart"}],
        }
        CpuKokoro(Path("/models"), config, 2, ort=ort, engine_factory=engine)
        self.assertEqual(seen["onnx"]["providers"], ["CPUExecutionProvider"])
        wrong = SimpleNamespace(
            SessionOptions=SimpleNamespace,
            InferenceSession=lambda *args, **kwargs: SimpleNamespace(
                get_providers=lambda: ["CUDAExecutionProvider"]
            ),
        )
        with self.assertRaises(WorkerError):
            CpuKokoro(Path("/models"), config, 2, ort=wrong, engine_factory=engine)


class ManifestTests(unittest.TestCase):
    """Use tiny declared task-owned files to verify real containment and hashes."""

    def setUp(self) -> None:
        parent = Path(os.environ["VEYRA_VOICE_TEST_ROOT"]).resolve(strict=True)
        if (
            parent.parent != Path(os.environ["TMPDIR"]).resolve(strict=True)
            or parent.name != "speech-fixtures"
        ):
            raise RuntimeError(
                "test fixture root is not the declared voice coordination child"
            )
        self.root = parent / self._testMethodName
        self.root.mkdir()
        assets = {
            "small.en/config.json": b"{}",
            "small.en/model.bin": b"fixture-stt",
            "kokoro.onnx": b"fixture-tts",
            "voices.bin": b"fixture-voices",
            "gpu/config.json": b"{}",
            "gpu/kokoro-v1_0.pth": b"fixture-gpu",
        }
        for name, data in assets.items():
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        self.entry = lambda name: {
            "file": name,
            "sha256": hashlib.sha256(assets[name]).hexdigest(),
        }
        presets = [{"id": "af_heart", "label": "Fixture", "language": "en-us"}]
        self.cpu = {
            "version": 3,
            "backend": "cpu-onnx",
            "voice": "af_heart",
            "license": "fixture-only",
            "revision": "fixture-revision",
            "kokoro": {
                "model": self.entry("kokoro.onnx"),
                "voices": self.entry("voices.bin"),
                "presets": presets,
                "revision": "fixture",
                "license": "fixture-only",
            },
            "transcription": {
                "directory": "small.en",
                "files": [
                    self.entry("small.en/config.json"),
                    self.entry("small.en/model.bin"),
                ],
                "revision": "fixture",
                "license": "fixture-only",
            },
        }
        self.gpu = {
            "version": 2,
            "backend": "directml",
            "voice": "af_heart",
            "license": "fixture-only",
            "revision": "fixture",
            "gpu": {
                "tts": {
                    "directory": "gpu",
                    "files": [
                        self.entry("gpu/config.json"),
                        self.entry("gpu/kokoro-v1_0.pth"),
                    ],
                    "revision": "fixture",
                    "license": "fixture-only",
                },
                "stt": self.cpu["transcription"],
                "voices": self.entry("voices.bin"),
                "presets": presets,
                "maxVramBytes": 8 * 1024**3,
            },
        }

    def write_manifest(self, manifest: dict) -> None:
        """Keep every generated manifest inside this test's declared scratch path."""
        (self.root / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    def test_cpu_and_gpu_hashes_are_verified_without_loading_either(self) -> None:
        """Asset verification is distinct from model or device qualification."""
        self.write_manifest(self.cpu)
        self.assertEqual(
            verified_manifest(self.root, "manifest.json", "cpu-onnx")["backend"],
            "cpu-onnx",
        )
        self.write_manifest(self.gpu)
        self.assertEqual(
            verified_manifest(self.root, "manifest.json", "directml")["backend"],
            "directml",
        )

    def test_corrupt_and_unlisted_assets_fail_closed(self) -> None:
        """Neither changed bytes nor an unverified tokenizer/model file is allowed."""
        self.write_manifest(self.cpu)
        (self.root / "kokoro.onnx").write_bytes(b"corrupt")
        with self.assertRaises(WorkerError) as caught:
            verified_manifest(self.root, "manifest.json", "cpu-onnx")
        self.assertEqual(caught.exception.code, "MODEL_HASH_MISMATCH")
        (self.root / "kokoro.onnx").write_bytes(b"fixture-tts")
        (self.root / "small.en/extra.bin").write_bytes(b"unverified")
        with self.assertRaises(WorkerError) as caught:
            verified_manifest(self.root, "manifest.json", "cpu-onnx")
        self.assertEqual(caught.exception.code, "MODEL_FILES_UNVERIFIED")

    def test_cpu_profile_is_never_interpreted_as_a_gpu_fallback(self) -> None:
        """The same manifest cannot silently choose a different execution backend."""
        self.write_manifest(self.cpu)
        with self.assertRaises(WorkerError):
            verified_manifest(self.root, "manifest.json", "directml")

    def test_prepared_cpu_service_uses_only_selected_loader_after_validation(
        self,
    ) -> None:
        """Use fake models to test bootstrap; never import ONNX/Whisper/Torch."""
        self.write_manifest(self.cpu)
        (self.root / "token").write_text("x" * 32, encoding="utf-8")
        (self.root / "scratch").mkdir()
        settings = Settings.parse(
            {
                **configuration(),
                "model_root": str(self.root),
                "token_file": str(self.root / "token"),
                "scratch_root": str(self.root / "scratch"),
            }
        )
        calls: list[str] = []

        def loader(settings: Settings, manifest: dict) -> Models:
            """Record the chosen profile without loading the declared fixture assets."""
            calls.append(settings.backend)
            return models("cpu-onnx")

        with (
            patch("veyra_worker.sys.version_info", (3, 12)),
            patch("veyra_worker.platform.machine", return_value="x86_64"),
            patch.dict(os.environ),
        ):
            application = prepare(settings, enable_inference=True, loader=loader)
            self.assertEqual(application.worker.health()["backend"], "cpu-onnx")
            self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
            self.assertTrue(
                Path(os.environ["TMPDIR"]).is_relative_to(self.root / "scratch")
            )
            with self.assertRaises(WorkerError) as caught:
                prepare(
                    settings,
                    enable_inference=True,
                    loader=lambda *_args: models("directml"),
                )
            self.assertEqual(caught.exception.code, "BACKEND_SELECTION_MISMATCH")
        self.assertEqual(calls, ["cpu-onnx"])


class EspeakDataHandleTests(unittest.TestCase):
    """Real descriptor/closure tests, with no phonemizer or neural imports."""

    def test_long_data_path_is_held_without_reopening_or_inheriting(self):
        import tempfile
        from cpu_models import _retained_espeak_api
        with tempfile.TemporaryDirectory(prefix="espeak-data-", dir=os.environ["TMPDIR"]) as parent:
            root = Path(parent) / ("a" * 80) / ("b" * 80)
            root.mkdir(parents=True)
            (root / "phontab").write_bytes(b"original")
            class Api:
                def __init__(self, library, data):
                    self.data = data
            adapted = _retained_espeak_api(Api, root)
            original = adapted("fixed-library", str(root))
            self.assertLess(len(original.data), 160)
            descriptor = int(original.data.rsplit("/", 1)[1])
            self.assertFalse(os.get_inheritable(descriptor))
            renamed = root.with_name("retained-original")
            root.rename(renamed)
            root.mkdir()
            (root / "phontab").write_bytes(b"replacement")
            self.assertEqual((Path(original.data) / "phontab").read_bytes(), b"original")
            original._veyra_data_close()
            self.assertFalse(Path(original.data).exists())

    def test_failed_library_constructor_closes_actual_data_descriptor(self):
        import tempfile
        from cpu_models import _retained_espeak_api
        with tempfile.TemporaryDirectory(prefix="espeak-failure-", dir=os.environ["TMPDIR"]) as parent:
            observed = []
            class Api:
                def __init__(self, library, data):
                    observed.append(data)
                    raise RuntimeError("actual constructor failed")
            with self.assertRaisesRegex(RuntimeError, "actual constructor failed"):
                _retained_espeak_api(Api, parent)("fixed-library", parent)
            self.assertEqual(len(observed), 1)
            self.assertFalse(Path(observed[0]).exists())

    def test_foreign_data_does_not_enter_library_constructor(self):
        import tempfile
        from cpu_models import _retained_espeak_api
        with tempfile.TemporaryDirectory(prefix="espeak-foreign-", dir=os.environ["TMPDIR"]) as parent:
            expected = Path(parent) / "expected"
            expected.mkdir()
            class Api:
                def __init__(self, *_):
                    raise AssertionError("foreign data must not reach native code")
            with self.assertRaises(WorkerError) as caught:
                _retained_espeak_api(Api, expected)("fixed-library", parent)
            self.assertEqual(caught.exception.code, "CPU_ESPEAK_DATA_CHANGED")

if __name__ == "__main__":
    unittest.main()
