"""Veyra-owned bounded speech service; importing it never loads neural models."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
from dataclasses import dataclass
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import logging
import os
from pathlib import Path
import platform
import socket
import sys
import threading
import time
from typing import Callable, Iterator, Mapping, Protocol, cast
import wave

from inference_control import InferenceInterrupted, check_inference
from cpu_ownership import CpuOperations, Identity, OwnershipError, SupervisorOwner


class WorkerError(Exception):
    """Expose only stable protocol codes, without model paths or request content."""

    def __init__(self, code: str, status: int = 400) -> None:
        self.code = code
        self.status = status
        super().__init__(code)


def request_id(value: object) -> str:
    """Validate the bounded request identifier accepted by the Stratus wire protocol."""
    allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:_-"
    if (
        not isinstance(value, str)
        or not 1 <= len(value) <= 160
        or any(character not in allowed for character in value)
    ):
        raise WorkerError("INVALID_REQUEST_ID")
    return value


@dataclass(frozen=True)
class Settings:
    """Require operator-selected resources instead of inheriting Stratus state."""

    instance_id: str
    backend: str
    host: str
    port: int
    model_root: Path
    model_manifest: str
    token_file: Path
    scratch_root: Path
    physical_vram_mib: int | None = None
    budget_mib: int | None = None
    cpu_threads: int | None = None

    @classmethod
    def parse(cls, value: object) -> Settings:
        """Decode a strict deployment configuration without probing devices or assets."""
        fields = {
            "version",
            "backend",
            "instance_id",
            "host",
            "port",
            "private_network",
            "model_root",
            "model_manifest",
            "token_file",
            "scratch_root",
        }
        if not isinstance(value, dict) or value.get("backend") not in (
            "directml",
            "cpu-onnx",
        ):
            raise WorkerError("CONFIG_INVALID")
        fields |= (
            {"physical_vram_mib", "budget_mib"}
            if value["backend"] == "directml"
            else {"cpu_threads"}
        )
        if (
            set(value) != fields
            or type(value["version"]) is not int
            or value["version"] != 1
        ):
            raise WorkerError("CONFIG_INVALID")
        instance = request_id(value["instance_id"])
        if (
            not isinstance(value["private_network"], bool)
            or value["host"] not in ("127.0.0.1", "0.0.0.0")
            or (value["host"] == "0.0.0.0" and value["private_network"] is not True)
        ):
            raise WorkerError("CONFIG_BINDING_INVALID")
        port = value["port"]
        physical, budget, threads = (
            value.get("physical_vram_mib"),
            value.get("budget_mib"),
            value.get("cpu_threads"),
        )
        if type(port) is not int or not 1024 <= port <= 65535:
            raise WorkerError("CONFIG_BUDGET_INVALID")
        if value["backend"] == "directml" and (
            type(physical) is not int
            or type(budget) is not int
            or not 4096 <= physical <= 131072
            or not 4096 <= budget <= min(8192, physical)
            or budget % 512
        ):
            raise WorkerError("CONFIG_BUDGET_INVALID")
        if value["backend"] == "cpu-onnx" and (
            type(threads) is not int or not 1 <= threads <= 8
        ):
            raise WorkerError("CONFIG_BUDGET_INVALID")
        paths: list[Path] = []
        for key in ("model_root", "token_file", "scratch_root"):
            if (
                not isinstance(value[key], str)
                or not value[key]
                or not Path(value[key]).is_absolute()
            ):
                raise WorkerError("CONFIG_PATH_INVALID")
            paths.append(Path(value[key]))
        manifest = value["model_manifest"]
        if (
            not isinstance(manifest, str)
            or not manifest
            or Path(manifest).name != manifest
            or manifest in (".", "..")
        ):
            raise WorkerError("CONFIG_PATH_INVALID")
        return cls(
            instance,
            value["backend"],
            value["host"],
            port,
            paths[0],
            manifest,
            paths[1],
            paths[2],
            physical,
            budget,
            threads,
        )


def verified_manifest(root: Path, name: str, backend: str) -> dict[str, object]:
    """Verify the explicitly selected manifest and all assets before model import."""
    if backend not in ("directml", "cpu-onnx"):
        raise WorkerError("MODEL_BACKEND_INVALID")
    root = root.resolve(strict=True)
    path = (root / name).resolve(strict=True)
    if not path.is_relative_to(root):
        raise WorkerError("MODEL_PATH_INVALID")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if backend == "cpu-onnx":
        from cpu_models import verify_cpu_manifest

        return verify_cpu_manifest(root, manifest)
    if (
        not isinstance(manifest, dict)
        or set(manifest)
        != {"version", "backend", "voice", "gpu", "license", "revision"}
        or manifest["version"] != 2
        or manifest["backend"] != "directml"
        or not manifest["license"]
        or not manifest["revision"]
    ):
        raise WorkerError("MODEL_MANIFEST_INVALID")
    gpu = manifest["gpu"]
    if (
        not isinstance(gpu, dict)
        or set(gpu) != {"tts", "stt", "voices", "presets", "maxVramBytes"}
        or gpu["maxVramBytes"] != 8 * 1024**3
    ):
        raise WorkerError("MODEL_MANIFEST_INVALID")
    entries = [gpu["voices"]]
    for component_name in ("tts", "stt"):
        component = gpu[component_name]
        if (
            not isinstance(component, dict)
            or set(component) != {"directory", "revision", "files", "license"}
            or not component["revision"]
            or not component["license"]
            or not isinstance(component["directory"], str)
            or not isinstance(component["files"], list)
            or not component["files"]
        ):
            raise WorkerError("MODEL_MANIFEST_INVALID")
        directory = (root / component["directory"]).resolve(strict=True)
        if not directory.is_relative_to(root) or not directory.is_dir():
            raise WorkerError("MODEL_PATH_INVALID")
        try:
            declared = {
                (root / entry["file"]).resolve(strict=True)
                for entry in component["files"]
            }
        except (KeyError, TypeError) as error:
            raise WorkerError("MODEL_MANIFEST_INVALID") from error
        if declared != {
            item.resolve(strict=True) for item in directory.rglob("*") if item.is_file()
        }:
            raise WorkerError("MODEL_FILES_UNVERIFIED")
        entries.extend(component["files"])
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
    presets = gpu["presets"]
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


@dataclass
class Job:
    """Cooperative cancellation shared with the frozen GPU dispatch adapter."""

    request_id: str
    cancelled: threading.Event
    deadline: float
    owned_v2: bool = False


class SpeechModel(Protocol):
    """The qualified GPU synthesis adapter yields bounded PCM chunks."""

    def chunks_for_job(
        self, text: str, job: Job
    ) -> Iterator[tuple[int, int, int, bytes]]:
        """Produce audio while checking the supplied job at GPU dispatch boundaries."""
        ...


class Transcriber(Protocol):
    """The qualified GPU recognizer accepts normalized mono PCM."""

    def transcribe(self, pcm: bytes, job: Job) -> str:
        """Recognize one bounded utterance or return an empty silence result."""
        ...


@dataclass
class Models:
    """Keep one shared model set and its actual mutable GPU qualification state."""

    voices: Mapping[str, SpeechModel]
    catalog: list[dict[str, str]]
    transcriber: Transcriber
    runtime_info: dict[str, object]
    backend: str = "directml"


class SpeechWorker:
    """Serialize neural work, bound payloads and discard cancelled results."""

    def __init__(
        self, models: Models, voice: str, instance_id: str, deadline_seconds: float = 5,
        cpu_operations: CpuOperations | None = None,
    ) -> None:
        if voice not in models.voices or not 0 < deadline_seconds <= 5:
            raise WorkerError("WORKER_CONFIG_INVALID")
        if cpu_operations is not None and (models.backend != "cpu-onnx" or cpu_operations.lease.instance_id != instance_id):
            raise WorkerError("WORKER_CONFIG_INVALID")
        self.models, self.voice, self.instance_id = models, voice, instance_id
        self.deadline_seconds = deadline_seconds
        self.cpu_operations = cpu_operations
        self.inference_lock = threading.Lock()
        self.job_lock = threading.Lock()
        self.job: Job | None = None
        self.cancelled: dict[str, float] = {}

    def ready(self) -> bool:
        """Readiness follows warm-up and quarantine state, not process liveness."""
        info = self.models.runtime_info
        qualified = info.get("qualified") is True and info.get("faulted") is not True
        if self.models.backend == "directml":
            return qualified and info.get("neuralCpuFallback") is False
        return (
            qualified
            and self.models.backend == "cpu-onnx"
            and info.get("backend") == "cpu-onnx"
        )

    def health(self) -> dict[str, object]:
        """Identify this independently owned service without exposing assets or tokens."""
        ready = self.ready()
        info: dict[str, object] = {
            "service": "veyra-speech",
            "instanceId": self.instance_id,
            "version": 1,
            "protocol": "stratus-speech-v1",
            "ready": ready,
            "gpuReady": ready and self.models.backend == "directml",
            "tts": ready,
            "stt": ready,
            "voice": self.voice,
            "voices": list(self.models.voices),
            "backend": "torch-directml"
            if self.models.backend == "directml"
            else "cpu-onnx",
            "busy": self.inference_lock.locked(),
        }
        if self.cpu_operations is not None:
            info["ownership"] = self.cpu_operations.info()
        return info

    def _purge_cancelled(self) -> None:
        """Bound pre-admission cancellation tombstones to thirty seconds."""
        now = time.monotonic()
        self.cancelled = {
            key: expiry for key, expiry in self.cancelled.items() if expiry > now
        }

    def cancel(self, identifier: object) -> None:
        """Cancel only the named job, including a request not yet admitted."""
        identifier = request_id(identifier)
        with self.job_lock:
            if self.job and self.job.request_id == identifier and self.job.owned_v2:
                raise WorkerError("OWNERSHIP_IDENTITY_REQUIRED", 409)
            self._purge_cancelled()
            if identifier not in self.cancelled and len(self.cancelled) >= 128:
                if self.job and self.job.request_id == identifier:
                    self.job.cancelled.set()
                raise WorkerError("CANCEL_CAPACITY", 429)
            self.cancelled[identifier] = time.monotonic() + 30
            if self.job and self.job.request_id == identifier:
                self.job.cancelled.set()

    @contextmanager
    def _job(self, identifier: str, cancellation: threading.Event | None = None) -> Iterator[Job]:
        """Do not overlap models or report a completed result after cancellation."""
        if not self.ready():
            raise WorkerError("BACKEND_UNAVAILABLE", 503)
        if not self.inference_lock.acquire(blocking=False):
            raise WorkerError("BUSY", 429)
        job = Job(
            identifier, cancellation if cancellation is not None else threading.Event(),
            time.monotonic() + self.deadline_seconds, cancellation is not None,
        )
        try:
            with self.job_lock:
                self._purge_cancelled()
                if cancellation is None and identifier in self.cancelled:
                    job.cancelled.set()
                self.job = job
            check_inference(job)
            yield job
            check_inference(job)
        except InferenceInterrupted as error:
            raise WorkerError(error.code, error.status) from None
        except WorkerError as error:
            if error.status >= 500:
                self.models.runtime_info.update({"qualified": False, "faulted": True})
            raise
        except Exception:
            # Third-party engines may raise non-RuntimeError failures; never mislabel them as bad JSON.
            self.models.runtime_info.update({"qualified": False, "faulted": True})
            raise WorkerError("SPEECH_BACKEND_FAILED", 503) from None
        finally:
            with self.job_lock:
                self.job = None
            self.inference_lock.release()

    def transcribe(self, identifier: object, pcm: bytes, *, cancellation: threading.Event | None = None) -> dict[str, object]:
        """Accept only 250 ms to fifteen seconds of 16 kHz mono s16le."""
        identifier = request_id(identifier)
        if not isinstance(pcm, bytes) or not 8000 <= len(pcm) <= 480000 or len(pcm) % 2:
            raise WorkerError("INVALID_AUDIO")
        with self._job(identifier, cancellation) as job:
            text = self.models.transcriber.transcribe(pcm, job)
            if not isinstance(text, str) or len(text) > 2000:
                raise WorkerError("TRANSCRIPT_LIMIT", 502)
        return {"text": text.strip(), "language": "en", "durationMs": len(pcm) / 32}

    def synthesize(self, value: object, *, cancellation: threading.Event | None = None) -> bytes:
        """Accept one configured voice and return a bounded integer PCM WAV."""
        if not isinstance(value, dict) or set(value) != {"requestId", "text", "voice"}:
            raise WorkerError("INVALID_REQUEST")
        identifier = request_id(value["requestId"])
        text, voice = value["text"], value["voice"]
        if not isinstance(voice, str) or voice not in self.models.voices:
            raise WorkerError("UNKNOWN_VOICE")
        if (
            not isinstance(text, str)
            or not text.strip()
            or len(text) > 600
            or len(text.encode("utf-8")) > 2400
            or any(
                ord(character) < 32 and character not in "\n\t" for character in text
            )
        ):
            raise WorkerError("INVALID_TEXT")
        with self._job(identifier, cancellation) as job:
            data, format_ = bytearray(), None
            for rate, channels, width, chunk in self.models.voices[
                voice
            ].chunks_for_job(text, job):
                check_inference(job)
                if (
                    width != 2
                    or channels != 1
                    or rate not in (16000, 22050, 24000, 44100, 48000)
                    or not isinstance(chunk, bytes)
                    or len(chunk) % 2
                ):
                    raise WorkerError("INVALID_MODEL_AUDIO", 502)
                if format_ is not None and format_ != (rate, channels, width):
                    raise WorkerError("INVALID_MODEL_AUDIO", 502)
                format_ = rate, channels, width
                if len(data) + len(chunk) > rate * 2 * 15:
                    raise WorkerError("AUDIO_LIMIT", 502)
                data.extend(chunk)
            if format_ is None or not data:
                raise WorkerError("EMPTY_AUDIO", 502)
            output = io.BytesIO()
            with wave.open(output, "wb") as wav:
                wav.setnchannels(format_[1])
                wav.setsampwidth(format_[2])
                wav.setframerate(format_[0])
                wav.writeframes(data)
        return output.getvalue()


@dataclass(frozen=True)
class Response:
    """Represent an in-memory wire response independently of an HTTP socket."""

    status: int
    data: bytes
    content_type: str = "application/json"


class Application:
    """Authenticate and route the qualified Stratus wire protocol for Veyra."""

    def __init__(self, worker: SpeechWorker, token: str) -> None:
        if (
            not 32 <= len(token) <= 192
            or not token.isascii()
            or any(character.isspace() for character in token)
        ):
            raise WorkerError("TOKEN_INVALID")
        self.worker, self._token = worker, token

    def authorize(self, headers: Mapping[str, str]) -> None:
        """Authenticate before reading request bodies or reserving neural work."""
        supplied = headers.get("authorization", "")
        if (
            not isinstance(supplied, str)
            or len(supplied) > 256
            or not hmac.compare_digest(
                supplied.encode(), ("Bearer " + self._token).encode()
            )
        ):
            raise WorkerError("UNAUTHORIZED", 401)

    def handle(
        self, method: str, path: str, headers: Mapping[str, str], body: bytes = b""
    ) -> Response:
        """Return only sanitized protocol responses; never log audio or text."""
        try:
            self.authorize(headers)
            if method == "POST" and path.startswith("/v2/"):
                return self.owned_cpu(path, headers, body)
            value: object = None
            status, content_type = 200, "application/json"
            if method == "GET" and path == "/health":
                value = self.worker.health()
                status = 200 if value["ready"] else 503
            elif method == "GET" and path == "/v1/voices":
                value = {
                    "defaultVoice": self.worker.voice,
                    "voices": self.worker.models.catalog,
                }
            elif method == "POST" and path in (
                "/v1/transcriptions",
                "/v1/speech",
                "/v1/cancel",
            ):
                binary = path == "/v1/transcriptions"
                if headers.get("content-type", "").split(";")[0] != (
                    "application/octet-stream" if binary else "application/json"
                ):
                    raise WorkerError("INVALID_CONTENT_TYPE", 415)
                if not 0 < len(body) <= (480000 if binary else 4096):
                    raise WorkerError("BODY_LIMIT", 413)
                if binary:
                    value = self.worker.transcribe(
                        headers.get("x-request-id", ""), body
                    )
                else:
                    payload = json.loads(body)
                    if path == "/v1/cancel":
                        if not isinstance(payload, dict) or set(payload) != {
                            "requestId"
                        }:
                            raise WorkerError("INVALID_REQUEST")
                        self.worker.cancel(payload["requestId"])
                        value = {"cancelled": True}
                    else:
                        value = self.worker.synthesize(payload)
                        content_type = "audio/wav"
            else:
                raise WorkerError("NOT_FOUND", 404)
            return Response(
                status,
                value if isinstance(value, bytes) else json.dumps(value).encode(),
                content_type,
            )
        except (WorkerError, OwnershipError) as error:
            return Response(
                error.status, json.dumps({"error": {"code": error.code}}).encode()
            )
        except (ValueError, UnicodeError):
            return Response(400, b'{"error":{"code":"INVALID_JSON"}}')

    def owned_cpu(self, path: str, headers: Mapping[str, str], body: bytes) -> Response:
        """Separate v2 ownership effects; legacy v1 remains its existing protocol."""
        owner = self.worker.cpu_operations
        if self.worker.models.backend != "cpu-onnx" or owner is None:
            raise OwnershipError("PROCESS_OWNER_REQUIRED", 503)
        operation = path in ("/v2/operations/reserve", "/v2/operations/observe", "/v2/operations/cancel")
        if not operation and path not in ("/v2/transcriptions", "/v2/speech"):
            raise OwnershipError("NOT_FOUND", 404)
        binary = path == "/v2/transcriptions"
        expected = "application/octet-stream" if binary else "application/json"
        if headers.get("content-type", "").split(";")[0] != expected:
            raise OwnershipError("INVALID_CONTENT_TYPE", 415)
        if not 0 < len(body) <= (480000 if binary else 2048 if operation else 4096):
            raise OwnershipError("BODY_LIMIT", 413)
        if operation:
            identity = Identity.parse(json.loads(body))
            action = {"/v2/operations/reserve": owner.reserve,
                "/v2/operations/observe": owner.observe, "/v2/operations/cancel": owner.cancel}[path]
            return Response(200, json.dumps(action(identity)).encode())
        encoded = headers.get("x-veyra-identity", "")
        if not 0 < len(encoded) <= 2048:
            raise OwnershipError("IDENTITY_INVALID", 400)
        identity = Identity.parse(json.loads(encoded))
        if identity.kind != ("transcribe" if binary else "synthesize"):
            raise OwnershipError("ORIGINAL_CONFLICT")
        value = None if binary else json.loads(body)
        if not binary and (not isinstance(value, dict) or value.get("requestId") != identity.request_id):
            raise OwnershipError("ORIGINAL_CONFLICT")

        def execute(cancellation: threading.Event) -> tuple[Response, str]:
            # Both real worker methods exit _job's finally before this callback
            # returns. Validation refusal also seals dispatch without inference.
            try:
                if binary:
                    result = self.worker.transcribe(identity.request_id, body, cancellation=cancellation)
                    response = Response(200, json.dumps(result).encode())
                else:
                    response = Response(200, self.worker.synthesize(value, cancellation=cancellation), "audio/wav")
                return response, "completed"
            except WorkerError as error:
                return Response(error.status, json.dumps({"error": {"code": error.code}}).encode()), (
                    "cancelled" if error.code == "CANCELLED" else "failed"
                )
        return owner.execute(identity, body, execute)


class Server(ThreadingHTTPServer):
    """Expose only eight bounded handlers; the models remain serialized."""

    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address: tuple[str, int], application: Application) -> None:
        self.application = application
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(address, Handler)

    def process_request(
        self,
        request: socket.socket | tuple[bytes, socket.socket],
        client_address: tuple[str, int],
    ) -> None:
        """Refuse excess handlers before allocating another request thread."""
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(cast(socket.socket, request))
            return
        try:
            super().process_request(request, client_address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(
        self,
        request: socket.socket | tuple[bytes, socket.socket],
        client_address: tuple[str, int],
    ) -> None:
        """Release bounded handler capacity after every socket outcome."""
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(
        self,
        request: socket.socket | tuple[bytes, socket.socket],
        client_address: tuple[str, int],
    ) -> None:
        """Do not emit raw model exceptions, credentials or request bodies."""
        logging.error("Veyra speech request failed: CONNECTION_FAILED")


class Handler(BaseHTTPRequestHandler):
    """Read one length-bounded authenticated request per connection."""

    protocol_version = "HTTP/1.0"

    def setup(self) -> None:
        """Bound header and body read time independently of GPU cancellation."""
        super().setup()
        self.connection.settimeout(6)

    def log_message(self, format: str, *args: object) -> None:
        """Disable content-bearing access logs."""

    def _handle(self, method: str) -> None:
        """Apply transport framing checks before invoking the pure application."""
        application = cast(Server, self.server).application
        headers = {key.lower(): value for key, value in self.headers.items()}
        try:
            application.authorize(headers)
            body = b""
            if method == "POST":
                if self.path.startswith("/v2/"):
                    if len(self.headers.get_all("Authorization", [])) != 1 or len(self.headers.get_all("Content-Type", [])) != 1:
                        raise WorkerError("INVALID_HEADERS")
                    if self.path in ("/v2/transcriptions", "/v2/speech"):
                        identities = self.headers.get_all("X-Veyra-Identity", [])
                        if len(identities) != 1 or not 0 < len(identities[0]) <= 2048:
                            raise WorkerError("IDENTITY_INVALID")
                lengths = self.headers.get_all("Content-Length", [])
                maximum = 480000 if self.path in ("/v1/transcriptions", "/v2/transcriptions") else 2048 if self.path.startswith("/v2/operations/") else 4096
                if (
                    self.headers.get("Transfer-Encoding")
                    or len(lengths) != 1
                    or not lengths[0].isdigit()
                    or not 0 < int(lengths[0]) <= maximum
                ):
                    raise WorkerError("BODY_LIMIT", 413)
                body = self.rfile.read(int(lengths[0]))
                if len(body) != int(lengths[0]):
                    raise WorkerError("TRUNCATED_BODY")
            response = application.handle(method, self.path, headers, body)
        except WorkerError as error:
            response = Response(
                error.status, json.dumps({"error": {"code": error.code}}).encode()
            )
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            return
        except Exception:
            # An HTTP boundary must sanitize unexpected third-party failures.
            logging.error("Veyra speech request failed: WORKER_FAILED")
            response = Response(503, b'{"error":{"code":"WORKER_FAILED"}}')
        self.send_response(response.status)
        self.send_header("Content-Type", response.content_type)
        self.send_header("Content-Length", str(len(response.data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(response.data)

    def do_GET(self) -> None:
        """Handle authenticated readiness and voice catalog reads."""
        self._handle("GET")

    def do_POST(self) -> None:
        """Handle bounded transcription, synthesis or cancellation."""
        self._handle("POST")


def load_models(settings: Settings, manifest: dict[str, object]) -> Models:
    """Load only the operator's selected backend, without a fallback branch."""
    if settings.backend == "cpu-onnx":
        from cpu_models import load_cpu_models

        return load_cpu_models(settings, manifest)
    if settings.backend != "directml":
        raise WorkerError("CONFIG_INVALID")
    from directml_models import load_gpu_models

    voices, catalog, transcriber, info = load_gpu_models(settings.model_root, manifest)
    return Models(voices, catalog, transcriber, info)


