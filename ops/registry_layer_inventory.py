"""Read-only streaming inventory of one verified OCI gzip layer.

Never extracts files or opens archive paths. Both the compressed descriptor and
full uncompressed diff ID must match before a derived inventory is returned.
"""
from __future__ import annotations
import gzip
import hashlib
import io
import json
import posixpath
import re
import tarfile
from pathlib import PurePosixPath

MAX_INFLATED_BYTES = 8 * 1024**3
MAX_ENTRIES = 100000
MAX_METADATA_BYTES = 64 * 1024**2

class LayerInventoryError(RuntimeError):
    pass

def _need(value, code):
    if not value:
        raise LayerInventoryError(code)

def _encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()

def _path(value, *, absolute=False):
    _need(isinstance(value, str) and len(value.encode('utf-8', 'surrogateescape')) <= 8192
          and not any(ord(char) < 32 or ord(char) == 127 for char in value)
          and chr(92) not in value, 'LAYER_PATH_INVALID')
    while value.startswith('./'):
        value = value[2:]
    if absolute:
        value = value.lstrip('/')
    _need(not value.startswith('/') and '..' not in value.split('/'), 'LAYER_PATH_ESCAPE')
    result = str(PurePosixPath(value))
    return '/' if result == '.' else '/' + result

def _enter_header(archive):
    archive._veyra_header_depth = getattr(archive, '_veyra_header_depth', 0) + 1
    _need(archive._veyra_header_depth <= 16, 'LAYER_HEADER_DEPTH')

class _BoundedTarInfo(tarfile.TarInfo):
    def _proc_pax(self, archive):
        _need(0 <= self.size <= 1024**2, 'LAYER_PAX_BOUND')
        _enter_header(archive)
        try:
            value = super()._proc_pax(archive)
            _need(len(archive.pax_headers) <= 256 and
                  sum(len(str(k)) + len(str(v)) for k, v in archive.pax_headers.items()) <= 1024**2,
                  'LAYER_GLOBAL_PAX_BOUND')
            return value
        finally:
            archive._veyra_header_depth -= 1

    def _proc_gnulong(self, archive):
        _need(0 <= self.size <= 65536, 'LAYER_LONG_HEADER_BOUND')
        _enter_header(archive)
        try:
            return super()._proc_gnulong(archive)
        finally:
            archive._veyra_header_depth -= 1

    def _proc_sparse(self, *args):
        raise LayerInventoryError('LAYER_SPARSE_UNSUPPORTED')

    _proc_gnusparse_00 = _proc_sparse
    _proc_gnusparse_01 = _proc_sparse
    _proc_gnusparse_10 = _proc_sparse

class _InflatedHash(io.RawIOBase):
    def __init__(self, source, progress):
        super().__init__()
        self.source = source
        self.hash = hashlib.sha256()
        self.bytes = 0
        self.progress = progress
        self.next_progress = 64 * 1024**2

    def readable(self):
        return True

    def read(self, size=-1):
        _need(type(size) is int and 0 <= size <= 1024**2, 'LAYER_READ_BOUND')
        chunk = self.source.read(size)
        self.bytes += len(chunk)
        _need(self.bytes <= MAX_INFLATED_BYTES, 'LAYER_INFLATED_BOUND')
        self.hash.update(chunk)
        if self.progress and self.bytes >= self.next_progress:
            self.progress({'inflatedBytes': self.bytes})
            self.next_progress = self.bytes + 64 * 1024**2
        return chunk

    def readinto(self, buffer):
        chunk = self.read(len(buffer))
        buffer[:len(chunk)] = chunk
        return len(chunk)

