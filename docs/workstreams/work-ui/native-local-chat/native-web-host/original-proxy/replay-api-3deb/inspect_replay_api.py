"""Read pinned local primary sources only; no extraction/build/SQL/runtime.

python3 -B inspect_replay_api.py --native <windows-source> --registry <cargo-cache/registry>
Outputs only api-review.json beside this recipe. Caches are read-only.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import tarfile
import tomllib

p = argparse.ArgumentParser()
p.add_argument('--native', type=Path, required=True)
p.add_argument('--registry', type=Path, required=True)
a = p.parse_args()
version = '0.40.2'
crate = f'rusqlite-{version}'
index = 'index.crates.io-1949cf8c6b5b557f'
lock_bytes = (a.native / 'Cargo.lock').read_bytes()
package = next(x for x in tomllib.loads(lock_bytes.decode())['package']
               if x['name'] == 'rusqlite')
assert package['version'] == version
archive = a.registry / 'cache' / index / f'{crate}.crate'
archive_bytes = archive.read_bytes()
assert hashlib.sha256(archive_bytes).hexdigest() == package['checksum']
paths = ['Cargo.toml', 'src/lib.rs', 'src/blob/mod.rs', 'src/blob/pos_io.rs']
sources = {}
hashes = {}
with tarfile.open(fileobj=io.BytesIO(archive_bytes), mode='r:gz') as tar:
    for relative in paths:
        member = tar.extractfile(f'{crate}/{relative}')
        assert member is not None
        with member:
            raw = member.read()
        assert raw == (a.registry / 'src' / index / crate / relative).read_bytes()
        hashes[relative] = hashlib.sha256(raw).hexdigest()
        sources[relative] = raw.decode()
manifest_bytes = (a.native / 'Cargo.toml').read_bytes()
manifest = tomllib.loads(manifest_bytes.decode())
declared = manifest['workspace']['dependencies']['rusqlite']
features = tomllib.loads(sources['Cargo.toml'])['features']
mod = sources['src/blob/mod.rs']
pos = sources['src/blob/pos_io.rs']
checks = {
    'archive_matches_actual_lock_checksum': True,
    'four_cached_sources_exact_archive': len(hashes) == 4,
    'native_exact_version': declared['version'] == '=0.40.2',
    'native_no_blob_feature': 'blob' not in declared['features'],
    'default_does_not_enable_blob': 'blob' not in features['default'],
    'bundled_does_not_enable_blob': 'blob' not in features['bundled'],
    'backup_does_not_enable_blob': features['backup'] == [],
    'blob_module_feature_gated': '#[cfg(feature = "blob")]\npub mod blob;' in sources['src/lib.rs'],
    'blob_borrows_connection': "pub struct Blob<'conn> {\n    conn: &'conn Connection," in mod,
    'open_takes_exact_row_and_read_only': 'row_id: i64,\n        read_only: bool,' in mod,
    'positional_read_uses_caller_slice': 'buf: &mut [u8], read_start: usize' in pos,
    'underlying_read_length_bounded_by_destination': 'Some(v) => v.min(buf.len())' in pos,
    'explicit_close_returns_result': 'pub fn close(mut self) -> Result<()>' in mod,
    'drop_discards_close_result': 'fn drop(&mut self) {\n        self.close_();' in mod,
    'close_clears_handle_before_result': 'self.blob = ptr::null_mut();\n        self.conn.decode_result(rc)' in mod,
}
assert all(checks.values()), checks
result = {
    'scope': 'pinned primary-source API inspection only; no Rust/SQL/native execution',
    'rusqlite_version': version,
    'archive_sha256': package['checksum'],
    'archive_bytes': len(archive_bytes),
    'cache_sources_sha256': hashes,
    'native_manifest_sha256': hashlib.sha256(manifest_bytes).hexdigest(),
    'native_lock_sha256': hashlib.sha256(lock_bytes).hexdigest(),
    'native_features': declared['features'],
    'checks': checks,
    'passed': sum(checks.values()),
    'build_runtime_or_ddl': False,
    'memory_bound_or_close_success_proven': False,
}
target = Path(__file__).resolve().with_name('api-review.json')
target.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'passed': result['passed'], 'output': str(target)}))
