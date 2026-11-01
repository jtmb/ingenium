"""In-memory HTTP fixtures only; no registry, image, package or file writes."""
from pathlib import Path
import importlib.util
import io
import json
import hashlib
import unittest
from unittest.mock import Mock, patch
import urllib.error
import urllib.parse
from email.message import Message

spec = importlib.util.spec_from_file_location('registry_reader', Path(__file__).parents[1] / 'ops/registry_image_reader.py')
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
sha = lambda raw: 'sha256:' + hashlib.sha256(raw).hexdigest()
encode = lambda value: json.dumps(value, separators=(',', ':')).encode()

class Response(io.BytesIO):
    def __init__(self, raw=b'', status=200):
        super().__init__(raw)
        self.status = status

def fixture_image(change_manifest=None, change_config=None, index=False, duplicate_platform=False):
    layer = b'fixture layer'
    config = {'os': 'linux', 'architecture': 'amd64', 'rootfs': {'type': 'layers', 'diff_ids': [sha(b'fixture tar')]}}
    if change_config:
        change_config(config)
    cb = encode(config)
    manifest = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.manifest.v1+json',
        'config': {'mediaType': 'application/vnd.oci.image.config.v1+json', 'digest': sha(cb), 'size': len(cb)},
        'layers': [{'mediaType': 'application/vnd.oci.image.layer.v1.tar+gzip', 'digest': sha(layer), 'size': len(layer)}]}
    if change_manifest:
        change_manifest(manifest)
    mb = encode(manifest)
    root = {'schemaVersion': 2, 'mediaType': 'application/vnd.oci.image.index.v1+json', 'manifests': [
        {'platform': {'os': 'linux', 'architecture': 'amd64'}, 'digest': sha(mb), 'size': len(mb)}]}
    if duplicate_platform:
        root['manifests'].append(dict(root['manifests'][0]))
    rb = encode(root) if index else mb
    requests = []
    responses = []
    mapping = {sha(rb): rb, sha(mb): mb, sha(cb): cb}
    def open_request(request, **_):
        requests.append(request)
        raw = encode({'token': 'fixture-pull-token'}) if request.host == 'auth.docker.io' else mapping[request.full_url.rsplit('/', 1)[1]]
        response = Response(raw)
        responses.append(response)
        return response
    client = reader.RegistryImageReader('fixture/image')
    client._opener.open = open_request
    return client, sha(rb), requests, responses

