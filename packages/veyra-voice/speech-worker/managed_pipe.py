"""Authenticated original-child metadata channel; no model, socket or journal.

The Native Speech owner alone commits the existing original receipts. This client
can request only closed enrollment/validation/CAS/result metadata operations over
its inherited private pipe. HTTP identities and health cannot create this port.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import hmac
import json
import struct
import threading
from typing import BinaryIO, Callable
import uuid

from cpu_ownership import Identity, Lease, OwnershipError, canonical_uuid

MAX_FRAME = 16384
DOMAIN = b"VEYRA-CPU-PRIVATE-PIPE-V1\0"
METHODS = frozenset({"enroll", "validate", "retain", "ready", "result"})


def exact_read(source: BinaryIO, length: int) -> bytes:
    """Read one bounded field; EOF never becomes a synthesized acknowledgement."""
    chunks: list[bytes] = []
    remaining = length
    while remaining:
        chunk = source.read(remaining)
        if not isinstance(chunk, bytes) or not chunk or len(chunk) > remaining:
            raise OwnershipError("PRIVATE_PIPE_CLOSED", 503)
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def exact_write(target: BinaryIO, payload: bytes) -> None:
    """Raw inherited FileIO may return a short write; retain exact frame bytes."""
    offset = 0
    while offset < len(payload):
        written = target.write(payload[offset:])
        if type(written) is not int or not 0 < written <= len(payload) - offset:
            raise OwnershipError("PRIVATE_PIPE_CLOSED", 503)
        offset += written
    target.flush()


def json_object(payload: bytes) -> dict[str, object]:
    """Reject non-JSON numbers and duplicate fields before interpreting commands."""
    def pairs(values: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in values:
            if key in result:
                raise ValueError("duplicate")
            result[key] = value
        return result

    def constant(_: str) -> None:
        raise ValueError("number")

    try:
        value = json.loads(payload.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError):
        raise OwnershipError("PRIVATE_FRAME_INVALID", 503) from None
    if not isinstance(value, dict):
        raise OwnershipError("PRIVATE_FRAME_INVALID", 503)
    return value


def frame_bytes(key: bytes, direction: bytes, sequence: int, value: dict[str, object]) -> bytes:
    """MAC exact UTF-8 bytes and sequence, avoiding cross-language canonical JSON."""
    if len(key) != 32 or direction not in (b"N", b"C") or type(sequence) is not int or not 1 <= sequence <= 9007199254740991:
        raise OwnershipError("PRIVATE_FRAME_INVALID", 503)
    payload = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if not 0 < len(payload) <= MAX_FRAME:
        raise OwnershipError("PRIVATE_FRAME_LIMIT", 503)
    ordinal = struct.pack("!Q", sequence)
    tag = hmac.digest(key, DOMAIN + direction + ordinal + payload, "sha256")
    return struct.pack("!I", len(payload)) + ordinal + tag + payload


def read_frame(source: BinaryIO, key: bytes, direction: bytes, expected: int) -> dict[str, object]:
    """Consume only the next authentic frame from this original pipe capability."""
    length = struct.unpack("!I", exact_read(source, 4))[0]
    if not 0 < length <= MAX_FRAME:
        raise OwnershipError("PRIVATE_FRAME_LIMIT", 503)
    ordinal = exact_read(source, 8)
    sequence = struct.unpack("!Q", ordinal)[0]
    supplied = exact_read(source, 32)
    payload = exact_read(source, length)
    if sequence != expected or not hmac.compare_digest(supplied, hmac.digest(key, DOMAIN + direction + ordinal + payload, "sha256")):
        raise OwnershipError("PRIVATE_FRAME_AUTHORITY", 503)
    return json_object(payload)


@dataclass
class Pending:
    method: str
    params: dict[str, object]
    event: threading.Event = field(default_factory=threading.Event)
    response: dict[str, object] | None = None


class PrivatePipe:
    """One actual inherited duplex channel; only its reader resolves native ACKs."""
    def __init__(self, reader: BinaryIO, writer: BinaryIO, key: bytes, *, timeout: float = 5.0,
                 capacity: int = 8192, on_shutdown: Callable[[], None] = lambda: None,
                 on_closed: Callable[[], None] = lambda: None) -> None:
        if not isinstance(key, bytes) or len(key) != 32 or not 0 < timeout <= 10 or not 1 <= capacity <= 8192:
            raise OwnershipError("PRIVATE_PIPE_CONFIG", 503)
        self.reader, self.writer, self.key = reader, writer, key
        self.timeout, self.capacity = timeout, capacity
        self.on_shutdown, self.on_closed = on_shutdown, on_closed
        self.write_lock, self.lock = threading.Lock(), threading.RLock()
        self.sent, self.received = 0, 0
        self.pending: dict[str, Pending] = {}
        self.closed = threading.Event()
        self.original: threading.Thread | None = None
        self.failure: BaseException | None = None

    def start(self) -> None:
        """Start exactly one retained reader; constructing this class starts nothing."""
        with self.lock:
            if self.original is not None or self.closed.is_set():
                raise OwnershipError("PRIVATE_PIPE_SPENT", 503)
            self.original = threading.Thread(target=self._read, name="veyra-native-owner-pipe", daemon=False)
            self.original.start()

    def _fault(self, error: BaseException) -> None:
        with self.lock:
            if self.failure is None:
                self.failure = error
            self.closed.set()
            for pending in self.pending.values():
                pending.event.set()
        self.on_closed()

    def _read(self) -> None:
        try:
            while not self.closed.is_set():
                value = read_frame(self.reader, self.key, b"N", self.received + 1)
                self.received += 1
                if set(value) == {"event"} and value["event"] == "shutdown":
                    self.on_shutdown()
                    continue
                if set(value) != {"id", "ok", "result"} or type(value["ok"]) is not bool or not isinstance(value["result"], dict):
                    raise OwnershipError("PRIVATE_REPLY_INVALID", 503)
                identifier = canonical_uuid(value["id"])
                with self.lock:
                    pending = self.pending.get(identifier)
                    if pending is None or (pending.response is not None and pending.response != value):
                        raise OwnershipError("PRIVATE_REPLY_CONFLICT", 503)
                    pending.response = value
                    pending.event.set()
        except BaseException as error:
            self._fault(error)

    def call(self, method: str, params: dict[str, object], *, identifier: str | None = None) -> dict[str, object]:
        """Retry metadata finalization only with its original immutable request ID."""
        if method not in METHODS or not isinstance(params, dict):
            raise OwnershipError("PRIVATE_METHOD_INVALID", 503)
        identifier = canonical_uuid(identifier or str(uuid.uuid4()))
        with self.lock:
            if self.closed.is_set() or self.original is None:
                raise OwnershipError("PRIVATE_PIPE_CLOSED", 503)
            pending = self.pending.get(identifier)
            snapshot = json_object(json.dumps(params, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8"))
            if pending is None:
                if len(self.pending) >= self.capacity:
                    raise OwnershipError("PRIVATE_PIPE_CAPACITY", 503)
                pending = Pending(method, snapshot)
                self.pending[identifier] = pending
            elif pending.method != method or pending.params != snapshot:
                raise OwnershipError("PRIVATE_CALL_CONFLICT", 503)
            complete = pending.response is not None
        if not complete:
            try:
                with self.write_lock:
                    if self.closed.is_set():
                        raise OwnershipError("PRIVATE_PIPE_CLOSED", 503)
                    self.sent += 1
                    exact_write(self.writer, frame_bytes(self.key, b"C", self.sent, {"id": identifier, "method": method, "params": pending.params}))
            except BaseException as error:
                self._fault(error)
                raise OwnershipError("PRIVATE_PIPE_CLOSED", 503) from None
            if not pending.event.wait(self.timeout):
                raise OwnershipError("PRIVATE_ACK_UNKNOWN", 503)
        with self.lock:
            if self.closed.is_set() or pending.response is None:
                raise OwnershipError("PRIVATE_ACK_UNKNOWN", 503)
            if pending.response["ok"] is not True:
                raise OwnershipError("NATIVE_OWNER_REFUSED", 503)
            return dict(pending.response["result"])

    def join_after_eof(self, timeout: float) -> bool:
        """Positive reader join only; never conclude retirement from a timeout."""
        if self.original is None:
            return False
        self.original.join(timeout)
        return not self.original.is_alive()


class PipeSupervisorOwner:
    """Production CPU owner port backed solely by the Native Speech journal RPC."""
    def __init__(self, pipe: PrivatePipe, instance: str, owner_id: str, generation: int) -> None:
        canonical_uuid(owner_id)
        if type(generation) is not int or not 1 <= generation <= 9007199254740991:
            raise OwnershipError("PRIVATE_OWNER_INVALID", 503)
        self.pipe, self.instance, self.owner_id, self.generation = pipe, instance, owner_id, generation
        self.lease: Lease | None = None
        self.lock = threading.RLock()
        self.revisions: dict[str, int] = {}
        self.transitions: dict[str, tuple[dict[str, object], str]] = {}

    def enroll(self, instance_id: str, boot_id: str) -> Lease:
        """Bind the worker's challenge to the already owned original child scope."""
        canonical_uuid(boot_id)
        if instance_id != self.instance or self.lease is not None:
            raise OwnershipError("PRIVATE_OWNER_CONFLICT", 503)
        value = self.pipe.call("enroll", {"instanceId": instance_id, "bootId": boot_id})
        expected = {"instanceId": instance_id, "bootId": boot_id, "ownerId": self.owner_id, "ownerGeneration": self.generation}
        if value != expected:
            raise OwnershipError("PRIVATE_OWNER_CONFLICT", 503)
        self.lease = Lease(instance_id, boot_id, self.owner_id, self.generation)
        return self.lease

    def validate(self, lease: Lease) -> None:
        """A matching lease is still checked by the retained Native process owner."""
        if lease != self.lease or self.pipe.call("validate", {"ownerId": lease.owner_id, "bootId": lease.boot_id,
                "ownerGeneration": lease.owner_generation, "instanceId": lease.instance_id}) != {"valid": True}:
            raise OwnershipError("PRIVATE_OWNER_UNCERTAIN", 503)

    def _commit(self, identity: Identity, params: dict[str, object], transaction: str) -> str:
        value = self.pipe.call("retain", params, identifier=transaction)
        expected_revision = params["expectedRevision"]
        if type(expected_revision) is not int or value.get("identity") != identity.wire() or value.get("transactionId") != transaction or type(value.get("revision")) is not int or value["revision"] != expected_revision + 1:
            raise OwnershipError("PRIVATE_RETENTION_CONFLICT", 503)
        retained = canonical_uuid(value.get("retentionId"))
        self.revisions[identity.request_id] = value["revision"]
        self.transitions.pop(identity.request_id, None)
        return retained

    def retain(self, identity: Identity, state: str, outcome: str | None, drained: bool) -> str:
        """CAS only this original's phase; ambiguous ACKs retain the exact metadata transaction."""
        with self.lock:
            if state not in ("reserved", "running", "uncertain", "terminal") or type(drained) is not bool:
                raise OwnershipError("PRIVATE_TRANSITION_INVALID", 503)
            if (state == "terminal") != drained or (state == "terminal" and outcome not in ("completed", "failed", "cancelled", "cancelled-before-dispatch")) or (state != "terminal" and outcome is not None):
                raise OwnershipError("PRIVATE_TRANSITION_INVALID", 503)
            prior = self.transitions.get(identity.request_id)
            if prior:
                params, transaction = prior
                desired = (params["state"], params["outcome"], params["drained"])
                retained = self._commit(identity, params, transaction)
                if desired == (state, outcome, drained):
                    return retained
            transaction = str(uuid.uuid4())
            params = {"identity": identity.wire(), "transactionId": transaction,
                "expectedRevision": self.revisions.get(identity.request_id, 0), "state": state, "outcome": outcome, "drained": drained}
            self.transitions[identity.request_id] = (params, transaction)
            return self._commit(identity, params, transaction)

    def result(self, identity: Identity, status: int, content_type: str, body: bytes) -> None:
        """Bind an HTTP result fingerprint through the private child channel, never cache/replay data."""
        if type(status) is not int or not 100 <= status <= 599 or content_type not in ("application/json", "audio/wav") or not isinstance(body, bytes) or len(body) > 2880128:
            raise OwnershipError("PRIVATE_RESULT_INVALID", 503)
        value = self.pipe.call("result", {"identity": identity.wire(), "status": status, "contentType": content_type,
            "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)})
        if value != {"retained": True}:
            raise OwnershipError("PRIVATE_RESULT_UNKNOWN", 503)