def prepare(
    settings: Settings,
    *,
    enable_inference: bool,
    loader: Callable[[Settings, dict[str, object]], Models] = load_models,
    cpu_owner: SupervisorOwner | None = None,
) -> Application:
    """Verify independent assets/configuration before allowing GPU startup."""
    if not enable_inference:
        raise WorkerError("INFERENCE_ADMISSION_REQUIRED", 503)
    if cpu_owner is not None and settings.backend != "cpu-onnx":
        raise WorkerError("CPU_OWNER_BACKEND_MISMATCH", 503)
    if (
        sys.version_info[:2] != (3, 12)
        or sys.platform not in ("linux", "win32")
        or platform.machine().lower() not in ("x86_64", "amd64")
    ):
        raise WorkerError("SPEECH_PLATFORM_UNAVAILABLE", 503)
    if settings.backend == "directml" and (
        sys.platform != "linux" or not Path("/dev/dxg").exists()
    ):
        raise WorkerError("DIRECTML_PLATFORM_UNAVAILABLE", 503)
    manifest = verified_manifest(
        settings.model_root, settings.model_manifest, settings.backend
    )
    token = settings.token_file.read_text(encoding="utf-8").strip()
    # Validate credentials before importing neural dependencies or allocating GPU memory.
    if (
        not 32 <= len(token) <= 192
        or not token.isascii()
        or any(character.isspace() for character in token)
    ):
        raise WorkerError("TOKEN_INVALID")
    scratch = settings.scratch_root.resolve(strict=True)
    if not scratch.is_dir():
        raise WorkerError("SCRATCH_UNAVAILABLE")
    for name, relative in {
        "TEMP": "tmp",
        "TMP": "tmp",
        "TMPDIR": "tmp",
        "HF_HOME": "huggingface",
        "HF_HUB_CACHE": "huggingface/hub",
        "TRANSFORMERS_CACHE": "huggingface/transformers",
        "TORCH_HOME": "torch",
        "XDG_CACHE_HOME": "cache",
    }.items():
        target = scratch / relative
        if not target.resolve(strict=False).is_relative_to(scratch):
            raise WorkerError("SCRATCH_PATH_INVALID")
        target.mkdir(parents=True, exist_ok=True)
        if not target.resolve(strict=True).is_relative_to(scratch):
            raise WorkerError("SCRATCH_PATH_INVALID")
        os.environ[name] = str(target)
    os.environ.update(
        {
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "HF_HUB_DISABLE_TELEMETRY": "1",
        }
    )
    if settings.backend == "directml":
        os.environ.update(
            {
                "VEYRA_SPEECH_PHYSICAL_VRAM_MIB": str(settings.physical_vram_mib),
                "VEYRA_SPEECH_BUDGET_MIB": str(settings.budget_mib),
            }
        )
    # Actual production v2 enrollment is supplied by the Windows-native OR Linux
    # API supervisor. No default implementation, statefile/PID inference or HTTP
    # bootstrap can manufacture its process/retention authority.
    ownership = CpuOperations(settings.instance_id, cpu_owner) if cpu_owner is not None and settings.backend == "cpu-onnx" else None
    loaded = loader(settings, manifest)
    if loaded.backend != settings.backend:
        raise WorkerError("BACKEND_SELECTION_MISMATCH", 503)
    worker = SpeechWorker(loaded, cast(str, manifest["voice"]), settings.instance_id, cpu_operations=ownership)
    if not worker.ready():
        raise WorkerError("SPEECH_STARTUP_NOT_QUALIFIED", 503)
    return Application(worker, token)


def main() -> None:
    """Offer a model-free config check or an explicitly admitted service start."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path, required=True)
    parser.add_argument("--check-config", action="store_true")
    parser.add_argument("--serve", action="store_true")
    parser.add_argument("--enable-inference", action="store_true")
    arguments = parser.parse_args()
    try:
        settings = Settings.parse(
            json.loads(arguments.config.read_text(encoding="utf-8"))
        )
        if (
            arguments.check_config
            and not arguments.serve
            and not arguments.enable_inference
        ):
            logging.warning(
                "Veyra speech config valid; models and device readiness were not checked"
            )
            return
        if not arguments.serve or arguments.check_config:
            raise WorkerError("EXPLICIT_SERVE_REQUIRED")
        application = prepare(settings, enable_inference=arguments.enable_inference)
        with Server((settings.host, settings.port), application) as server:
            server.serve_forever()
    except (WorkerError, OSError, ValueError, ImportError, RuntimeError) as error:
        code = error.code if isinstance(error, WorkerError) else "STARTUP_UNAVAILABLE"
        logging.error("Veyra speech unavailable: %s", code)
        raise SystemExit(1) from None


if __name__ == "__main__":
    sys.modules.setdefault("veyra_worker", sys.modules[__name__])
    main()