class RegistryReaderTests(unittest.TestCase):
    def test_complete_bounded_original_blob_verifies_at_eof(self):
        raw = b'abcdef' * 100
        response = Response(raw)
        stream = reader.VerifiedBlob(response, sha(raw), len(raw))
        with self.assertRaisesRegex(reader.RegistryReadError, 'INCOMPLETE'):
            stream.verify()
        chunks = []
        while chunk := stream.read(17):
            chunks.append(chunk)
        self.assertEqual(b''.join(chunks), raw)
        self.assertEqual(stream.verify(), sha(raw))
        self.assertEqual(stream.bytes_read, len(raw))
        stream.close()
        self.assertTrue(response.closed)

    def test_same_size_changed_blob_never_accepts(self):
        with reader.VerifiedBlob(Response(b'evil'), sha(b'good'), 4) as stream:
            self.assertEqual(stream.read(4), b'evil')
            with self.assertRaisesRegex(reader.RegistryReadError, 'DIGEST_CHANGED'):
                stream.read(1)

    def test_truncated_and_extra_bytes_refuse(self):
        for raw, size, code in [(b'ab', 3, 'INCOMPLETE'), (b'abcd', 3, 'SIZE_CHANGED')]:
            with self.subTest(code=code), reader.VerifiedBlob(Response(raw), sha(b'abc'), size) as stream:
                with self.assertRaisesRegex(reader.RegistryReadError, code):
                    while stream.read(1024):
                        pass

    def test_unbounded_boolean_and_oversized_read_requests_refuse(self):
        with reader.VerifiedBlob(Response(b'x'), sha(b'x'), 1) as stream:
            for size in [-1, True, 1024**2 + 1, None]:
                with self.subTest(size=size), self.assertRaisesRegex(reader.RegistryReadError, 'READ_BOUND'):
                    stream.read(size)
            self.assertEqual(stream.bytes_read, 0)

    def test_readinto_is_bounded_and_transport_errors_are_sanitized(self):
        stream = reader.VerifiedBlob(Response(b'abc'), sha(b'abc'), 3)
        result = bytearray(2)
        self.assertEqual(stream.readinto(result), 2)
        self.assertEqual(result, b'ab')
        stream.close()
        response = Mock()
        response.read.side_effect = OSError('fixture sensitive signed URL')
        stream = reader.VerifiedBlob(response, sha(b'x'), 1)
        with self.assertRaisesRegex(reader.RegistryReadError, '^REGISTRY_BLOB_READ_UNAVAILABLE$'):
            stream.read(1)
        stream.close()
        response.close.assert_called_once()

    def test_expired_original_read_refuses_before_transport(self):
        response = Mock()
        with patch.object(reader.time, 'monotonic', side_effect=[100.0, 281.0]):
            stream = reader.VerifiedBlob(response, sha(b'x'), 1)
            with self.assertRaisesRegex(reader.RegistryReadError, 'DEADLINE'):
                stream.read(1)
        response.read.assert_not_called()
        stream.close()

    def test_complete_manifest_and_config_digests_are_verified(self):
        client, digest, requests, responses = fixture_image()
        value = client.image(digest)
        self.assertEqual(value['rootDigest'], digest)
        self.assertEqual(value['selectedDigest'], digest)
        self.assertEqual(value['config']['architecture'], 'amd64')
        self.assertTrue(all(response.closed for response in responses))
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(requests[0].full_url).query)
        self.assertEqual(query['scope'], ['repository:fixture/image:pull'])
        self.assertIsNone(requests[0].get_header('Authorization'))
        self.assertTrue(all(request.get_header('Authorization') == 'Bearer fixture-pull-token' for request in requests[1:]))

    def test_index_selects_one_exact_linux_amd64_manifest(self):
        client, digest, _, _ = fixture_image(index=True)
        value = client.image(digest)
        self.assertNotEqual(value['rootDigest'], value['selectedDigest'])
        client, digest, _, _ = fixture_image(index=True, duplicate_platform=True)
        with self.assertRaisesRegex(reader.RegistryReadError, 'PLATFORM_AMBIGUOUS'):
            client.image(digest)

    def test_platform_diff_count_and_media_mismatches_refuse(self):
        changes = [
            (None, lambda c: c.update(architecture='arm64')),
            (None, lambda c: c['rootfs'].update(diff_ids=[])),
            (None, lambda c: c['rootfs'].update(type='other')),
            (lambda m: m.update(mediaType='unknown'), None),
            (lambda m: m['config'].update(mediaType='unknown'), None),
            (lambda m: m['layers'][0].update(mediaType='unknown'), None),
            (lambda m: m['layers'][0].update(size=True), None),
            (lambda m: m['layers'][0].update(urls=['https://untrusted.test/layer']), None),
        ]
        for manifest, config in changes:
            with self.subTest(change=changes.index((manifest, config))):
                client, digest, _, _ = fixture_image(manifest, config)
                with self.assertRaises(reader.RegistryReadError):
                    client.image(digest)

    def test_metadata_duplicate_nonfinite_nonobject_and_bounds_refuse(self):
        for raw, limit, code in [(b'{"a":1,"a":2}', 100, 'DUPLICATE_KEY'),
            (b'{"a":NaN}', 100, 'NONFINITE'), (b'[]', 100, 'OBJECT_REQUIRED'),
            (b'{"long":"value"}', 4, 'BOUND')]:
            with self.subTest(code=code):
                client = reader.RegistryImageReader('fixture/image')
                response = Response(raw)
                client._opener.open = Mock(return_value=response)
                with self.assertRaisesRegex(reader.RegistryReadError, code):
                    client._json('https://registry-1.docker.io/fixture', limit)
                self.assertTrue(response.closed)

    def test_metadata_digest_tamper_refuses_closed_response(self):
        client = reader.RegistryImageReader('fixture/image')
        response = Response(b'{"tampered":true}')
        client._opener.open = Mock(return_value=response)
        with self.assertRaisesRegex(reader.RegistryReadError, 'METADATA_DIGEST_CHANGED'):
            client._json('https://registry-1.docker.io/fixture', 100, expected=sha(b'{"original":true}'))
        self.assertTrue(response.closed)

    def test_redirect_preserves_pull_bearer_only_at_registry_origin(self):
        client = reader.RegistryImageReader('fixture/image')
        client._token = 'fixture-pull-token'
        requests = []
        def open_request(request, **_):
            requests.append(request)
            if len(requests) == 1:
                headers = Message()
                headers['Location'] = 'https://production.cloudflare.docker.com/fixture?fixture=signed'
                raise urllib.error.HTTPError(request.full_url, 307, 'fixture redirect', headers, io.BytesIO())
            return Response(b'abc')
        client._opener.open = open_request
        response = client._open('https://registry-1.docker.io/v2/fixture/image/blobs/' + sha(b'abc'))
        response.close()
        self.assertEqual(requests[0].get_header('Authorization'), 'Bearer fixture-pull-token')
        self.assertIsNone(requests[1].get_header('Authorization'))

    def test_unsafe_or_unregistered_redirect_targets_refuse_before_request(self):
        client = reader.RegistryImageReader('fixture/image')
        client._opener.open = Mock()
        for url in ['http://registry-1.docker.io/a', 'https://user:pass@registry-1.docker.io/a',
            'https://registry-1.docker.io:444/a', 'https://registry-1.docker.io/a#fragment',
            'https://127.0.0.1/private', 'https://unregistered.test/blob']:
            with self.subTest(url=url), self.assertRaises(reader.RegistryReadError):
                client._open(url)
        client._opener.open.assert_not_called()

    def test_refused_non_200_response_is_closed(self):
        client = reader.RegistryImageReader('fixture/image')
        response = Response(b'partial', status=206)
        client._opener.open = Mock(return_value=response)
        with self.assertRaisesRegex(reader.RegistryReadError, 'HTTP_STATUS'):
            client._open('https://registry-1.docker.io/fixture')
        self.assertTrue(response.closed)

    def test_invalid_selectors_refuse_before_network(self):
        for name in ['../image', 'fixture/image?token=secret', 'fixture/image/extra', 'UPPER/image', '']:
            with self.subTest(name=name), self.assertRaises(reader.RegistryReadError):
                reader.RegistryImageReader(name)
        client = reader.RegistryImageReader('fixture/image')
        client._opener.open = Mock()
        with self.assertRaises(reader.RegistryReadError):
            client.image('not-a-digest')
        for descriptor in [None, {}, {'digest': sha(b'x'), 'size': True},
            {'digest': sha(b'x'), 'size': 1, 'urls': ['https://untrusted.test/a']}]:
            with self.subTest(descriptor=descriptor), self.assertRaises(reader.RegistryReadError):
                with client.blob(descriptor):
                    pass
        client._opener.open.assert_not_called()

    def test_blob_context_refuses_incomplete_success_and_closes_original_transport(self):
        client = reader.RegistryImageReader('fixture/image')
        client._token = 'fixture-pull-token'
        response = Response(b'abcdef')
        client._opener.open = Mock(return_value=response)
        with self.assertRaisesRegex(reader.RegistryReadError, 'INCOMPLETE'):
            with client.blob({'digest': sha(b'abcdef'), 'size': 6}) as stream:
                stream.read(3)
        self.assertTrue(response.closed)

    def test_blob_context_preserves_caller_failure_and_closes_without_drain(self):
        client = reader.RegistryImageReader('fixture/image')
        client._token = 'fixture-pull-token'
        response = Response(b'abcdef')
        client._opener.open = Mock(return_value=response)
        with self.assertRaisesRegex(ValueError, 'fixture caller failure'):
            with client.blob({'digest': sha(b'abcdef'), 'size': 6}) as stream:
                stream.read(1)
                raise ValueError('fixture caller failure')
        self.assertTrue(response.closed)

if __name__ == '__main__':
    unittest.main()