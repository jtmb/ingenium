import base64
import contextlib
import hashlib
import io
import json
from pathlib import Path
import runpy
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/prepare-vendor-security.py'
URL = 'https://registry.npmjs.org/shell-quote/-/shell-quote-1.11.0.tgz'

class Response(io.BytesIO):
    url = URL

class PackagePreparationTests(unittest.TestCase):
    def archive(self, member_name='package/package.json', link=False):
        content = json.dumps({'name':'shell-quote', 'version':'1.11.0'}).encode()
        output = io.BytesIO()
        with tarfile.open(fileobj=output, mode='w:gz') as bundle:
            item = tarfile.TarInfo(member_name)
            if link:
                item.type = tarfile.SYMTYPE
                item.linkname = '/etc/passwd'
                bundle.addfile(item)
            else:
                item.size = len(content)
                bundle.addfile(item, io.BytesIO(content))
        return output.getvalue()

    def run_preparation(self, archive, integrity=None, response_url=URL):
        with tempfile.TemporaryDirectory(prefix='vendor-prepare-test-') as folder:
            root = Path(folder)
            item = {'name':'shell-quote','from':'1.10.0','version':'1.11.0','url':URL,
                    'integrity':integrity or 'sha512-' + base64.b64encode(hashlib.sha512(archive).digest()).decode()}
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'schemaVersion':1,'packages':[item]}))
            response = Response(archive)
            response.url = response_url
            with patch.object(sys, 'argv', [str(SCRIPT), '--manifest',str(manifest),'--output',str(root/'output')]), patch('urllib.request.urlopen', return_value=response), contextlib.redirect_stdout(io.StringIO()):
                runpy.run_path(str(SCRIPT), run_name='__main__')
            self.assertTrue((root/'output/0/package/package.json').is_file())

    def test_verified_regular_package_is_materialized(self):
        self.run_preparation(self.archive())

    def test_corrupt_archive_is_rejected_before_extraction(self):
        with self.assertRaisesRegex(AssertionError, 'integrity mismatch'):
            self.run_preparation(self.archive(), 'sha512-' + base64.b64encode(bytes(64)).decode())

    def test_parent_traversal_is_rejected(self):
        with self.assertRaises(AssertionError):
            self.run_preparation(self.archive('package/../../outside.json'))

    def test_symbolic_links_are_rejected(self):
        with self.assertRaisesRegex(AssertionError, 'links and special'):
            self.run_preparation(self.archive(link=True))

    def test_redirect_to_other_host_is_rejected(self):
        with self.assertRaises(AssertionError):
            self.run_preparation(self.archive(), response_url='https://example.org/package.tgz')

if __name__ == '__main__':
    unittest.main()
