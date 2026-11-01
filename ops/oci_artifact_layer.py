"""Deterministic streaming OCI application layers from an explicit frozen file BOM.

No dependency installation, source mutation, cache, extraction, credentials,
registry publication, or image import occurs here. Callers own the output stream
and must discard/refuse partial output if any input or close check fails.
"""
from __future__ import annotations
import contextlib
import gzip
import hashlib
import io
import os
import posixpath
import re
import stat
import tarfile
from pathlib import Path

class ArtifactLayerError(ValueError):
    pass

def _need(value, code):
    if not value:
        raise ArtifactLayerError(code)

def _relative(value):
    _need(isinstance(value, str) and 0 < len(value) <= 8192
          and not value.startswith('/') and chr(92) not in value
          and not any(ord(c) < 32 or ord(c) == 127 for c in value)
          and all(part not in ('', '.', '..') for part in value.split('/')),
          'ARTIFACT_SOURCE_PATH')
    return value

def _target(value):
    _need(isinstance(value, str) and value.startswith('/app/') and
          value == posixpath.normpath(value) and len(value) <= 8192
          and not any(part.startswith('.wh.') for part in value.split('/')),
          'ARTIFACT_TARGET_PATH')
    _relative(value[1:])
    return value

def _identity(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mode,
            value.st_uid, value.st_gid, value.st_nlink, value.st_mtime_ns, value.st_ctime_ns)

@contextlib.contextmanager
def _source_bytes(root, row):
    source = root / row['source']
    _need(source.resolve() == source and source.is_relative_to(root), 'ARTIFACT_SOURCE_ALIAS')
    before = source.lstat()
    _need(stat.S_ISREG(before.st_mode) and before.st_nlink == 1
          and before.st_uid == os.geteuid() and before.st_size == row['bytes']
          and stat.S_IMODE(before.st_mode) == row['sourceMode'], 'ARTIFACT_SOURCE_IDENTITY')
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        _need(_identity(opened) == _identity(before), 'ARTIFACT_SOURCE_OPEN_CHANGED')
        with os.fdopen(fd, 'rb', closefd=False) as file:
            yield file
            _need(_identity(os.fstat(fd)) == _identity(before)
                  and _identity(source.lstat()) == _identity(before)
                  and source.resolve() == source, 'ARTIFACT_SOURCE_READ_CHANGED')
    finally:
        os.close(fd)

class _HashWriter:
    def __init__(self, output, limit):
        self.output = output
        self.limit = limit
        self.bytes = 0
        self.hash = hashlib.sha256()

    def write(self, data):
        _need(self.bytes + len(data) <= self.limit, 'ARTIFACT_OUTPUT_BOUND')
        written = self.output.write(data)
        _need(type(written) is int and written == len(data), 'ARTIFACT_OUTPUT_PARTIAL')
        self.hash.update(data)
        self.bytes += len(data)
        return written

    def flush(self):
        self.output.flush()

class _FileReader:
    def __init__(self, source, row):
        self.source = source
        self.row = row
        self.bytes = 0
        self.hash = hashlib.sha256()

    def read(self, size):
        _need(type(size) is int and 0 <= size <= 1024**2, 'ARTIFACT_FILE_READ_BOUND')
        chunk = self.source.read(size)
        _need(isinstance(chunk, bytes) and len(chunk) <= size, 'ARTIFACT_FILE_BYTES')
        self.bytes += len(chunk)
        _need(self.bytes <= self.row['bytes'], 'ARTIFACT_FILE_GREW')
        self.hash.update(chunk)
        return chunk

    def verify(self):
        _need(self.bytes == self.row['bytes'] and self.source.read(1) == b''
              and self.hash.hexdigest() == self.row['sha256'], 'ARTIFACT_FILE_HASH_OR_SIZE')

