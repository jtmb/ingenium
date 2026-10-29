"""Model-free worker-boundary tests and explicit proposal structural checks.

These execute the real Python Application/_job owner with inert test doubles.
They do not compile or execute the proposed Rust transport.
"""
import hashlib
import json
from pathlib import Path
import sys
import threading
import unittest

HERE = Path(__file__).resolve().parent
WORKER = HERE.parents[3] / "packages/veyra-voice/speech-worker"
sys.path.insert(0, str(WORKER))
from veyra_worker import Application, Models, SpeechWorker  # noqa: E402
from inference_control import check_inference  # noqa: E402

ID = "21af783b-b665-43b4-8482-c68606c1c166"
TOKEN = "unit-test-token-with-no-real-secret-000"


class PendingTranscriber:
    """Simulate an in-flight kernel that cannot be drained by a cancel ACK."""
    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()

    def transcribe(self, pcm, job):
        self.entered.set()
        if not self.release.wait(2):
            raise AssertionError("test did not release owned inference")
        check_inference(job)
        return "fixture transcript"


class ContractTests(unittest.TestCase):
    def setUp(self):
        self.transcriber = PendingTranscriber()
        models = Models(voices={"af_test": object()}, catalog=[],
            transcriber=self.transcriber,
            runtime_info={"qualified": True, "backend": "cpu-onnx"}, backend="cpu-onnx")
        self.worker = SpeechWorker(models, "af_test", "fixture-instance")
        self.app = Application(self.worker, TOKEN)
        self.headers = {"authorization": "Bearer " + TOKEN,
            "content-type": "application/octet-stream", "x-request-id": ID}
        self.responses = []
        self.thread = None

    def tearDown(self):
        self.transcriber.release.set()
        if self.thread is not None:
            self.thread.join(3)
            self.assertFalse(self.thread.is_alive())

    def start_original(self):
        self.thread = threading.Thread(target=lambda: self.responses.append(
            self.app.handle("POST", "/v1/transcriptions", self.headers, bytes(8000))))
        self.thread.start()
        self.assertTrue(self.transcriber.entered.wait(1))

    def cancel(self):
        return self.app.handle("POST", "/v1/cancel",
            {"authorization": "Bearer " + TOKEN, "content-type": "application/json"},
            json.dumps({"requestId": ID}).encode())

    def test_cancel_ack_leaves_original_kernel_owned_and_running(self):
        self.start_original()
        self.assertEqual(self.cancel().status, 200)
        self.assertTrue(self.worker.inference_lock.locked())
        self.assertEqual(self.worker.job.request_id, ID)
        self.assertEqual(self.responses, [])

    def test_original_terminal_cancel_response_follows_actual_scope_exit(self):
        self.start_original()
        self.cancel()
        self.transcriber.release.set()
        self.thread.join(1)
        self.assertEqual(self.responses[0].status, 409)
        self.assertEqual(json.loads(self.responses[0].data)["error"]["code"], "CANCELLED")
        self.assertIsNone(self.worker.job)
        self.assertFalse(self.worker.inference_lock.locked())

    def test_dropped_response_cannot_be_reconciled_by_cancel_ack_or_health(self):
        self.start_original()
        # Client loses its original response channel. No cancel or health query
        # grants that client a per-request retirement proof.
        self.assertEqual(self.cancel().status, 200)
        self.assertTrue(self.worker.health()["busy"])
        self.assertTrue(self.worker.inference_lock.locked())
        self.transcriber.release.set()
        self.thread.join(1)
        self.responses.clear()  # dropped original response, not observed by client
        self.assertFalse(self.worker.health()["busy"])
        self.assertNotIn("requestId", self.worker.health())

    def test_original_success_returns_after_scope_exit(self):
        self.start_original()
        self.transcriber.release.set()
        self.thread.join(1)
        self.assertEqual(self.responses[0].status, 200)
        self.assertEqual(json.loads(self.responses[0].data)["text"], "fixture transcript")
        self.assertIsNone(self.worker.job)
        self.assertFalse(self.worker.inference_lock.locked())

    def test_worker_rejects_overlong_audio_without_admission(self):
        response = self.app.handle("POST", "/v1/transcriptions", self.headers, bytes(480002))
        self.assertEqual(response.status, 413)
        self.assertIsNone(self.worker.job)

    def test_worker_rejects_overlong_text_without_truncation_or_admission(self):
        response = self.app.handle("POST", "/v1/speech",
            {"authorization": "Bearer " + TOKEN, "content-type": "application/json"},
            json.dumps({"requestId": ID, "text": "x" * 601, "voice": "af_test"}).encode())
        self.assertEqual(response.status, 400)
        self.assertEqual(json.loads(response.data)["error"]["code"], "INVALID_TEXT")
        self.assertIsNone(self.worker.job)

    def test_explicit_af_sarah_is_not_replaced_by_worker_default(self):
        response = self.app.handle("POST", "/v1/speech",
            {"authorization": "Bearer " + TOKEN, "content-type": "application/json"},
            json.dumps({"requestId": ID, "text": "fixture", "voice": "af_sarah"}).encode())
        self.assertEqual(response.status, 400)
        self.assertEqual(json.loads(response.data)["error"]["code"], "UNKNOWN_VOICE")
        self.assertIsNone(self.worker.job)

    def test_patch_hash_and_unknown_precedes_cancel(self):
        patch = (HERE / "native-cpu-http.patch").read_bytes()
        manifest = json.loads((HERE / "provenance.json").read_text())
        self.assertEqual(hashlib.sha256(patch).hexdigest(), manifest["patchSha256"])
        text = patch.decode()
        self.assertLess(text.index('+                    Err(http_worker::Failure::RemoteUncertain)'),
            text.index('+                    Err(http_worker::Failure::Known(_)) if worker_cancel'))
        self.assertIn('+                    if self.remote_quarantined(&jobs)?', text)
        self.assertIn('http_worker::receipt_blocks(&receipt.operation, jobs.contains_key(id))', text)

    def test_native_agent_identity_and_gateway_are_outside_patch(self):
        text = (HERE / "native-cpu-http.patch").read_text()
        paths = [line for line in text.splitlines() if line.startswith("+++ ")]
        self.assertEqual(paths, ['+++ b/crates/adapters/src/speech.rs',
            '+++ b/crates/adapters/src/speech/http_worker.rs',
            '+++ b/crates/adapters/src/voice.rs',
            '+++ b/apps/service/src/routes/speech.rs',
            '+++ b/apps/service/src/routes/voice.rs'])

    def test_token_read_is_one_guarded_handle_with_a_hard_259_byte_bound(self):
        text = (HERE / "http_worker.rs").read_text()
        self.assertIn('reader.take(259).read_to_end', text)
        self.assertIn('bounded_token_bytes(&file)?', text)
        self.assertIn('token_observation_matches(before, after, bytes.len())', text)
        self.assertIn('before == after && read_length as u64 == before.length', text)
        self.assertIn('links == 1 && (32..=258).contains(&length)', text)
        self.assertNotIn('std::fs::read(', text)
        self.assertNotIn('std::fs::metadata(', text)
        self.assertNotIn('super::configured_file(', text)

    def test_native_custody_requires_original_acl_and_reparse_ancestor_guards(self):
        text = (HERE / "http_worker.rs").read_text()
        self.assertIn('verify_owner_only(&file, ProtectedAclKind::File)', text)
        self.assertIn('verify_owner_only(private_parent, ProtectedAclKind::Directory)', text)
        self.assertIn('windows_file_metadata::inspect', text)
        self.assertIn('FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS', text)
        self.assertIn('ancestors.push((guard, facts))', text)
        self.assertIn('for (guard, expected) in &ancestors', text)
        self.assertNotIn('.share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)', text)
        self.assertIn('facts.reparse || facts.delete_pending', text)
        self.assertIn('share_mode(FILE_SHARE_READ).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)', text)
        self.assertIn('#[cfg(not(windows))]\nfn protected_token() -> super::Result<String> { Err(Error::Unconfigured) }', text)

    def test_status_uses_execution_owner_and_does_not_reload_selection(self):
        text = (HERE / "native-cpu-http.patch").read_text()
        self.assertIn('+    pub fn status(&self) -> Value {', text)
        self.assertIn('+        match &self.remote {', text)
        self.assertIn('+        if self.speech.status()', text)
        self.assertIn('spawn_blocking(move || speech.status())', text)
        self.assertNotIn('+    match http_worker::Config::load()', text)
        # Config is captured once at construction, not again in owner status.
        added = '\n'.join(line[1:] for line in text.splitlines() if line.startswith('+'))
        self.assertEqual(added.count('remote: http_worker::Config::load()'), 1)

    def test_adapter_no_fallback_and_original_response_is_required(self):
        text = (HERE / "http_worker.rs").read_text()
        self.assertIn('Ok("owned-http-cpu")', text)
        self.assertIn('health["backend"] != "cpu-onnx"', text)
        self.assertIn('Err(_) => return Err(Failure::RemoteUncertain)', text)
        self.assertIn('result.ok_or(Failure::RemoteUncertain)?', text)
        self.assertIn('"X-Request-ID", id', text)
        self.assertIn('"requestId":id', text)

    def test_neural_modules_not_loaded(self):
        for name in ("torch", "onnxruntime", "faster_whisper", "kokoro_onnx", "numpy"):
            self.assertNotIn(name, sys.modules)


if __name__ == "__main__":
    unittest.main(verbosity=2)
