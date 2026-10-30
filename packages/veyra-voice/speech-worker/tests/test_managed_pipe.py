"""Private-channel fixtures: memory streams only, no process/socket/model/device."""
from dataclasses import replace
import io
import json
from pathlib import Path
import struct
import sys
import threading
import unittest
from unittest.mock import patch
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cpu_ownership import Identity, OwnershipError, payload_digest
from managed_pipe import DOMAIN, MAX_FRAME, PipeSupervisorOwner, PrivatePipe, frame_bytes, read_frame, exact_write
from managed_entry import ManagedApplication, build_managed
from veyra_worker import Application, Response, SpeechWorker
from cpu_ownership import CpuOperations
from test_veyra_worker import models
from types import SimpleNamespace

KEY = bytes(range(32))


def identity():
    request = str(uuid.uuid4())
    return Identity("fixture", str(uuid.uuid4()), str(uuid.uuid4()), 1, request, request,
                    str(uuid.uuid4()), "transcribe", payload_digest("transcribe", b"fixture"))


class NativeMetadata:
    """In-memory ACK loss fixture; it is not a durable production owner."""
    def __init__(self):
        self.calls, self.commits = [], {}
        self.lose = False

    def call(self, method, params, *, identifier=None):
        self.calls.append((method, json.loads(json.dumps(params)), identifier))
        if method != "retain":
            raise AssertionError(method)
        if identifier not in self.commits:
            self.commits[identifier] = {"identity": params["identity"], "transactionId": identifier,
                "revision": params["expectedRevision"] + 1, "retentionId": str(uuid.uuid4())}
        if self.lose:
            self.lose = False
            raise OwnershipError("PRIVATE_ACK_UNKNOWN", 503)
        return self.commits[identifier]


