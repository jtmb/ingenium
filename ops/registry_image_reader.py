"""Bounded, read-only Docker Hub image material reader.

Tokens stay in memory and are never forwarded to redirected blob hosts. Reading
metadata or verified bytes supplies no runtime, publication or deployment grant.
This module performs no request or filesystem write during import.
"""
from __future__ import annotations
import hashlib
import io
import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from contextlib import contextmanager

_DIGEST = re.compile(r'sha256:[a-f0-9]{64}\Z')
_REPOSITORY = re.compile(r'[a-z0-9]+(?:[._-][a-z0-9]+)*/[a-z0-9]+(?:[._-][a-z0-9]+)*\Z')
_REGISTRY = 'https://registry-1.docker.io'
_ACCEPT = ', '.join(('application/vnd.oci.image.index.v1+json',
 'application/vnd.docker.distribution.manifest.list.v2+json',
 'application/vnd.oci.image.manifest.v1+json',
 'application/vnd.docker.distribution.manifest.v2+json'))

class RegistryReadError(RuntimeError):
    """Stable failure code; never include bearer headers or signed redirect URLs."""

class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def _need(value, code):
    if not value:
        raise RegistryReadError(code)

def _digest(value):
    _need(isinstance(value, str) and _DIGEST.fullmatch(value), 'REGISTRY_DIGEST_INVALID')
    return value

def _https(url):
    try:
        parsed = urllib.parse.urlsplit(url)
        allowed = (parsed.scheme == 'https' and parsed.hostname and
            not parsed.username and not parsed.password and
            parsed.port in (None, 443) and not parsed.fragment)
    except (ValueError, TypeError):
        allowed = False
    _need(allowed, 'REGISTRY_REDIRECT_INVALID')
    host = parsed.hostname
    _need(host in ('registry-1.docker.io', 'auth.docker.io',
        'production.cloudflare.docker.com', 'production.cloudfront.docker.com',
        'docker-images-prod.s3.dualstack.us-east-1.amazonaws.com') or
        re.fullmatch(r'docker-images-prod\.[a-f0-9]{32}\.r2\.cloudflarestorage\.com', host),
        'REGISTRY_REDIRECT_HOST_REFUSED')
    return parsed

def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        _need(key not in result, 'REGISTRY_METADATA_DUPLICATE_KEY')
        result[key] = value
    return result

def _nonfinite(_value):
    raise RegistryReadError('REGISTRY_METADATA_NONFINITE')

class VerifiedBlob(io.RawIOBase):
    """One original response with bounded reads and complete size/hash validation.

    Closing an incomplete stream closes its transport without accepting it.
    Consumers must drain to EOF and call verify before accepting derived data.
    """
    def __init__(self, response, digest, size, *, deadline_seconds=180):
        super().__init__()
        self._response = response
        self._expected = _digest(digest)
        _need(type(size) is int and 0 < size <= 8 * 1024**3, 'REGISTRY_BLOB_SIZE_INVALID')
        _need(type(deadline_seconds) in (int, float) and 0 < deadline_seconds <= 600,
              'REGISTRY_BLOB_DEADLINE_INVALID')
        self._size = size
        self._hash = hashlib.sha256()
        self._bytes = 0
        self._eof = False
        self._deadline = time.monotonic() + deadline_seconds

    @property
    def bytes_read(self):
        return self._bytes

    def readable(self):
        return True

    def read(self, size=-1):
        _need(not self.closed and type(size) is int and 0 <= size <= 1024**2,
              'REGISTRY_BLOB_READ_BOUND')
        _need(time.monotonic() < self._deadline, 'REGISTRY_BLOB_DEADLINE')
        if size == 0:
            return b''
        try:
            chunk = self._response.read(min(size, self._size - self._bytes + 1))
        except Exception:
            raise RegistryReadError('REGISTRY_BLOB_READ_UNAVAILABLE') from None
        _need(isinstance(chunk, bytes), 'REGISTRY_BLOB_BYTES_REQUIRED')
        self._bytes += len(chunk)
        _need(self._bytes <= self._size, 'REGISTRY_BLOB_SIZE_CHANGED')
        self._hash.update(chunk)
        if not chunk:
            self._eof = True
            self.verify()
        return chunk

    def readinto(self, buffer):
        chunk = self.read(len(buffer))
        buffer[:len(chunk)] = chunk
        return len(chunk)

    def verify(self):
        _need(not self.closed and self._eof and self._bytes == self._size,
              'REGISTRY_BLOB_INCOMPLETE')
        _need('sha256:' + self._hash.hexdigest() == self._expected,
              'REGISTRY_BLOB_DIGEST_CHANGED')
        return self._expected

    def close(self):
        if not self.closed:
            try:
                self._response.close()
            finally:
                super().close()

