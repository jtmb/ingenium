"""Read exact pinned local primary sources/Root receipt; no extraction/runtime."""
import argparse,hashlib,io,json,tarfile,tomllib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--native',type=Path,required=True);p.add_argument('--registry',type=Path,required=True);a=p.parse_args();root=Path(__file__).resolve().parent
lock=tomllib.loads((a.native/'Cargo.lock').read_text());pkg=next(x for x in lock['package']if x['name']=='serde_json');assert pkg['version']=='1.0.151'
index='index.crates.io-1949cf8c6b5b557f';crate='serde_json-1.0.151';archive=a.registry/'cache'/index/(crate+'.crate');raw=archive.read_bytes();assert hashlib.sha256(raw).hexdigest()==pkg['checksum']
paths=['Cargo.toml','src/map.rs','src/number.rs','src/de.rs','src/ser.rs','src/value/de.rs','src/value/ser.rs']
sources={};hashes={}
with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz')as t:
 for path in paths:
  member=t.extractfile(crate+'/'+path);assert member is not None
  with member:data=member.read()
  assert data==(a.registry/'src'/index/crate/path).read_bytes();hashes[path]=hashlib.sha256(data).hexdigest();sources[path]=data.decode()
receipt=a.native.parent/'coordination/integration/serde-json-existing-fingerprints-r1.json';receipt_bytes=receipt.read_bytes();cached=json.loads(receipt_bytes)
observed=[json.loads(row['features'])for row in cached['rows']]
checks={
 'archive_exact_actual_lock':True,'seven_cached_files_exact_archive':len(hashes)==7,
 'default_features_std_only':tomllib.loads(sources['Cargo.toml'])['features']['default']==['std'],
 'map_btree_vs_index_feature_selected':'type MapImpl<K, V> = BTreeMap<K, V>;' in sources['src/map.rs'] and 'type MapImpl<K, V> = IndexMap<K, V>;' in sources['src/map.rs'],
 'actual_collect_str_streams_fragments':'match format_escaped_str_contents(self.writer, self.formatter, s)' in sources['src/ser.rs'],
 'actual_map_key_collect_str_delegates':'self.ser.collect_str(value)' in sources['src/ser.rs'],
 'number_serialize_feature_selected':'#[cfg(not(feature = "arbitrary_precision"))]' in sources['src/number.rs'] and 'N::Float(f) => serializer.serialize_f64(f)' in sources['src/number.rs'],
 'actual_float_format_zmij':'buffer.format_finite(value)' in sources['src/ser.rs'],
 'float_roundtrip_long_scratch_real':'#[cfg(feature = "float_roundtrip")]' in sources['src/de.rs'] and 'self.scratch.push(c);' in sources['src/de.rs'],
 'raw_value_first_key_changes_value_semantics':'Some(KeyClass::RawValue)' in sources['src/value/de.rs'],
 'arbitrary_precision_first_key_changes_value_semantics':'Some(KeyClass::Number)' in sources['src/value/de.rs'],
 'cached_observations_omit_three_special_features':all(not(set(row)&{'preserve_order','arbitrary_precision','float_roundtrip'})for row in observed),
}
assert all(checks.values()),checks
result={'scope':'pinned source + Root prior cache observations; NOT final target closure or Rust execution','version':pkg['version'],'archive_sha256':pkg['checksum'],'files_exact_archive_sha256':hashes,'root_feature_receipt':str(receipt),'root_feature_receipt_sha256':hashlib.sha256(receipt_bytes).hexdigest(),'cached_observation_count':len(observed),'cached_feature_sets':sorted({','.join(row)for row in observed}),'checks':checks,'passed':sum(checks.values()),'current_exact_target_feature_closure_verified':False,'compiler_or_runtime_run':False}
(root/'serde-primary-review.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':result['passed'],'current_exact_target_feature_closure_verified':False}))
