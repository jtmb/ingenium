"""Effect-free owner-port fixtures; no real process/retirement qualification."""
from __future__ import annotations

from dataclasses import replace
from email.message import Message
import io
import json
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from cpu_ownership import CpuOperations, Identity, Lease, OwnershipError, payload_digest
from inference_control import check_inference
from veyra_worker import Application, Handler, Models, SpeechWorker

INSTANCE = "fixture-cpu"
TOKEN = "fictional-model-free-token-000000000000"


class FixtureSupervisor:
    """Fake durable original owner, never usable as a production supervisor port."""
    def __init__(self):
        self.lease = None
        self.generation = 0
        self.retired = False
        self.valid = True
        self.fail_state = None
        self.fail_after = None
        self.transitions = []
        self.commits = {}
        self.bindings = {}
        self.on_retain = lambda identity, state: None

    def enroll(self, instance, boot):
        if self.lease is not None and not self.retired:
            raise RuntimeError("fixture original process retirement NOT proved")
        self.generation += 1
        self.lease = Lease(instance, boot, str(uuid.uuid4()), self.generation)
        self.retired = False
        return self.lease

    def validate(self, lease):
        if not self.valid or lease != self.lease:
            raise RuntimeError("fixture owner unavailable")

    def retain(self, identity, state, outcome, drained):
        self.validate(Lease(identity.instance_id, identity.boot_id, identity.owner_id, identity.owner_generation))
        original = self.bindings.get(identity.request_id)
        if original is not None and original != identity:
            raise RuntimeError("fixture original UUID cannot be rebound/replayed")
        if self.fail_state == state:
            raise RuntimeError("fixture durable retention failed")
        key = (identity, state, outcome, drained)
        if key in self.commits:
            return self.commits[key]
        self.bindings[identity.request_id] = identity
        self.on_retain(identity, state)
        retention = str(uuid.uuid4())
        self.transitions.append((identity, state, outcome, drained, retention))
        self.commits[key] = retention
        if self.fail_after == state:
            self.fail_after = None
            raise RuntimeError("fixture lost durable commit acknowledgement")
        return retention


def identity(owner, payload=b"fixture", kind="transcribe", request=None):
    request = request or str(uuid.uuid4())
    return Identity(INSTANCE, owner.boot_id, owner.lease.owner_id, owner.lease.owner_generation,
        request, request, str(uuid.uuid4()), kind, payload_digest(kind, payload))


class PendingCpu:
    """A synchronous model-free stand-in with a deliberately unresolved scope."""
    def __init__(self):
        self.entered, self.release = threading.Event(), threading.Event()
        self.calls = 0

    def transcribe(self, pcm, job):
        self.calls += 1
        self.entered.set()
        if not self.release.wait(2):
            raise RuntimeError("fixture was not released")
        check_inference(job)
        return "fixture phrase"


class TinyVoice:
    def chunks_for_job(self, text, job):
        check_inference(job)
        yield 24000, 1, 2, bytes(480)


