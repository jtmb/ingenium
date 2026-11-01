"""In-memory OCI gzip/TAR fixtures, no registry requests or filesystem writes."""
from pathlib import Path
import importlib.util
import io
import json
import tarfile
import gzip
import hashlib
import unittest
from unittest.mock import patch
from contextlib import contextmanager

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parents[1] / 'ops' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

registry = load('registry_reader', 'registry_image_reader.py')
layer = load('layer_inventory', 'registry_layer_inventory.py')
sha = lambda data: 'sha256:' + hashlib.sha256(data).hexdigest()

def make_tar(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w', format=tarfile.PAX_FORMAT) as archive:
        for item in entries:
            info = tarfile.TarInfo(item['name'])
            info.mode = item.get('mode', 0o644)
            info.uid = item.get('uid', 0)
            info.gid = item.get('gid', 0)
            info.type = item.get('type', tarfile.REGTYPE)
            info.linkname = item.get('link', '')
            info.devmajor = item.get('major', 0)
            info.devminor = item.get('minor', 0)
            info.pax_headers = item.get('pax', {})
            body = item.get('body', b'')
            info.size = len(body)
            archive.addfile(info, io.BytesIO(body))
    return output.getvalue()

class FixtureReader:
    def __init__(self, compressed):
        self.compressed = compressed
        self.calls = 0
        self.responses = []
    @contextmanager
    def blob(self, descriptor):
        self.calls += 1
        response = io.BytesIO(self.compressed)
        self.responses.append(response)
        stream = registry.VerifiedBlob(response, descriptor['digest'], descriptor['size'])
        try:
            yield stream
            stream.verify()
        finally:
            stream.close()

def fixture(entries=None, raw=None):
    if raw is None:
        raw = make_tar(entries or [])
    compressed = gzip.compress(raw, mtime=0)
    reader = FixtureReader(compressed)
    descriptor = {'mediaType': 'application/vnd.oci.image.layer.v1.tar+gzip',
                  'digest': sha(compressed), 'size': len(compressed)}
    return reader, descriptor, sha(raw)

class LayerInventoryTests(unittest.TestCase):
    def test_complete_file_directory_notice_modes_and_internal_links_are_recorded(self):
        r, d, diff = fixture([
            {'name': 'opt/browser', 'type': tarfile.DIRTYPE, 'mode': 0o755},
            {'name': 'opt/browser/chrome', 'body': b'fixture executable', 'mode': 0o4755},
            {'name': 'opt/browser/LICENSE', 'body': b'Original fixture notice'},
            {'name': 'opt/browser/alias', 'type': tarfile.LNKTYPE, 'link': 'opt/browser/chrome'},
            {'name': 'opt/browser/link', 'type': tarfile.SYMTYPE, 'link': 'chrome'},
        ])
        result = layer.inventory_layer(r, d, diff, selected_prefixes=['/opt/browser'])
        self.assertTrue(result['verifiedCompressedAndUncompressedBytes'])
        self.assertFalse(result['filesExtractedOrImageAccepted'])
        rows = {row['path']: row for row in result['rows']}
        self.assertEqual(rows['/opt/browser/chrome']['mode'], 0o4755)
        self.assertEqual(rows['/opt/browser/chrome']['sha256'], hashlib.sha256(b'fixture executable').hexdigest())
        self.assertEqual(rows['/opt/browser/alias']['referencedContentSha256'], rows['/opt/browser/chrome']['sha256'])
        self.assertEqual(result['selectedTrees'][0]['regularFiles'], 2)
        self.assertEqual(result['selectedTrees'][0]['linksOutsidePrefix'], [])
        self.assertEqual(result['unresolvedHardlinks'], [])
        self.assertTrue(all(response.closed for response in r.responses))

    def test_content_tree_digest_repeats_for_same_complete_bytes(self):
        entries = [{'name': 'opt/browser/a', 'body': b'fixture'}]
        r, d, diff = fixture(entries)
        first = layer.inventory_layer(r, d, diff, selected_prefixes=['/opt/browser'])
        r, d, diff = fixture(entries)
        second = layer.inventory_layer(r, d, diff, selected_prefixes=['/opt/browser'])
        self.assertEqual(first['selectedTrees'], second['selectedTrees'])

    def test_symlink_external_target_and_cross_layer_hardlink_stay_explicit(self):
        r, d, diff = fixture([
            {'name': 'opt/browser/link', 'type': tarfile.SYMTYPE, 'link': '/usr/bin/node'},
            {'name': 'opt/browser/lower', 'type': tarfile.LNKTYPE, 'link': 'lower-layer/file'},
        ])
        result = layer.inventory_layer(r, d, diff, selected_prefixes=['/opt/browser'])
        self.assertEqual(result['selectedTrees'][0]['linksOutsidePrefix'], ['/opt/browser/link', '/opt/browser/lower'])
        self.assertEqual(result['unresolvedHardlinks'], ['/opt/browser/lower'])
        self.assertFalse(result['filesExtractedOrImageAccepted'])

    def test_path_traversal_absolute_backslash_and_controls_never_reach_filesystem(self):
        for name in ['../escape', '/absolute', 'bad' + chr(92) + 'path', 'line\nname']:
            with self.subTest(name=name):
                r, d, diff = fixture([{'name': name, 'body': b'fixture'}])
                with patch('builtins.open', side_effect=AssertionError('No file may be opened from an archive path')):
                    with self.assertRaises(layer.LayerInventoryError):
                        layer.inventory_layer(r, d, diff)
                self.assertTrue(all(response.closed for response in r.responses))

    def test_duplicate_normalized_entry_refuses(self):
        for names in [('a', 'a'), ('a/x', 'a/./x')]:
            with self.subTest(names=names):
                r, d, diff = fixture([{'name': name, 'body': b'fixture'} for name in names])
                with self.assertRaisesRegex(layer.LayerInventoryError, 'DUPLICATE'):
                    layer.inventory_layer(r, d, diff)

    def test_gzip_descriptor_and_uncompressed_diff_are_independent_checks(self):
        r, d, diff = fixture([{'name': 'a', 'body': b'fixture'}])
        d['digest'] = sha(b'wrong compressed bytes')
        with self.assertRaises(Exception):
            layer.inventory_layer(r, d, diff)
        self.assertTrue(all(response.closed for response in r.responses))
        r, d, _ = fixture([{'name': 'a', 'body': b'fixture'}])
        with self.assertRaisesRegex(layer.LayerInventoryError, 'DIFF_ID_CHANGED'):
            layer.inventory_layer(r, d, sha(b'wrong tar'))

    def test_truncated_gzip_never_returns_an_inventory(self):
        r, d, diff = fixture([{'name': 'a', 'body': b'fixture'}])
        r.compressed = r.compressed[:-4]
        with self.assertRaises(Exception):
            layer.inventory_layer(r, d, diff)
        self.assertTrue(all(response.closed for response in r.responses))

    def test_hidden_second_archive_after_eof_blocks_refuses(self):
        raw = make_tar([{'name': 'first', 'body': b'one'}]) + make_tar([{'name': 'hidden', 'body': b'two'}])
        r, d, diff = fixture(raw=raw)
        with self.assertRaisesRegex(layer.LayerInventoryError, 'TRAILING_NONZERO_DATA'):
            layer.inventory_layer(r, d, diff)

    def test_plain_and_opaque_whiteouts_are_metadata_only(self):
        r, d, diff = fixture([
            {'name': 'opt/.wh.old'}, {'name': 'opt/.wh..wh..opq'},
            {'name': 'other/.wh.deleted', 'type': tarfile.CHRTYPE},
        ])
        result = layer.inventory_layer(r, d, diff)
        self.assertEqual([row['type'] for row in result['rows']], ['whiteout'] * 3)
        self.assertFalse(result['filesExtractedOrImageAccepted'])
        r, d, diff = fixture([{'name': '.wh.payload', 'body': b'not empty'}])
        with self.assertRaisesRegex(layer.LayerInventoryError, 'WHITEOUT_INVALID'):
            layer.inventory_layer(r, d, diff)

    def test_special_device_and_fifo_are_not_extracted_or_accepted(self):
        for kind in [tarfile.CHRTYPE, tarfile.BLKTYPE, tarfile.FIFOTYPE]:
            with self.subTest(kind=kind):
                r, d, diff = fixture([{'name': 'dev/fixture', 'type': kind, 'major': 1, 'minor': 3}])
                with self.assertRaisesRegex(layer.LayerInventoryError, 'SPECIAL_ENTRY_UNSUPPORTED'):
                    layer.inventory_layer(r, d, diff)

    def test_uid_and_root_member_constraints_refuse(self):
        for item in [{'name': '.', 'body': b'root file'}, {'name': 'a', 'uid': -1}, {'name': 'a', 'gid': 2**32}]:
            with self.subTest(item=item):
                r, d, diff = fixture([item])
                with self.assertRaises(layer.LayerInventoryError):
                    layer.inventory_layer(r, d, diff)

    def test_valid_pax_headers_are_bound_without_persisting_values(self):
        r, d, diff = fixture([{'name': 'a', 'body': b'fixture', 'pax': {'fixture.attribute': 'fixture value'}}])
        result = layer.inventory_layer(r, d, diff)
        self.assertIn('paxHeadersSha256', result['rows'][0])
        self.assertNotIn('fixture value', json.dumps(result))

    def test_oversized_pax_and_long_name_headers_refuse_before_body_allocation(self):
        for kind, size, code in [(tarfile.XHDTYPE, 1024**2 + 1, 'PAX_BOUND'),
                                 (tarfile.GNUTYPE_LONGNAME, 65537, 'LONG_HEADER_BOUND')]:
            with self.subTest(code=code):
                header = tarfile.TarInfo('fixture-header')
                header.type, header.size = kind, size
                raw = header.tobuf(format=tarfile.GNU_FORMAT) + bytes(1024)
                r, d, diff = fixture(raw=raw)
                with self.assertRaisesRegex(layer.LayerInventoryError, code):
                    layer.inventory_layer(r, d, diff)

    def test_entry_metadata_and_inflation_bounds_fail_closed(self):
        for setting, value in [('MAX_ENTRIES', 1), ('MAX_METADATA_BYTES', 1), ('MAX_INFLATED_BYTES', 1)]:
            with self.subTest(setting=setting):
                r, d, diff = fixture([{'name': 'a', 'body': b'fixture'}, {'name': 'b'}])
                with patch.object(layer, setting, value), self.assertRaises(layer.LayerInventoryError):
                    layer.inventory_layer(r, d, diff)
                self.assertTrue(all(response.closed for response in r.responses))

    def test_invalid_selection_and_diff_refuse_before_blob_io(self):
        r, d, diff = fixture([{'name': 'a'}])
        for selected, expected in [('/not-a-list', diff), (['/../escape'], diff), (['/x'] * 33, diff), ([], 'not-a-hash')]:
            with self.subTest(selected=selected, expected=expected), self.assertRaises(layer.LayerInventoryError):
                layer.inventory_layer(r, d, expected, selected_prefixes=selected)
        self.assertEqual(r.calls, 0)

if __name__ == '__main__':
    unittest.main()