class RegistryImageReader:
    def __init__(self, repository):
        _need(isinstance(repository, str) and len(repository) <= 255 and
              _REPOSITORY.fullmatch(repository), 'REGISTRY_REPOSITORY_INVALID')
        self.repository = repository
        self._opener = urllib.request.build_opener(_NoRedirect())
        self._token = None

    def _open(self, url, accept='application/json', *, authentication=True):
        for _ in range(4):
            parsed = _https(url)
            headers = {'User-Agent': 'Veyra-read-only-image-material/1', 'Accept': accept}
            if authentication and self._token and parsed.hostname == 'registry-1.docker.io':
                headers['Authorization'] = 'Bearer ' + self._token
            try:
                response = self._opener.open(urllib.request.Request(url, headers=headers), timeout=20)
                if response.status != 200:
                    response.close()
                    raise RegistryReadError('REGISTRY_HTTP_STATUS')
                return response
            except urllib.error.HTTPError as error:
                status = error.code
                location = error.headers.get('Location')
                error.close()
                if status in (301, 302, 303, 307, 308) and location:
                    url = urllib.parse.urljoin(url, location)
                    continue
                raise RegistryReadError('REGISTRY_READ_UNAVAILABLE') from None
            except RegistryReadError:
                raise
            except Exception:
                raise RegistryReadError('REGISTRY_READ_UNAVAILABLE') from None
        raise RegistryReadError('REGISTRY_REDIRECT_BOUND')

    def _json(self, url, limit, *, expected=None, authentication=True):
        with self._open(url, _ACCEPT, authentication=authentication) as response:
            try:
                raw = response.read(limit + 1)
            except Exception:
                raise RegistryReadError('REGISTRY_METADATA_READ_UNAVAILABLE') from None
        _need(isinstance(raw, bytes), 'REGISTRY_METADATA_BYTES_REQUIRED')
        _need(len(raw) <= limit, 'REGISTRY_METADATA_BOUND')
        if expected:
            _need('sha256:' + hashlib.sha256(raw).hexdigest() == _digest(expected),
                  'REGISTRY_METADATA_DIGEST_CHANGED')
        try:
            value = json.loads(raw, object_pairs_hook=_unique_pairs, parse_constant=_nonfinite)
        except (ValueError, UnicodeError):
            raise RegistryReadError('REGISTRY_METADATA_JSON_INVALID') from None
        _need(isinstance(value, dict), 'REGISTRY_METADATA_OBJECT_REQUIRED')
        return value, len(raw)

    def _authenticate(self):
        if self._token is None:
            query = urllib.parse.urlencode({'service': 'registry.docker.io',
                'scope': 'repository:' + self.repository + ':pull'})
            value, _ = self._json('https://auth.docker.io/token?' + query, 32768,
                                  authentication=False)
            token = value.get('token') or value.get('access_token')
            _need(isinstance(token, str) and 0 < len(token) < 16384, 'REGISTRY_PULL_TOKEN_INVALID')
            self._token = token

    def image(self, digest):
        """Select exactly one Linux/amd64 manifest; return verified metadata DATA."""
        _digest(digest)
        self._authenticate()
        base = _REGISTRY + '/v2/' + self.repository
        root, root_bytes = self._json(base + '/manifests/' + digest, 1024**2, expected=digest)
        selected_digest = digest
        selected, selected_bytes = root, root_bytes
        if 'manifests' in root:
            candidates = [row for row in root['manifests'] if
                row.get('platform', {}).get('os') == 'linux' and
                row.get('platform', {}).get('architecture') == 'amd64']
            _need(len(candidates) == 1, 'REGISTRY_PLATFORM_AMBIGUOUS')
            descriptor = candidates[0]
            selected_digest = _digest(descriptor.get('digest'))
            selected, selected_bytes = self._json(base + '/manifests/' + selected_digest,
                                                  1024**2, expected=selected_digest)
            _need(selected_bytes == descriptor.get('size'), 'REGISTRY_MANIFEST_SIZE_CHANGED')
        _need(selected.get('schemaVersion') == 2 and isinstance(selected.get('layers'), list)
              and 0 < len(selected['layers']) <= 256, 'REGISTRY_MANIFEST_INVALID')
        _need(selected.get('mediaType') in ('application/vnd.oci.image.manifest.v1+json',
            'application/vnd.docker.distribution.manifest.v2+json'), 'REGISTRY_MANIFEST_MEDIA_INVALID')
        config_descriptor = selected.get('config', {})
        _need(config_descriptor.get('mediaType') in ('application/vnd.oci.image.config.v1+json',
            'application/vnd.docker.container.image.v1+json'), 'REGISTRY_CONFIG_MEDIA_INVALID')
        config_digest = _digest(config_descriptor.get('digest'))
        config, config_bytes = self._json(base + '/blobs/' + config_digest, 8 * 1024**2,
                                         expected=config_digest)
        _need(config_bytes == config_descriptor.get('size') and
              config.get('os') == 'linux' and config.get('architecture') == 'amd64',
              'REGISTRY_CONFIG_PLATFORM_CHANGED')
        diffs = config.get('rootfs', {}).get('diff_ids')
        _need(config.get('rootfs', {}).get('type') == 'layers' and isinstance(diffs, list) and len(diffs) == len(selected['layers']),
              'REGISTRY_DIFF_CLOSURE_INVALID')
        for descriptor, diff in zip(selected['layers'], diffs):
            _digest(descriptor.get('digest')); _digest(diff)
            _need(type(descriptor.get('size')) is int and 0 < descriptor['size'] <= 8 * 1024**3
                  and not descriptor.get('urls') and descriptor.get('mediaType') in (
                  'application/vnd.oci.image.layer.v1.tar',
                  'application/vnd.oci.image.layer.v1.tar+gzip',
                  'application/vnd.oci.image.layer.v1.tar+zstd',
                  'application/vnd.docker.image.rootfs.diff.tar',
                  'application/vnd.docker.image.rootfs.diff.tar.gzip'), 'REGISTRY_LAYER_INVALID')
        return {'rootDigest': digest, 'selectedDigest': selected_digest,
                'rootBytes': root_bytes, 'selectedBytes': selected_bytes,
                'manifest': selected, 'config': config, 'configBytes': config_bytes}

    @contextmanager
    def blob(self, descriptor):
        _need(isinstance(descriptor, dict), 'REGISTRY_LAYER_INVALID')
        digest = _digest(descriptor.get('digest'))
        _need(type(descriptor.get('size')) is int and 0 < descriptor['size'] <= 8 * 1024**3,
              'REGISTRY_BLOB_SIZE_INVALID')
        _need(not descriptor.get('urls'), 'REGISTRY_EXTERNAL_LAYER_REFUSED')
        self._authenticate()
        response = self._open(_REGISTRY + '/v2/' + self.repository + '/blobs/' + digest,
                              'application/octet-stream')
        try:
            stream = VerifiedBlob(response, digest, descriptor.get('size'))
        except Exception:
            response.close()
            raise
        try:
            yield stream
            stream.verify()
        finally:
            stream.close()