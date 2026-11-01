"""Project a bounded artifact tree from a complete verified image inventory.

This returns build-input DATA. It never extracts files, grants runtime authority,
or establishes image, platform, browser launch, or rebuild acceptance.
The caller must bind persisted inventories to their original verified receipts.
"""
from __future__ import annotations
import hashlib
import json
import posixpath
import re

class ArtifactProjectionError(ValueError):
    pass

def _need(value, code):
    if not value:
        raise ArtifactProjectionError(code)

def _path(value):
    _need(isinstance(value, str) and value.startswith('/') and len(value) <= 8192
          and chr(92) not in value and not any(ord(c) < 32 or ord(c) == 127 for c in value),
          'ARTIFACT_PATH_INVALID')
    _need(value == posixpath.normpath(value) and not value.startswith('//'),
          'ARTIFACT_PATH_NONCANONICAL')
    return value

def _below(name, parent):
    return name == parent or name.startswith(parent.rstrip('/') + '/')

def _parents(name):
    result = []
    while name != '/':
        name = posixpath.dirname(name)
        if name != '/':
            result.append(name)
    return result

def _encode(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()

def _closure(metadata, inventories):
    manifest = metadata.get('manifest', {})
    config = metadata.get('config', {})
    descriptors = manifest.get('layers')
    diffs = config.get('rootfs', {}).get('diff_ids')
    _need(isinstance(descriptors, list) and 0 < len(descriptors) <= 256
          and isinstance(diffs, list) and len(diffs) == len(descriptors)
          and isinstance(inventories, list) and len(inventories) == len(descriptors),
          'ARTIFACT_LAYER_CLOSURE')
    by_index = {}
    for layer in inventories:
        index = layer.get('sourceLayerIndex')
        _need(type(index) is int and 0 <= index < len(descriptors) and index not in by_index,
              'ARTIFACT_LAYER_INDEX')
        descriptor = descriptors[index]
        _need(layer.get('version') == 1 and layer.get('verifiedCompressedAndUncompressedBytes') is True
              and layer.get('filesExtractedOrImageAccepted') is False
              and layer.get('compressedDigest') == descriptor.get('digest')
              and layer.get('compressedBytes') == descriptor.get('size')
              and layer.get('diffId') == diffs[index], 'ARTIFACT_LAYER_BINDING')
        rows = layer.get('rows')
        _need(isinstance(rows, list) and len(rows) == layer.get('entries') and len(rows) <= 100000,
              'ARTIFACT_LAYER_ROWS')
        by_index[index] = layer
    return [by_index[index] for index in range(len(descriptors))]

def project_artifact_tree(metadata, inventories, prefix, *, required_executable=None):
    """Hash the complete final tree, including whiteout effects in later layers.

    sha256-tree-manifest-v1 hashes UTF-8 ASCII-escaped sorted-key compact JSON
    {"version":1,"entries":[rows sorted by absolute image path]}. Each row contains
    path, type, mode, uid, gid, bytes, and file SHA-256 or exact symlink/link target.
    Extended metadata and hard links are refused rather than silently discarded.
    """
    prefix = _path(prefix)
    _need(prefix != '/', 'ARTIFACT_ROOT_TOO_BROAD')
    layers = _closure(metadata, inventories)
    ancestors = set(_parents(prefix))
    state = {}
    changes = []
    allowed = {'path', 'type', 'mode', 'uid', 'gid', 'bytes', 'sha256', 'link', 'resolvedImagePath'}
    for index, layer in enumerate(layers):
        relevant = []
        seen = set()
        whiteouts = []
        for row in layer['rows']:
            _need(isinstance(row, dict), 'ARTIFACT_ROW_INVALID')
            name = _path(row.get('path'))
            _need(name not in seen, 'ARTIFACT_ROW_DUPLICATE')
            seen.add(name)
            kind = row.get('type')
            if kind == 'whiteout':
                parent, base = posixpath.split(name)
                _need(base.startswith('.wh.') and len(base) > 4 and row.get('bytes') == 0,
                      'ARTIFACT_WHITEOUT_INVALID')
                target = parent if base == '.wh..wh..opq' else posixpath.join(parent, base[4:])
                if _below(target, prefix) or _below(prefix, target):
                    whiteouts.append((target, base == '.wh..wh..opq'))
            elif name in ancestors or _below(name, prefix):
                _need(set(row) <= allowed and kind in ('directory', 'file', 'symlink'),
                      'ARTIFACT_METADATA_UNSUPPORTED')
                _need(all(type(row.get(key)) is int for key in ('uid', 'gid', 'mode', 'bytes'))
                      and 0 <= row['uid'] < 2**32 - 1 and 0 <= row['gid'] < 2**32 - 1
                      and 0 <= row['mode'] <= 0o7777 and 0 <= row['bytes'] <= 2 * 1024**3,
                      'ARTIFACT_METADATA_INVALID')
                if kind == 'file':
                    _need(isinstance(row.get('sha256'), str)
                          and re.fullmatch('[a-f0-9]{64}', row['sha256']), 'ARTIFACT_FILE_DIGEST')
                else:
                    _need(row['bytes'] == 0, 'ARTIFACT_NONFILE_DATA')
                if kind == 'symlink':
                    link = row.get('link')
                    _need(isinstance(link, str) and 0 < len(link) <= 8192 and chr(92) not in link
                          and not any(ord(c) < 32 or ord(c) == 127 for c in link),
                          'ARTIFACT_SYMLINK_INVALID')
                    resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), link))
                    _need(resolved == row.get('resolvedImagePath') and _below(resolved, prefix),
                          'ARTIFACT_LINK_ESCAPE')
                if name in ancestors:
                    _need(kind == 'directory', 'ARTIFACT_ANCESTOR_NOT_DIRECTORY')
                relevant.append(row)
        if relevant or whiteouts:
            changes.append(index)
        # OCI whiteouts hide lower-layer entries, never entries from this layer.
        for target, opaque in whiteouts:
            for name in list(state):
                if _below(name, target) and (not opaque or name != target):
                    del state[name]
        for row in sorted(relevant, key=lambda r: (r['path'].count('/'), r['path'])):
            name = row['path']
            _need(all(parent not in state or state[parent]['type'] == 'directory'
                      for parent in _parents(name)), 'ARTIFACT_PARENT_NOT_DIRECTORY')
            previous = state.get(name)
            if row['type'] != 'directory' or previous and previous['type'] != 'directory':
                for child in list(state):
                    if child != name and _below(child, name):
                        del state[child]
            state[name] = dict(row)
    _need(prefix in state and state[prefix]['type'] == 'directory', 'ARTIFACT_ROOT_MISSING')
    selected = [state[name] for name in sorted(state) if _below(name, prefix)]
    _need(any(row['type'] == 'file' for row in selected), 'ARTIFACT_TREE_EMPTY')
    for row in selected:
        for name in [row['path'], *_parents(row['path'])]:
            if name == '/':
                continue
            actual = state.get(name)
            _need(actual is not None, 'ARTIFACT_PARENT_MISSING')
            _need(actual['uid'] == actual['gid'] == 0 and (actual['type'] == 'symlink' or not actual['mode'] & 0o022),
                  'ARTIFACT_MUTABLE_OWNER_OR_MODE')
        if row['type'] == 'symlink':
            target = row['resolvedImagePath']
            visited = {row['path']}
            while True:
                _need(target in state and target not in visited and len(visited) <= 40,
                      'ARTIFACT_LINK_MISSING_OR_CYCLE')
                visited.add(target)
                item = state[target]
                if item['type'] != 'symlink':
                    break
                target = item['resolvedImagePath']
            # Intermediate components must also be actual directories: no
            # hidden redirection through an otherwise in-tree directory link.
            _need(all(name in state and state[name]['type'] == 'directory' for name in _parents(target)),
                  'ARTIFACT_LINK_PARENT_NOT_DIRECTORY')
    if required_executable is not None:
        _need(isinstance(required_executable, str) and not required_executable.startswith('/')
              and required_executable not in ('', '.') and '..' not in required_executable.split('/'),
              'ARTIFACT_EXECUTABLE_SELECTOR')
        executable = state.get(prefix + '/' + required_executable)
        _need(executable is not None and executable['type'] == 'file'
              and executable['bytes'] > 0 and executable['mode'] & 0o111,
              'ARTIFACT_EXECUTABLE_MISSING')
    payload = _encode({'version': 1, 'entries': selected})
    return {'hashKind': 'sha256-tree-manifest-v1', 'sha256': hashlib.sha256(payload).hexdigest(),
            'root': prefix, 'entries': len(selected), 'regularFiles': sum(r['type'] == 'file' for r in selected),
            'logicalFileBytes': sum(r['bytes'] for r in selected if r['type'] == 'file'),
            'affectingLayerIndices': changes, 'completeImageLayerClosure': True,
            'runtimeOrImageReuseAccepted': False}