class OwnerTests(unittest.TestCase):
    def setUp(self):
        self.native = FixtureSupervisor()
        self.owner = CpuOperations(INSTANCE, self.native, capacity=4)

    def test_closed_identity_shape_canonical_uuids_and_native_binding(self):
        original = identity(self.owner)
        self.assertEqual(Identity.parse(original.wire()), original)
        for key, value in [("generation", None), ("ownerGeneration", True),
            ("operationId", str(uuid.uuid4())), ("digest", "f" * 63), ("requestId", original.request_id.upper())]:
            data = original.wire(); data[key] = value
            with self.assertRaises(OwnershipError): Identity.parse(data)
        wrong = replace(original, boot_id=str(uuid.uuid4()))
        with self.assertRaises(OwnershipError): self.owner.reserve(wrong)

    def test_duplicate_reservation_is_read_only_and_changed_binding_conflicts(self):
        original = identity(self.owner)
        self.assertEqual(self.owner.reserve(original), self.owner.reserve(original))
        self.assertEqual(len(self.native.transitions), 1)
        for changed in [replace(original, digest="0" * 64), replace(original, generation=str(uuid.uuid4())),
            replace(original, kind="synthesize")]:
            with self.assertRaises(OwnershipError): self.owner.reserve(changed)

    def test_terminal_never_reexecutes_or_replays_private_result(self):
        original = identity(self.owner); self.owner.reserve(original)
        calls = []
        result = self.owner.execute(original, b"fixture", lambda event: (calls.append(1) or b"private-result", "completed"))
        self.assertEqual(result, b"private-result")
        view = self.owner.observe(original)
        self.assertTrue(view["drained"]); self.assertEqual(view["outcome"], "completed")
        self.assertNotIn("private-result", json.dumps(view))
        with self.assertRaises(OwnershipError): self.owner.execute(original, b"fixture", lambda event: (None, "completed"))
        self.assertEqual(calls, [1])

    def test_reserved_cancel_seals_no_dispatch_before_positive_proof(self):
        original = identity(self.owner); self.owner.reserve(original)
        proof = self.owner.cancel(original)
        self.assertTrue(proof["drained"])
        self.assertEqual(proof["outcome"], "cancelled-before-dispatch")
        with self.assertRaises(OwnershipError): self.owner.execute(original, b"fixture", lambda event: (None, "completed"))

    def test_missing_state_and_restart_are_never_drain_evidence(self):
        original = identity(self.owner)
        with self.assertRaises(OwnershipError) as missing: self.owner.observe(original)
        self.assertEqual(missing.exception.code, "ORIGINAL_UNAVAILABLE")
        with self.assertRaises(OwnershipError): CpuOperations(INSTANCE, self.native)
        self.owner.reserve(original)
        # Explicit fake supervisor transition tests contract shape only; no actual
        # process/PID/status is inspected or claimed retired by this suite.
        self.native.retired = True
        replacement = CpuOperations(INSTANCE, self.native)
        with self.assertRaises(OwnershipError): replacement.observe(original)
        rebound = identity(replacement, request=original.request_id)
        with self.assertRaises(OwnershipError): replacement.reserve(rebound)
        self.assertTrue(replacement.quarantined)

    def test_capacity_never_evicts_reserved_uncertain_or_terminal_originals(self):
        originals = [identity(self.owner) for _ in range(4)]
        for original in originals: self.owner.reserve(original)
        self.owner.cancel(originals[0])
        with self.assertRaises(OwnershipError) as full: self.owner.reserve(identity(self.owner))
        self.assertEqual(full.exception.code, "OWNER_CAPACITY")
        for original in originals: self.assertEqual(self.owner.observe(original)["identity"], original.wire())

    def test_raw_payload_digest_does_not_normalize_or_rebind(self):
        self.assertEqual(payload_digest("transcribe", b"fixture"), "510701dc62875afbcb25e60d5329d7af23278177905e9742fd600f0a92aa79ee")
        original = identity(self.owner, b'{"a":1}', "synthesize"); self.owner.reserve(original)
        with self.assertRaises(OwnershipError): self.owner.execute(original, b'{ "a": 1 }', lambda event: (None, "completed"))
        self.assertEqual(self.owner.observe(original)["state"], "reserved")

    def test_retention_failure_before_work_seals_no_start_until_durable_proof(self):
        original = identity(self.owner); self.owner.reserve(original)
        self.native.fail_state = "running"
        called = []
        with self.assertRaises(OwnershipError): self.owner.execute(original, b"fixture", lambda event: (called.append(1), "completed"))
        self.assertEqual(called, [])
        self.assertTrue(self.owner.quarantined)
        with self.assertRaises(OwnershipError): self.owner.reserve(identity(self.owner))
        proof = self.owner.observe(original)
        self.assertTrue(proof["drained"])
        self.assertEqual(proof["outcome"], "cancelled-before-dispatch")
        self.assertEqual(called, [])
        with self.assertRaises(OwnershipError): self.owner.execute(original, b"fixture", lambda event: (called.append(1), "completed"))

    def test_uncertain_reservation_retention_can_only_finalize_sealed_no_start(self):
        original = identity(self.owner); self.native.fail_state = "reserved"
        with self.assertRaises(OwnershipError): self.owner.reserve(original)
        self.assertTrue(self.owner.quarantined)
        proof = self.owner.observe(original)
        self.assertTrue(proof["drained"])
        self.assertEqual(proof["outcome"], "cancelled-before-dispatch")
        with self.assertRaises(OwnershipError): self.owner.execute(original, b"fixture", lambda event: (None, "completed"))

    def test_retention_failure_after_work_is_not_a_terminal_proof(self):
        original = identity(self.owner); self.owner.reserve(original)
        self.native.fail_state = "terminal"
        with self.assertRaises(OwnershipError): self.owner.execute(original, b"fixture", lambda event: (None, "completed"))
        self.assertEqual(self.owner.observe(original)["state"], "uncertain")
        self.assertFalse(self.owner.observe(original)["drained"])

    def test_unexpected_callback_failure_remains_unknown_not_invented_failed_drain(self):
        original = identity(self.owner); self.owner.reserve(original)
        def broken(event): raise RuntimeError("private-content-must-not-escape")
        with self.assertRaises(OwnershipError) as error: self.owner.execute(original, b"fixture", broken)
        self.assertEqual(error.exception.code, "EXECUTION_UNCERTAIN")
        proof = self.owner.observe(original)
        self.assertEqual(proof["state"], "uncertain"); self.assertFalse(proof["drained"])
        self.assertNotIn("private-content", str(error.exception))

    def test_same_scope_can_finish_retention_after_transient_failure_without_work_replay(self):
        original = identity(self.owner); self.owner.reserve(original)
        self.native.fail_state = "terminal"
        calls = []
        with self.assertRaises(OwnershipError): self.owner.execute(original, b"fixture", lambda event: (calls.append(1), "completed"))
        self.assertFalse(self.owner.observe(original)["drained"])
        self.native.fail_state = None
        proof = self.owner.observe(original)
        self.assertTrue(proof["drained"]); self.assertFalse(self.owner.quarantined)
        self.assertEqual(calls, [1])

    def test_lost_native_commit_ack_reuses_the_exact_original_retention(self):
        original = identity(self.owner); self.owner.reserve(original)
        self.native.fail_after = "terminal"
        with self.assertRaises(OwnershipError): self.owner.execute(original, b"fixture", lambda event: (None, "completed"))
        committed = self.native.transitions[-1][-1]
        proof = self.owner.observe(original)
        self.assertEqual(proof["retentionId"], committed)
        self.assertEqual(len([item for item in self.native.transitions if item[1] == "terminal"]), 1)

    def test_restored_health_or_port_liveness_does_not_clear_authority_fault(self):
        original = identity(self.owner); self.owner.reserve(original)
        self.native.fail_state = "terminal"
        with self.assertRaises(OwnershipError): self.owner.execute(original, b"fixture", lambda event: (None, "completed"))
        self.native.valid = False
        with self.assertRaises(OwnershipError): self.owner.observe(original)
        self.native.valid = True; self.native.fail_state = None
        self.assertFalse(self.owner.observe(original)["drained"])
        self.assertTrue(self.owner.authority_fault); self.assertTrue(self.owner.quarantined)


