"""Materialize checksum-pinned registry packages for the image-only vendor overlay."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
import shutil
import urllib.request

def need(condition, message):
    if not condition:
        raise ValueError(message)

parser = argparse.ArgumentParser()
parser.add_argument('--manifest', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
manifest = json.loads(args.manifest.read_text())
need(manifest['schemaVersion'] == 1, 'Unsupported manifest schema')
args.output.mkdir(parents=True, exist_ok=False)
for index, item in enumerate(manifest['packages']):
    expected_url = f"https://registry.npmjs.org/{item['name']}/-/{item['name']}-{item['version']}.tgz"
    need(item['url'] == expected_url, 'Unexpected registry URL')
    need(item['integrity'].startswith('sha512-'), 'SHA-512 integrity required')
    with urllib.request.urlopen(item['url'], timeout=45) as response:
        need(response.url == expected_url, 'Unexpected registry redirect')
        archive = response.read(25 * 1024 * 1024 + 1)
    need(len(archive) <= 25 * 1024 * 1024, 'Archive too large')
    actual = base64.b64encode(hashlib.sha512(archive).digest()).decode()
    need(actual == item['integrity'].split('-', 1)[1], 'registry archive integrity mismatch')
    destination = args.output / str(index)
    destination.mkdir()
    with tarfile.open(fileobj=io.BytesIO(archive), mode='r:gz') as bundle:
        members = bundle.getmembers()
        need(len(members) <= 10000 and sum(member.size for member in members) < 50 * 1024 * 1024, 'Expanded archive too large')
        names = set()
        for member in members:
            name = PurePosixPath(member.name)
            need(name.parts and name.parts[0] == 'package' and '..' not in name.parts and not name.is_absolute(), 'Unsafe archive path')
            need(member.isfile() or member.isdir(), 'links and special archive members forbidden')
            need(name not in names, 'Duplicate archive path')
            names.add(name)
        # Python 3.11 in the pinned builder lacks extraction filters. Copy only
        # prevalidated regular files; never apply archive owners, links or modes.
        for member in members:
            target = destination.joinpath(*PurePosixPath(member.name).parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o755)
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
                with bundle.extractfile(member) as source, target.open('xb') as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
    package = json.loads((destination / 'package/package.json').read_text())
    need(package['name'] == item['name'] and package['version'] == item['version'], 'Unexpected package identity')
(args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
print(f"Verified {len(manifest['packages'])} pinned vendor package archives")