def inventory_layer(reader, descriptor, diff_id, *, selected_prefixes=(), progress=None):
    """Return verified layer DATA, never an unpacked filesystem or runtime grant.

    selected_prefixes select content-tree summaries; every layer entry and file
    is still read/hashed. Cross-layer hard links remain explicitly unresolved.
    """
    _need(isinstance(descriptor, dict) and isinstance(diff_id, str) and
          re.fullmatch(r'sha256:[a-f0-9]{64}', diff_id), 'LAYER_DESCRIPTOR_INVALID')
    _need(isinstance(selected_prefixes, (tuple, list)) and len(selected_prefixes) <= 32,
          'LAYER_SELECTION_BOUND')
    _need(descriptor.get('mediaType') in ('application/vnd.oci.image.layer.v1.tar+gzip',
          'application/vnd.docker.image.rootfs.diff.tar.gzip'), 'LAYER_GZIP_REQUIRED')
    prefixes = sorted(set(_path(prefix, absolute=True).rstrip('/') or '/' for prefix in selected_prefixes))
    rows = []
    by_path = {}
    metadata_bytes = 0
    file_bytes = 0
    with reader.blob(descriptor) as compressed:
        with gzip.GzipFile(fileobj=compressed, mode='rb') as inflated:
            raw = _InflatedHash(inflated, progress)
            try:
                with tarfile.open(fileobj=raw, mode='r|', tarinfo=_BoundedTarInfo) as archive:
                    while True:
                        member = archive.next()
                        if member is None:
                            break
                        name = _path(member.name)
                        _need(name != '/' or member.isdir(), 'LAYER_ROOT_MEMBER_INVALID')
                        _need(name not in by_path and len(rows) < MAX_ENTRIES, 'LAYER_ENTRY_DUPLICATE_OR_BOUND')
                        _need(0 <= member.mode <= 0o7777 and type(member.size) is int
                              and 0 <= member.size <= 2 * 1024**3 and not member.sparse
                              and type(member.uid) is int and 0 <= member.uid < 2**32 - 1
                              and type(member.gid) is int and 0 <= member.gid < 2**32 - 1,
                              'LAYER_MEMBER_INVALID')
                        row = {'path': name, 'mode': member.mode, 'uid': member.uid,
                               'gid': member.gid, 'bytes': member.size}
                        if member.pax_headers:
                            row['paxHeadersSha256'] = hashlib.sha256(_encode(member.pax_headers)).hexdigest()
                        whiteout = PurePosixPath(name).name.startswith('.wh.')
                        if whiteout:
                            _need(member.size == 0 and (member.isfile() or
                                  member.ischr() and member.devmajor == member.devminor == 0),
                                  'LAYER_WHITEOUT_INVALID')
                            row['type'] = 'whiteout'
                        elif member.isfile():
                            row['type'] = 'file'
                            digest = hashlib.sha256()
                            left = member.size
                            source = archive.extractfile(member)
                            _need(source is not None, 'LAYER_FILE_STREAM_REQUIRED')
                            with source:
                                while left:
                                    chunk = source.read(min(65536, left))
                                    _need(bool(chunk), 'LAYER_FILE_TRUNCATED')
                                    digest.update(chunk)
                                    left -= len(chunk)
                                _need(source.read(1) == b'', 'LAYER_FILE_SIZE_CHANGED')
                            row['sha256'] = digest.hexdigest()
                            file_bytes += member.size
                        elif member.isdir():
                            _need(member.size == 0, 'LAYER_DIRECTORY_DATA')
                            row['type'] = 'directory'
                        elif member.issym() or member.islnk():
                            _need(member.size == 0 and isinstance(member.linkname, str) and
                                  0 < len(member.linkname) <= 8192 and chr(92) not in member.linkname and
                                  not any(ord(char) < 32 or ord(char) == 127 for char in member.linkname),
                                  'LAYER_LINK_INVALID')
                            row['type'] = 'symlink' if member.issym() else 'hardlink'
                            row['link'] = member.linkname
                            row['resolvedImagePath'] = (posixpath.normpath(posixpath.join(
                                posixpath.dirname(name), member.linkname)) if member.issym()
                                else _path(member.linkname, absolute=True))
                        else:
                            raise LayerInventoryError('LAYER_SPECIAL_ENTRY_UNSUPPORTED')
                        metadata_bytes += len(_encode(row))
                        _need(metadata_bytes <= MAX_METADATA_BYTES, 'LAYER_METADATA_BOUND')
                        rows.append(row)
                        by_path[name] = row
                        # Sequential next()/regular-file reads never need member
                        # adoption or the cache; bound memory on Python3.12 too.
                        archive.members.clear()
                    # Inspect all unparsed buffered TAR tail bytes too. A second
                    # hidden archive after an EOF block cannot evade inventory.
                    while tail := archive.fileobj.read(65536):
                        _need(not any(tail), 'LAYER_TRAILING_NONZERO_DATA')
            except LayerInventoryError:
                raise
            except Exception:
                raise LayerInventoryError('LAYER_TAR_STREAM_INVALID') from None
            actual_diff = 'sha256:' + raw.hash.hexdigest()
            _need(actual_diff == diff_id, 'LAYER_DIFF_ID_CHANGED')
        while compressed.read(65536):
            pass
        compressed.verify()
        compressed_bytes = compressed.bytes_read
    rows.sort(key=lambda row: row['path'])
    unresolved = []
    for row in rows:
        if row['type'] == 'hardlink':
            target = by_path.get(row['resolvedImagePath'])
            if target and target['type'] == 'file':
                row['referencedContentSha256'] = target['sha256']
                row['referencedContentBytes'] = target['bytes']
            else:
                unresolved.append(row['path'])
    groups = []
    for prefix in prefixes:
        selected = [row for row in rows if row['path'] == prefix or row['path'].startswith(prefix.rstrip('/') + '/')]
        outside = [row['path'] for row in selected if row['type'] in ('symlink', 'hardlink') and
                   row['resolvedImagePath'] != prefix and not row['resolvedImagePath'].startswith(prefix.rstrip('/') + '/')]
        groups.append({'prefix': prefix, 'entries': len(selected), 'regularFiles': sum(row['type'] == 'file' for row in selected),
            'logicalFileBytes': sum(row['bytes'] for row in selected if row['type'] == 'file'),
            'treeManifestKind': 'sha256-tree-manifest-v1',
            'treeManifestSha256': hashlib.sha256(_encode({'version': 1, 'entries': selected})).hexdigest(),
            'linksOutsidePrefix': outside, 'unresolvedHardlinks': [name for name in unresolved if name == prefix or name.startswith(prefix.rstrip('/') + '/')]})
    return {'version': 1, 'compressedDigest': descriptor['digest'], 'compressedBytes': compressed_bytes,
        'diffId': actual_diff, 'inflatedBytes': raw.bytes, 'entries': len(rows), 'logicalFileBytes': file_bytes,
        'metadataBytes': metadata_bytes, 'rows': rows, 'selectedTrees': groups,
        'unresolvedHardlinks': unresolved, 'verifiedCompressedAndUncompressedBytes': True,
        'filesExtractedOrImageAccepted': False}