def _plan(rows, external_targets):
    _need(isinstance(rows, list) and 0 < len(rows) <= 100000, 'ARTIFACT_ROWS_BOUND')
    _need(isinstance(external_targets, (tuple, list)) and len(external_targets) <= 32,
          'ARTIFACT_EXTERNAL_TARGET_BOUND')
    external = set(_target(value) for value in external_targets)
    result = {}
    total = 0
    metadata_bytes = 0
    for row in rows:
        _need(isinstance(row, dict), 'ARTIFACT_ROW_INVALID')
        metadata_bytes += sum(len(value.encode('utf-8')) for key in ('source', 'target', 'link')
                              if isinstance((value := row.get(key)), str))
        _need(metadata_bytes <= 16 * 1024**2, 'ARTIFACT_METADATA_BOUND')
        target = _target(row.get('target'))
        _need(target not in result, 'ARTIFACT_TARGET_DUPLICATE')
        kind = row.get('type')
        _need(kind in ('directory', 'file', 'symlink'), 'ARTIFACT_ROW_TYPE')
        item = {'target': target, 'type': kind}
        if kind in ('file', 'directory'):
            mode = row.get('targetMode')
            _need(type(mode) is int and 0 <= mode <= 0o777 and not mode & 0o022,
                  'ARTIFACT_TARGET_MODE')
            item['targetMode'] = mode
        if kind == 'file':
            _relative(row.get('source'))
            _need(type(row.get('sourceMode')) is int and 0 <= row['sourceMode'] <= 0o777,
                  'ARTIFACT_SOURCE_MODE')
            _need(type(row.get('bytes')) is int and 0 <= row['bytes'] <= 2 * 1024**3
                  and isinstance(row.get('sha256'), str) and re.fullmatch('[a-f0-9]{64}', row['sha256']),
                  'ARTIFACT_FILE_BOUND_OR_DIGEST')
            item.update({key: row[key] for key in ('source', 'sourceMode', 'bytes', 'sha256')})
            total += row['bytes']
            _need(total <= 4 * 1024**3, 'ARTIFACT_TOTAL_BOUND')
        elif kind == 'symlink':
            link = row.get('link')
            _need(isinstance(link, str) and 0 < len(link) <= 8192 and chr(92) not in link
                  and not any(ord(c) < 32 or ord(c) == 127 for c in link), 'ARTIFACT_LINK_INVALID')
            resolved = _target(posixpath.normpath(posixpath.join(posixpath.dirname(target), link)))
            item.update(link=link, resolvedTarget=resolved)
        result[target] = item
    # Deterministic explicit parents replace extraction-umask assumptions.
    for target in list(result):
        parent = posixpath.dirname(target)
        while parent != '/':
            if parent in result:
                _need(result[parent]['type'] == 'directory', 'ARTIFACT_PARENT_NOT_DIRECTORY')
            else:
                result[parent] = {'target': parent, 'type': 'directory', 'targetMode': 0o755}
            parent = posixpath.dirname(parent)
    _need(len(result) <= 120000, 'ARTIFACT_PARENT_BOUND')
    for item in result.values():
        if item['type'] == 'symlink':
            resolved = item['resolvedTarget']
            _need(resolved in result and result[resolved]['type'] != 'symlink'
                  or resolved in external, 'ARTIFACT_LINK_TARGET_UNQUALIFIED')
            # Links may refer to another layer's explicitly declared workspace
            # package directory; no unlisted cross-layer target is accepted.
            for parent in Path(resolved).parents:
                if str(parent) == '/':
                    break
                if str(parent) in result:
                    _need(result[str(parent)]['type'] == 'directory', 'ARTIFACT_LINK_PARENT_ALIAS')
    return sorted(result.values(), key=lambda item: (item['type'] != 'directory', item['target'])), total

def write_layer(root, rows, output, *, source_date_epoch, external_symlink_targets=(),
                max_compressed_bytes=1024**3):
    """Write one frozen, root-owned /app layer; return hashes after full success.

    A successful result covers exactly this BOM, not other application artifacts
    or the final image. Missing Core/API/SDK/frontend inputs stay separate gates.
    """
    _need(type(source_date_epoch) is int and 0 < source_date_epoch < 2**32,
          'ARTIFACT_EPOCH_INVALID')
    _need(type(max_compressed_bytes) is int and 0 < max_compressed_bytes <= 4 * 1024**3,
          'ARTIFACT_COMPRESSED_BOUND')
    root = Path(root).resolve(strict=True)
    _need(root.is_dir(), 'ARTIFACT_SOURCE_ROOT')
    items, total = _plan(rows, external_symlink_targets)
    compressed = _HashWriter(output, max_compressed_bytes)
    with gzip.GzipFile(filename='', mode='wb', fileobj=compressed,
                       compresslevel=6, mtime=0) as zipped:
        inflated = _HashWriter(zipped, 5 * 1024**3)
        with tarfile.open(fileobj=inflated, mode='w|', format=tarfile.PAX_FORMAT,
                          bufsize=65536) as archive:
            for item in items:
                member = tarfile.TarInfo(item['target'][1:])
                member.uid = member.gid = 0
                member.uname = member.gname = 'root'
                member.mtime = source_date_epoch
                if item['type'] == 'directory':
                    member.type = tarfile.DIRTYPE
                    member.mode = item['targetMode']
                    archive.addfile(member)
                elif item['type'] == 'symlink':
                    member.type = tarfile.SYMTYPE
                    member.mode = 0o777
                    member.linkname = item['link']
                    archive.addfile(member)
                else:
                    member.mode = item['targetMode']
                    member.size = item['bytes']
                    with _source_bytes(root, item) as source:
                        reader = _FileReader(source, item)
                        archive.addfile(member, reader)
                        reader.verify()
        inflated.flush()
    compressed.flush()
    return {'version': 1, 'mediaType': 'application/vnd.oci.image.layer.v1.tar+gzip',
            'digest': 'sha256:' + compressed.hash.hexdigest(), 'size': compressed.bytes,
            'diffId': 'sha256:' + inflated.hash.hexdigest(), 'uncompressedBytes': inflated.bytes,
            'entries': len(items), 'logicalFileBytes': total, 'sourceDateEpoch': source_date_epoch,
            'finalImageRuntimeOrPublicationAccepted': False}
