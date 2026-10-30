"""CPU-only reconnect proof; no model import, files, sockets or process claims.

The native supervisor remains the durable request/process authority. A production
port must retain each transition before effects/proof and enroll only an actually
owned process. This module cannot manufacture that port from health or a PID.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import threading
from typing import Callable, Protocol, TypeVar
import uuid


class OwnershipError(Exception):
    """Expose bounded codes only, never private payload or supervisor errors."""
    def __init__(self, code: str, status: int = 409) -> None:
        self.code, self.status = code, status
        super().__init__(code)


def canonical_uuid(value: object) -> str:
    """Reject aliases, nil UUIDs and arbitrary unscoped identifiers."""
    if not isinstance(value, str):
        raise OwnershipError("IDENTITY_INVALID", 400)
    try:
        parsed = uuid.UUID(value)
    except ValueError:
        raise OwnershipError("IDENTITY_INVALID", 400) from None
    if parsed.int == 0 or str(parsed) != value:
        raise OwnershipError("IDENTITY_INVALID", 400)
    return value


@dataclass(frozen=True)
class Lease:
    """A native-issued binding to one original worker process/job capability."""
    instance_id: str
    boot_id: str
    owner_id: str
    owner_generation: int


@dataclass(frozen=True)
class Identity:
    """The exact original request tuple; no field is inferred on reconnect."""
    instance_id: str
    boot_id: str
    owner_id: str
    owner_generation: int
    request_id: str
    operation_id: str
    generation: str
    kind: str
    digest: str

    @classmethod
    def parse(cls, value: object) -> Identity:
        """Validate the closed cross-language identity wire shape."""
        keys = {"instanceId", "bootId", "ownerId", "ownerGeneration", "requestId",
                "operationId", "generation", "kind", "digest"}
        if not isinstance(value, dict) or set(value) != keys:
            raise OwnershipError("IDENTITY_INVALID", 400)
        instance = value["instanceId"]
        if not isinstance(instance, str) or not 1 <= len(instance) <= 160 or not all(
            character in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:_-"
            for character in instance
        ):
            raise OwnershipError("IDENTITY_INVALID", 400)
        generation = value["ownerGeneration"]
        digest = value["digest"]
        if type(generation) is not int or not 1 <= generation <= 9007199254740991:
            raise OwnershipError("IDENTITY_INVALID", 400)
        if value["kind"] not in ("transcribe", "synthesize") or not isinstance(digest, str) or len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
            raise OwnershipError("IDENTITY_INVALID", 400)
        request = canonical_uuid(value["requestId"])
        operation = canonical_uuid(value["operationId"])
        if request != operation:
            raise OwnershipError("IDENTITY_INVALID", 400)
        return cls(instance, canonical_uuid(value["bootId"]), canonical_uuid(value["ownerId"]),
            generation, request, operation, canonical_uuid(value["generation"]), value["kind"], digest)

    def wire(self) -> dict[str, object]:
        """Return metadata only; no text/audio or replacement request is retained."""
        return {"instanceId": self.instance_id, "bootId": self.boot_id, "ownerId": self.owner_id,
            "ownerGeneration": self.owner_generation, "requestId": self.request_id,
            "operationId": self.operation_id, "generation": self.generation,
            "kind": self.kind, "digest": self.digest}


class SupervisorOwner(Protocol):
    """Required privileged port, never an HTTP body or a permissive default.

    enroll must bind this challenge to the actual original process capability.
    Replacement generation requires positive prior owned-process-tree retirement,
    not a missing PID/lock/socket, restart, elapsed time, health or cancel ACK.
    retain commits to the existing durable native operation owner atomically and
    returns its exact durable transition UUID; failure must throw, never guess.
    """
    def enroll(self, instance_id: str, boot_id: str) -> Lease: ...
    def validate(self, lease: Lease) -> None: ...
    def retain(self, identity: Identity, state: str, outcome: str | None, drained: bool) -> str: ...


@dataclass
class Record:
    """Bounded metadata and one cooperative flag for an original operation."""
    identity: Identity
    state: str = "reserved"
    outcome: str | None = None
    retention_id: str | None = None
    returned_outcome: str | None = None
    cancelled: threading.Event = field(default_factory=threading.Event)


T = TypeVar("T")


def payload_digest(kind: str, payload: bytes) -> str:
    """Hash exact outgoing bytes, not a second JSON normalization of private input."""
    if kind not in ("transcribe", "synthesize") or not isinstance(payload, bytes):
        raise OwnershipError("PAYLOAD_INVALID", 400)
    return hashlib.sha256(kind.encode("ascii") + b"\0" + payload).hexdigest()


class CpuOperations:
    """Per-process reconnect owner: bounded, serialized, never evicts spent IDs."""
    def __init__(self, instance_id: str, native: SupervisorOwner, capacity: int = 256) -> None:
        if type(capacity) is not int or not 1 <= capacity <= 1024:
            raise OwnershipError("OWNER_CONFIG_INVALID", 503)
        self.boot_id = str(uuid.uuid4())
        self.native, self.capacity = native, capacity
        self.lock = threading.RLock()
        self.records: dict[str, Record] = {}
        self.quarantined = False
        self.authority_fault = False
        try:
            self.lease = native.enroll(instance_id, self.boot_id)
            if self.lease.instance_id != instance_id or self.lease.boot_id != self.boot_id:
                raise ValueError("binding")
            canonical_uuid(self.lease.owner_id)
            if type(self.lease.owner_generation) is not int or not 1 <= self.lease.owner_generation <= 9007199254740991:
                raise ValueError("generation")
            native.validate(self.lease)
        except Exception:
            raise OwnershipError("PROCESS_OWNER_REQUIRED", 503) from None

    def info(self) -> dict[str, object]:
        """Advertise protocol identity; never infer a request's drainage from it."""
        with self.lock:
            return {"protocol": "veyra-cpu-ownership-v2", "bootId": self.boot_id,
                "ownerId": self.lease.owner_id, "ownerGeneration": self.lease.owner_generation,
                "capacity": self.capacity, "retained": len(self.records), "quarantined": self.quarantined}

    def _bound(self, identity: Identity) -> None:
        if (identity.instance_id, identity.boot_id, identity.owner_id, identity.owner_generation) != (
            self.lease.instance_id, self.boot_id, self.lease.owner_id, self.lease.owner_generation
        ):
            raise OwnershipError("OWNER_IDENTITY_MISMATCH")
        try:
            self.native.validate(self.lease)
        except Exception:
            self.quarantined = True
            self.authority_fault = True
            raise OwnershipError("OWNER_UNCERTAIN", 503) from None

    def _find(self, identity: Identity) -> Record:
        self._bound(identity)
        record = self.records.get(identity.request_id)
        if record is None:
            # Absence is NOT no-start/drain proof and never permits replay.
            raise OwnershipError("ORIGINAL_UNAVAILABLE", 404)
        if record.identity != identity:
            raise OwnershipError("ORIGINAL_CONFLICT")
        return record

    def _retain(self, record: Record, state: str, outcome: str | None, drained: bool) -> None:
        try:
            retention = canonical_uuid(self.native.retain(record.identity, state, outcome, drained))
        except Exception:
            record.state, record.outcome, record.retention_id = "uncertain", None, None
            self.quarantined = True
            raise OwnershipError("RETENTION_UNCERTAIN", 503) from None
        record.state, record.outcome, record.retention_id = state, outcome, retention

    def _view(self, record: Record) -> dict[str, object]:
        return {"identity": record.identity.wire(), "state": record.state,
            "outcome": record.outcome, "drained": record.state == "terminal" and record.retention_id is not None,
            "retentionId": record.retention_id}

    def reserve(self, identity: Identity) -> dict[str, object]:
        with self.lock:
            self._bound(identity)
            if identity.request_id in self.records:
                return self._view(self._find(identity))
            if self.quarantined:
                raise OwnershipError("OWNER_QUARANTINED", 503)
            if len(self.records) >= self.capacity:
                raise OwnershipError("OWNER_CAPACITY", 429)
            # Enroll BEFORE durable retention; a failed retention is kept uncertain.
            record = Record(identity)
            self.records[identity.request_id] = record
            try:
                self._retain(record, "reserved", None, False)
            except OwnershipError:
                # The record is now uncertain/spent and dispatch never became
                # possible. Only durable sealed no-start finalization may heal it.
                record.returned_outcome = "cancelled-before-dispatch"
                raise
            return self._view(record)

    def observe(self, identity: Identity) -> dict[str, object]:
        with self.lock:
            record = self._find(identity)
            # Retry ONLY durable finalization of an already returned synchronous
            # scope (or sealed no-start cancel). Never reenter inference. This
            # candidate cannot survive/rebind a process restart or authority fault.
            if record.state == "uncertain" and record.returned_outcome is not None and not self.authority_fault:
                try:
                    self._retain(record, "terminal", record.returned_outcome, True)
                    self.quarantined = any(item.state == "uncertain" for item in self.records.values())
                except OwnershipError:
                    pass
            return self._view(record)

    def cancel(self, identity: Identity) -> dict[str, object]:
        with self.lock:
            record = self._find(identity)
            record.cancelled.set()
            if record.state == "reserved":
                # Seal dispatch before proof: this original can never execute later.
                record.returned_outcome = "cancelled-before-dispatch"
                self._retain(record, "terminal", record.returned_outcome, True)
            # Running cancellation is cooperative; no terminal transition or drain ACK.
            return {"accepted": True, **self._view(record)}

    def execute(self, identity: Identity, payload: bytes, work: Callable[[threading.Event], tuple[T, str]]) -> T:
        with self.lock:
            record = self._find(identity)
            if self.quarantined:
                raise OwnershipError("OWNER_QUARANTINED", 503)
            if payload_digest(identity.kind, payload) != identity.digest:
                raise OwnershipError("PAYLOAD_CONFLICT")
            if record.state != "reserved":
                raise OwnershipError("ORIGINAL_SPENT")
            try:
                self._retain(record, "running", None, False)
            except OwnershipError:
                # work() has not been entered; never retry it after this refusal.
                record.returned_outcome = "cancelled-before-dispatch"
                raise
        try:
            # The callback must return ONLY after its synchronous CPU inference
            # scope and owned cancellation cleanup have actually returned.
            result, outcome = work(record.cancelled)
            if outcome not in ("completed", "failed", "cancelled"):
                raise ValueError("outcome")
        except BaseException as error:
            with self.lock:
                record.state, record.outcome, record.retention_id = "uncertain", None, None
                self.quarantined = True
                try:
                    self._retain(record, "uncertain", None, False)
                except OwnershipError:
                    pass
            if isinstance(error, Exception):
                raise OwnershipError("EXECUTION_UNCERTAIN", 503) from None
            raise
        with self.lock:
            self._bound(identity)
            record.returned_outcome = outcome
            self._retain(record, "terminal", outcome, True)
        return result
