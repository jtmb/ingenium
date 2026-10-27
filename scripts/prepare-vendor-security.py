"""Materialize checksum-pinned registry packages for the image-only vendor overlay."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('--manifest', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
manifest = json.loads(args.manifest.read_text())
assert manifest['schemaVersion'] == 1
args.output.mkdir(parents=True, exist_ok=False)
for index, item in enumerate(manifest['packages']):
    expected_url = f"https://registry.npmjs.org/{item['name']}/-/{item['name']}-{item['version']}.tgz"
    assert item['url'] == expected_url
    assert item['integrity'].startswith('sha512-')
    with urllib.request.urlopen(item['url'], timeout=45) as response:
        assert response.url == expected_url
        archive = response.read(25 * 1024 * 1024 + 1)
    assert len(archive) <= 25 * 1024 * 1024
    actual = base64.b64encode(hashlib.sha512(archive).digest()).decode()
    assert actual == item['integrity'].split('-', 1)[1], 'registry archive integrity mismatch'
    destination = args.output / str(index)
    destination.mkdir()
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as bundle:
        members = bundle.getmembers()
        assert sum(member.size for member in members) < 50 * 1024 * 1024
        for member in members:
            name = PurePosixPath(member.name)
            assert name.parts[0] == 'package' and '..' not in name.parts and not name.is_absolute()
            assert member.isfile() or member.isdir(), 'links and special archive members forbidden'
        bundle.extractall(destination, members=members, filter='data')
    package = json.loads((destination / 'package/package.json').read_text())
    assert package['name'] == item['name'] and package['version'] == item['version']
(args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
print(f"Verified {len(manifest['packages'])} pinned vendor package archives")
