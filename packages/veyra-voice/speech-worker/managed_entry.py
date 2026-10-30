"""Actual managed CPU Application entry; one model set per owned original process."""
from __future__ import annotations

import json
import threading
from typing import BinaryIO, Callable, Mapping

from cpu_ownership import Identity, OwnershipError
from managed_pipe import PipeSupervisorOwner, PrivatePipe
from veyra_worker import Application, Response, Server, Settings, WorkerError, prepare


class ManagedApplication(Application):
    """Reuse the existing CPU operation/model path and privately bind returned bytes."""
    def __init__(self, prepared: Application, owner: PipeSupervisorOwner) -> None:
        if prepared.worker.models.backend != "cpu-onnx" or prepared.worker.cpu_operations is None:
            raise OwnershipError("MANAGED_CPU_OWNER_REQUIRED", 503)
        super().__init__(prepared.worker, prepared._token)
        self.native = owner

    def owned_cpu(self, path: str, headers: Mapping[str, str], body: bytes) -> Response:
        """Authentication and synchronous scope return precede result fingerprint retention."""
        response = super().owned_cpu(path, headers, body)
        if path in ("/v2/transcriptions", "/v2/speech"):
            identity = Identity.parse(json.loads(headers["x-veyra-identity"]))
            self.native.result(identity, response.status, response.content_type, response.data)
        return response

    def handle(self, method: str, path: str, headers: Mapping[str, str], body: bytes = b"") -> Response:
        """Managed mutation has no unscoped v1 cancel/execute compatibility fallback."""
        if method != "GET" and not path.startswith("/v2/"):
            try:
                self.authorize(headers)
            except WorkerError:
                return super().handle(method, path, headers, body)
            return Response(404, b'{"error":{"code":"MANAGED_V2_REQUIRED"}}')
        return super().handle(method, path, headers, body)


class ManagedServer(Server):
    """Retain and join actual HTTP handlers; kernel job retirement is still separate."""
    daemon_threads = False
    block_on_close = True

    def service_actions(self) -> None:
        """Observe the original pipe closure on the actual serving thread."""
        if self.stopping.is_set():
            ownership = self.application.worker.cpu_operations
            if ownership is not None:
                with ownership.lock:
                    for original in ownership.records.values():
                        original.cancelled.set()
            raise ManagedStop()


class ManagedStop(Exception):
    """Internal serve-loop exit; it does not represent inference/process drain."""


def build_managed(settings: Settings, owner: PipeSupervisorOwner,
                  factory: Callable[..., Application] = prepare) -> ManagedApplication:
    """Prepare the existing Application once, with the concrete private owner port."""
    if settings.backend != "cpu-onnx" or settings.host != "127.0.0.1":
        raise WorkerError("MANAGED_CPU_PROFILE_REQUIRED", 503)
    return ManagedApplication(factory(settings, enable_inference=True, cpu_owner=owner), owner)


def serve_managed(reader: BinaryIO, writer: BinaryIO, key: bytes, bootstrap: dict[str, object]) -> None:
    """Run only after Native's actual original-child pipe/capability enrollment."""
    stopping = threading.Event()
    pipe = PrivatePipe(reader, writer, key, on_shutdown=stopping.set, on_closed=stopping.set)
    pipe.start()
    server: ManagedServer | None = None
    try:
        settings = Settings.parse(bootstrap["settings"])
        owner = PipeSupervisorOwner(pipe, bootstrap["instanceId"], bootstrap["ownerId"], bootstrap["ownerGeneration"])
        application = build_managed(settings, owner)
        if stopping.is_set():
            raise WorkerError("MANAGED_START_CLOSED", 503)
        server = ManagedServer((settings.host, settings.port), application)
        server.stopping = stopping
        if pipe.call("ready", {"health": application.worker.health()}) != {"accepted": True}:
            raise OwnershipError("MANAGED_READY_REFUSED", 503)

        try:
            server.serve_forever(poll_interval=0.05)
        except ManagedStop:
            pass
    finally:
        stopping.set()
        if server is not None:
            server.server_close()
        writer.close()
        # EOF is supplied by the original Native parent. A bounded join timeout
        # is not success: a still-live child remains owned and blocks retirement.
        if not pipe.join_after_eof(5):
            raise OwnershipError("MANAGED_PIPE_RETIREMENT_PENDING", 503)
        reader.close()