class ManagedProtocolTests(unittest.TestCase):
    def test_concrete_pipe_owner_prepares_once_and_reuses_models_across_cpu_children(self):
        owner_id = str(uuid.uuid4())
        results = []
        class Native(NativeMetadata):
            def call(self, method, params, *, identifier=None):
                if method == "enroll":
                    self.lease = {**params, "ownerId": owner_id, "ownerGeneration": 1}
                    return self.lease
                if method == "validate":
                    return {"valid": params == self.lease}
                if method == "result":
                    results.append(params)
                    return {"retained": True}
                return super().call(method, params, identifier=identifier)
        native = Native()
        owner = PipeSupervisorOwner(native, "fixture", owner_id, 1)
        calls = []
        loaded = models("cpu-onnx")
        token = "fixture-token-with-32-characters-minimum"
        def factory(settings, *, enable_inference, cpu_owner):
            calls.append((settings, enable_inference, cpu_owner))
            return Application(SpeechWorker(loaded, "af_heart", "fixture", cpu_operations=CpuOperations("fixture", cpu_owner)), token)
        settings = SimpleNamespace(backend="cpu-onnx", host="127.0.0.1")
        application = build_managed(settings, owner, factory)
        for _ in range(2):
            request = str(uuid.uuid4())
            pcm = b"\x01\0" * 4000
            original = Identity("fixture", owner.lease.boot_id, owner_id, 1, request, request, str(uuid.uuid4()), "transcribe", payload_digest("transcribe", pcm))
            headers = {"authorization": "Bearer " + token, "content-type": "application/json"}
            reserved = application.handle("POST", "/v2/operations/reserve", headers, json.dumps(original.wire()).encode())
            self.assertEqual(reserved.status, 200)
            headers.update({"content-type": "application/octet-stream", "x-veyra-identity": json.dumps(original.wire())})
            response = application.handle("POST", "/v2/transcriptions", headers, pcm)
            self.assertEqual(response.status, 200)
            self.assertEqual(json.loads(response.data)["text"], "fixture phrase")
            self.assertIs(application.worker.models, loaded)
        self.assertEqual(calls, [(settings, True, owner)])
        self.assertEqual(len(results), 2)
        self.assertEqual(len(native.commits), 6)

    def test_short_raw_write_preserves_entire_authenticated_frame(self):
        class Short(io.BytesIO):
            def write(self, data):
                return super().write(data[:3])
        target = Short()
        frame = frame_bytes(KEY, b"C", 1, {"original": "bounded"})
        exact_write(target, frame)
        self.assertEqual(target.getvalue(), frame)

    def test_actual_reader_thread_retains_lost_ack_metadata_and_joins_on_eof(self):
        class Source:
            def __init__(self):
                self.condition = threading.Condition()
                self.buffer = bytearray()
                self.eof = False
            def feed(self, data=b"", eof=False):
                with self.condition:
                    self.buffer.extend(data)
                    self.eof = eof
                    self.condition.notify_all()
            def read(self, count):
                with self.condition:
                    self.condition.wait_for(lambda: self.buffer or self.eof)
                    value = bytes(self.buffer[:count])
                    del self.buffer[:count]
                    return value
        source = Source()
        calls = []
        class Writer(io.BytesIO):
            def flush(self):
                raw = self.getvalue()
                self.seek(0)
                self.truncate()
                request = read_frame(io.BytesIO(raw), KEY, b"C", len(calls)+1)
                calls.append(request)
                if len(calls) == 2:
                    source.feed(frame_bytes(KEY, b"N", 1, {"id": request["id"], "ok": True, "result": {"valid": True}}))
        pipe = PrivatePipe(source, Writer(), KEY, timeout=0.01)
        pipe.start()
        transaction = str(uuid.uuid4())
        try:
            with self.assertRaises(OwnershipError):
                pipe.call("validate", {"original": {"generation": 1}}, identifier=transaction)
            self.assertEqual(pipe.call("validate", {"original": {"generation": 1}}, identifier=transaction), {"valid": True})
            self.assertEqual(calls[0], calls[1])
            with self.assertRaises(OwnershipError):
                pipe.call("validate", {"original": {"generation": 2}}, identifier=transaction)
            self.assertEqual(len(calls), 2)
        finally:
            source.feed(eof=True)
            self.assertTrue(pipe.join_after_eof(1))
        self.assertTrue(pipe.closed.is_set())

    def test_mac_covers_direction_sequence_and_exact_utf8(self):
        value = {"text": "voice ☃", "nested": {"a": 1}}
        frame = frame_bytes(KEY, b"N", 1, value)
        self.assertEqual(read_frame(io.BytesIO(frame), KEY, b"N", 1), value)
        for key, direction, sequence in [(b"x" * 32, b"N", 1), (KEY, b"C", 1), (KEY, b"N", 2)]:
            with self.assertRaises(OwnershipError):
                read_frame(io.BytesIO(frame), key, direction, sequence)
        damaged = frame[:-1] + bytes([frame[-1] ^ 1])
        with self.assertRaises(OwnershipError):
            read_frame(io.BytesIO(damaged), KEY, b"N", 1)

    def test_bounds_and_eof_never_synthesize_ack(self):
        for frame in [b"", struct.pack("!I", MAX_FRAME + 1), frame_bytes(KEY, b"N", 1, {"id": 1})[:-1]]:
            with self.assertRaises(OwnershipError):
                read_frame(io.BytesIO(frame), KEY, b"N", 1)
        for ordinal in [True, 0, 9007199254740992]:
            with self.assertRaises(OwnershipError):
                frame_bytes(KEY, b"N", ordinal, {})

    def test_authenticated_duplicate_json_is_rejected(self):
        import hmac
        raw = b'{"id":1,"id":2}'
        ordinal = struct.pack("!Q", 1)
        tag = hmac.digest(KEY, DOMAIN + b"N" + ordinal + raw, "sha256")
        with self.assertRaises(OwnershipError):
            read_frame(io.BytesIO(struct.pack("!I", len(raw)) + ordinal + tag + raw), KEY, b"N", 1)

    def test_constructor_has_no_thread_or_io_effects(self):
        reader, writer = io.BytesIO(), io.BytesIO()
        pipe = PrivatePipe(reader, writer, KEY)
        self.assertIsNone(pipe.original)
        self.assertEqual(writer.getvalue(), b"")
        self.assertFalse(pipe.join_after_eof(0))

    def test_lost_ack_reuses_metadata_transaction_before_later_finalization(self):
        native = NativeMetadata()
        original = identity()
        owner = PipeSupervisorOwner(native, original.instance_id, original.owner_id, 1)
        native.lose = True
        with self.assertRaises(OwnershipError):
            owner.retain(original, "running", None, False)
        owner.retain(original, "terminal", "cancelled-before-dispatch", True)
        self.assertEqual(len(native.commits), 2)
        self.assertEqual(native.calls[0], native.calls[1])
        self.assertEqual(native.calls[2][1]["expectedRevision"], 1)
        self.assertEqual(owner.revisions[original.request_id], 2)
        self.assertEqual(owner.transitions, {})

    def test_conflicting_native_identity_cannot_publish_retention(self):
        native = NativeMetadata()
        original = identity()
        owner = PipeSupervisorOwner(native, original.instance_id, original.owner_id, 1)
        def wrong(method, params, *, identifier=None):
            return {"identity": replace(original, owner_generation=2).wire(), "transactionId": identifier,
                    "revision": 1, "retentionId": str(uuid.uuid4())}
        native.call = wrong
        with self.assertRaises(OwnershipError):
            owner.retain(original, "reserved", None, False)
        self.assertEqual(owner.revisions, {})
        self.assertIn(original.request_id, owner.transitions)

    def test_terminal_shape_is_closed_before_private_request(self):
        native = NativeMetadata()
        original = identity()
        owner = PipeSupervisorOwner(native, original.instance_id, original.owner_id, 1)
        for state, outcome, drained in [("running", None, True), ("terminal", None, True),
                                       ("terminal", "completed", False), ("reserved", "failed", False)]:
            with self.assertRaises(OwnershipError):
                owner.retain(original, state, outcome, drained)
        self.assertEqual(native.calls, [])

    def test_result_retains_fingerprint_after_actual_response_and_uses_data_field(self):
        original = identity()
        captured = []
        owner = SimpleNamespace(result=lambda *args: captured.append(args))
        prepared = Application(SimpleNamespace(models=SimpleNamespace(backend="cpu-onnx"),
            cpu_operations=object()), "fixture-token-with-32-characters-minimum")
        managed = ManagedApplication(prepared, owner)
        response = Response(200, b"actual response")
        with patch.object(Application, "owned_cpu", return_value=response):
            self.assertIs(managed.owned_cpu("/v2/transcriptions", {"x-veyra-identity": json.dumps(original.wire())}, b"pcm"), response)
        self.assertEqual(captured, [(original, 200, "application/json", b"actual response")])

    def test_managed_v1_mutation_has_no_effect_even_with_bearer(self):
        prepared = Application(SimpleNamespace(models=SimpleNamespace(backend="cpu-onnx"),
            cpu_operations=object()), "fixture-token-with-32-characters-minimum")
        managed = ManagedApplication(prepared, object())
        with patch.object(Application, "owned_cpu", side_effect=AssertionError("effect")):
            self.assertEqual(managed.handle("POST", "/v1/speech", {"authorization": "Bearer " + prepared._token}, b"{}").status, 404)
            self.assertEqual(managed.handle("POST", "/v1/cancel", {}, b"{}").status, 401)


if __name__ == "__main__":
    unittest.main()
