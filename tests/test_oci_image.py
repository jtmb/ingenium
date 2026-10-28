import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("veyra_oci_image", Path(__file__).resolve().parents[1] / "ops/oci_image.py")
oci = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(oci)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ["TMPDIR"]).resolve(strict=True)
        self.temp = tempfile.TemporaryDirectory(prefix="oci-publisher-test-", dir=base)
        self.root = Path(self.temp.name)
        self.assertEqual(self.root.resolve().parent, base)

    def tearDown(self):
        self.assertEqual(self.root.resolve(), self.root)
        entries = [self.root, *self.root.rglob("*")]
        for path in entries:
            self.assertFalse(path.is_symlink())
            self.assertNotIn(".git", path.parts)
        allocated = sum(path.lstat().st_blocks * 512 for path in entries)
        self.temp.cleanup()
        print(json.dumps({"removed": str(self.root), "linuxAllocatedBytes": allocated, "regeneration": "tests/test_oci_image.py deterministic archive fixtures", "windowsDiskRecoveryClaimed": False}))

    def fixture(self, *, os_name="linux", tampered=False, extra=None, duplicate=False, external=False, platform="amd64"):
        blobs = {}

        def blob(content, media):
            data = content if isinstance(content, bytes) else json.dumps(content, separators=(",", ":")).encode()
            digest = hashlib.sha256(data).hexdigest()
            blobs["blobs/sha256/" + digest] = data
            return {"mediaType": media, "digest": "sha256:" + digest, "size": len(data)}

        config = blob({"architecture": platform, "os": os_name, "config": {"Labels": {"org.opencontainers.image.revision": "a" * 40, "org.opencontainers.image.source": "https://github.com/jtmb/ingenium", "org.ingenium.source.sha256": "b" * 64}}}, oci.CONFIG)
        layer = blob(b"deterministic layer content", "application/vnd.oci.image.layer.v1.tar")
        if external:
            layer["urls"] = ["https://example.invalid/unowned-layer"]
        manifest = blob({"schemaVersion": 2, "mediaType": oci.MANIFEST, "config": config, "layers": [layer]}, oci.MANIFEST)
        if tampered:
            blobs["blobs/sha256/" + layer["digest"].split(":")[1]] = b"changed layer of same size!"
        files = {"oci-layout": b'{"imageLayoutVersion":"1.0.0"}', "index.json": json.dumps({"schemaVersion": 2, "manifests": [manifest]}).encode(), **blobs}
        if extra:
            files.update(extra)
        path = self.root / "image.tar"
        with tarfile.open(path, "w") as archive:
            for name, data in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            if duplicate:
                member = tarfile.TarInfo("index.json")
                member.size = len(files["index.json"])
                archive.addfile(member, io.BytesIO(files["index.json"]))
        return path, manifest["digest"]

    def test_valid_archive_keeps_root_digest_platform_and_provenance(self):
        path, expected = self.fixture()
        archive = oci.Archive(path)
        try:
            self.assertEqual(archive.digest, expected)
            self.assertEqual(archive.labels["org.opencontainers.image.revision"], "a" * 40)
            self.assertEqual(len(archive.leaves), 2)
        finally:
            archive.close()

    def test_tampered_layer_is_rejected_before_publication(self):
        path, _ = self.fixture(tampered=True)
        with self.assertRaisesRegex(RuntimeError, "oci_blob_(digest_mismatch|size_or_missing)"):
            oci.Archive(path)

    def test_wrong_platform_and_external_layer_are_rejected(self):
        for options, error in [({"os_name": "windows"}, "oci_config_platform"), ({"platform": "arm64"}, "oci_config_platform"), ({"external": True}, "oci_external_or_invalid_digest")]:
            with self.subTest(options=options):
                path, _ = self.fixture(**options)
                with self.assertRaisesRegex(RuntimeError, error):
                    oci.Archive(path)

    def test_archive_traversal_duplicate_and_unreferenced_blob_are_rejected(self):
        for options, error in [({"extra": {"../source.txt": b"escape"}}, "oci_unsafe_or_duplicate_member"), ({"duplicate": True}, "oci_unsafe_or_duplicate_member"), ({"extra": {"blobs/sha256/" + "c" * 64: b"unused"}}, "oci_unreferenced_blob")]:
            with self.subTest(options=options):
                path, _ = self.fixture(**options)
                with self.assertRaisesRegex(RuntimeError, error):
                    oci.Archive(path)
        self.assertFalse((self.root.parent / "source.txt").exists())

    def test_upload_location_never_forwards_auth_outside_repository(self):
        digest = "sha256:" + "d" * 64
        good = oci.upload_location("/v2/jtmb92/ingenium/blobs/uploads/uuid?_state=opaque", "jtmb92/ingenium", digest)
        self.assertTrue(good.startswith("/v2/jtmb92/ingenium/blobs/uploads/uuid?"))
        for value in ["https://attacker.invalid/v2/jtmb92/ingenium/blobs/uploads/uuid", "http://registry-1.docker.io/v2/jtmb92/ingenium/blobs/uploads/uuid", "https://user@registry-1.docker.io/v2/jtmb92/ingenium/blobs/uploads/uuid", "/v2/another/repository/blobs/uploads/uuid", "/v2/jtmb92/ingenium/blobs/uploads/uuid?digest=sha256:wrong"]:
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                oci.upload_location(value, "jtmb92/ingenium", digest)

    def test_upload_streams_blobs_and_never_overwrites_a_racing_tag(self):
        class FakeRegistry(oci.Registry):
            def __init__(self):
                super().__init__("test-token-never-sent", "jtmb92/ingenium")
                self.calls = []

            def request(self, method, path, *, body=None, size=0, content_type="application/octet-stream"):
                self.calls.append((method, path))
                if method == "HEAD":
                    return 404, {}
                if method == "POST":
                    return 202, {"location": self.base + "/blobs/uploads/uuid?_state=opaque"}
                data = body.read()
                if len(data) != size:
                    raise AssertionError("Incorrect stream length")
                return 201, {"docker-content-digest": "sha256:" + hashlib.sha256(data).hexdigest()}

        path, expected = self.fixture()
        archive = oci.Archive(path)
        try:
            registry = FakeRegistry()
            registry.upload(archive, "git-" + "a" * 40, lambda: None)
            self.assertTrue(registry.calls[-1][1].endswith("/manifests/git-" + "a" * 40))
            racing = FakeRegistry()
            with self.assertRaisesRegex(RuntimeError, "existing_tag_differs_no_overwrite"):
                racing.upload(archive, "git-" + "a" * 40, lambda: {"digest": "sha256:" + "f" * 64})
            self.assertFalse(any("/manifests/" in path for _, path in racing.calls))
            matching = FakeRegistry()
            matching.upload(archive, "git-" + "a" * 40, lambda: {"digest": expected})
            self.assertFalse(any("/manifests/" in path for _, path in matching.calls))
            with path.open("ab") as changed:
                changed.write(b"changed after verification")
            with self.assertRaisesRegex(RuntimeError, "oci_archive_changed"):
                archive.ensure_unchanged()
        finally:
            archive.close()


if __name__ == "__main__":
    unittest.main()