class ApplicationTests(unittest.TestCase):
    def setUp(self):
        self.native = FixtureSupervisor(); self.owner = CpuOperations(INSTANCE, self.native)
        self.model = PendingCpu()
        models = Models({"af_test": TinyVoice()}, [], self.model,
            {"qualified": True, "backend": "cpu-onnx"}, "cpu-onnx")
        self.worker = SpeechWorker(models, "af_test", INSTANCE, cpu_operations=self.owner)
        self.app = Application(self.worker, TOKEN)
        self.headers = {"authorization": "Bearer " + TOKEN, "content-type": "application/json"}
        self.thread = None; self.responses = []
        self.native.on_retain = self.check_retention

    def check_retention(self, original, state):
        if state == "terminal":
            self.assertTrue(self.worker.job is None or self.worker.job.request_id != original.request_id)

    def tearDown(self):
        self.model.release.set()
        if self.thread is not None:
            self.thread.join(3); self.assertFalse(self.thread.is_alive())

    def operation(self, action, original):
        return self.app.handle("POST", "/v2/operations/" + action, self.headers, json.dumps(original.wire()).encode())

    def start(self):
        self.pcm = bytes(8000); self.original = identity(self.owner, self.pcm)
        self.assertEqual(self.operation("reserve", self.original).status, 200)
        headers = {**self.headers, "content-type": "application/octet-stream", "x-veyra-identity": json.dumps(self.original.wire())}
        self.thread = threading.Thread(target=lambda: self.responses.append(
            self.app.handle("POST", "/v2/transcriptions", headers, self.pcm)))
        self.thread.start(); self.assertTrue(self.model.entered.wait(1))

    def test_cancel_ack_and_health_are_not_drain_then_reconnect_recovers_exact_terminal(self):
        self.start()
        self.assertTrue(self.worker.health()["busy"])
        ack = json.loads(self.operation("cancel", self.original).data)
        self.assertTrue(ack["accepted"]); self.assertFalse(ack["drained"])
        self.assertTrue(self.worker.inference_lock.locked())
        self.assertEqual(self.responses, [])
        running = json.loads(self.operation("observe", self.original).data)
        self.assertEqual(running["identity"], self.original.wire()); self.assertFalse(running["drained"])
        self.model.release.set(); self.thread.join(1)
        self.responses.clear()  # Original HTTP result was lost; no result replay.
        terminal = json.loads(self.operation("observe", self.original).data)
        self.assertTrue(terminal["drained"]); self.assertEqual(terminal["outcome"], "cancelled")
        self.assertEqual(self.model.calls, 1)

    def test_wrong_generation_digest_and_unscoped_v1_cancel_cannot_cancel_owned_job(self):
        self.start()
        for wrong in [replace(self.original, generation=str(uuid.uuid4())), replace(self.original, digest="a" * 64)]:
            self.assertEqual(self.operation("cancel", wrong).status, 409)
        legacy = self.app.handle("POST", "/v1/cancel", self.headers,
            json.dumps({"requestId": self.original.request_id}).encode())
        self.assertEqual(legacy.status, 409)
        self.assertFalse(self.worker.job.cancelled.is_set())

    def test_no_supervisor_v2_refuses_while_legacy_cpu_path_stays_distinct(self):
        self.worker.cpu_operations = None
        self.assertEqual(self.operation("reserve", identity(self.owner)).status, 503)
        self.model.release.set()
        response = self.app.handle("POST", "/v1/transcriptions",
            {**self.headers, "content-type": "application/octet-stream", "x-request-id": "legacy-fixture"}, bytes(8000))
        self.assertEqual(response.status, 200)

    def test_legacy_directml_protocol_stays_separate_without_loading_gpu_modules(self):
        self.model.release.set()
        models = Models({"af_test": TinyVoice()}, [], self.model,
            {"qualified": True, "neuralCpuFallback": False}, "directml")
        legacy = Application(SpeechWorker(models, "af_test", INSTANCE), TOKEN)
        response = legacy.handle("POST", "/v1/transcriptions", {**self.headers,
            "content-type": "application/octet-stream", "x-request-id": "legacy-gpu-protocol-fixture"}, bytes(8000))
        self.assertEqual(response.status, 200)
        self.assertEqual(legacy.handle("POST", "/v2/operations/reserve", self.headers,
            json.dumps(identity(self.owner).wire()).encode()).status, 503)

    def test_cancel_before_model_scope_uses_original_event_without_expiring_tombstone(self):
        gate, entered = threading.Event(), threading.Event()
        actual = self.worker.transcribe
        def delayed(identifier, pcm, *, cancellation=None):
            entered.set()
            if not gate.wait(2): raise RuntimeError("fixture gate not released")
            return actual(identifier, pcm, cancellation=cancellation)
        self.worker.transcribe = delayed
        pcm = bytes(8000); original = identity(self.owner, pcm)
        self.owner.reserve(original)
        headers = {**self.headers, "content-type": "application/octet-stream", "x-veyra-identity": json.dumps(original.wire())}
        self.thread = threading.Thread(target=lambda: self.responses.append(self.app.handle("POST", "/v2/transcriptions", headers, pcm)))
        self.thread.start()
        try:
            self.assertTrue(entered.wait(1)); self.assertIsNone(self.worker.job)
            self.assertFalse(json.loads(self.operation("cancel", original).data)["drained"])
        finally:
            gate.set()
        self.thread.join(1)
        self.assertEqual(self.responses[0].status, 409)
        self.assertEqual(self.model.calls, 0)
        self.assertTrue(self.owner.observe(original)["drained"])

    def test_authentication_and_shape_bounds_precede_owner_effects(self):
        original = identity(self.owner)
        self.assertEqual(self.app.handle("POST", "/v2/operations/reserve", {}, json.dumps(original.wire()).encode()).status, 401)
        self.assertEqual(self.app.handle("POST", "/v2/operations/reserve", self.headers, b" " * 2049).status, 413)
        self.assertEqual(self.native.transitions, [])

    def test_no_neural_modules_or_process_runtime_loaded(self):
        for name in ("torch", "onnxruntime", "faster_whisper", "numpy", "kokoro_onnx"):
            self.assertNotIn(name, sys.modules)

    def framed(self, original, duplicate=False):
        self.model.release.set()
        pcm = bytes(8000)
        handler = object.__new__(Handler)
        handler.server = SimpleNamespace(application=self.app)
        handler.path = "/v2/transcriptions"
        handler.headers = Message()
        for key, value in [("Authorization", "Bearer " + TOKEN), ("Content-Type", "application/octet-stream"),
            ("Content-Length", str(len(pcm))), ("X-Veyra-Identity", json.dumps(original.wire()))]:
            handler.headers[key] = value
        if duplicate: handler.headers["X-Veyra-Identity"] = json.dumps(original.wire())
        handler.rfile, handler.wfile = io.BytesIO(pcm), io.BytesIO()
        statuses = []
        handler.send_response = statuses.append
        handler.send_header = lambda *args: None
        handler.end_headers = lambda: None
        handler._handle("POST")
        return statuses[0], handler.wfile.getvalue()

    def test_real_transport_framing_accepts_bounded_v2_pcm_and_rejects_duplicate_identity(self):
        original = identity(self.owner, bytes(8000)); self.owner.reserve(original)
        status, _ = self.framed(original, duplicate=True)
        self.assertEqual(status, 400); self.assertEqual(self.model.calls, 0)
        status, _ = self.framed(original)
        self.assertEqual(status, 200); self.assertEqual(self.model.calls, 1)
        self.assertTrue(self.owner.observe(original)["drained"])

    def test_request_terminal_is_not_global_worker_process_retirement(self):
        headers = {**self.headers, "content-type": "application/octet-stream", "x-request-id": "legacy-other-original"}
        self.thread = threading.Thread(target=lambda: self.responses.append(
            self.app.handle("POST", "/v1/transcriptions", headers, bytes(8000))))
        self.thread.start(); self.assertTrue(self.model.entered.wait(1))
        original = identity(self.owner, bytes(8000)); self.owner.reserve(original)
        response = self.app.handle("POST", "/v2/transcriptions", {**headers,
            "x-veyra-identity": json.dumps(original.wire())}, bytes(8000))
        self.assertEqual(response.status, 429)
        proof = self.owner.observe(original)
        self.assertTrue(proof["drained"]); self.assertEqual(proof["outcome"], "failed")
        self.assertEqual(self.worker.job.request_id, "legacy-other-original")
        self.assertTrue(self.worker.inference_lock.locked())


if __name__ == "__main__":
    unittest.main(verbosity=2)
