"""Exact canonical source follow-on after5de7; Native is read-only."""
import argparse,difflib,hashlib,json,runpy
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--native',type=Path,required=True);a=p.parse_args();root=Path(__file__).resolve().parent
prior=runpy.run_path(str(root.parent/'windows-source-0b7e'/'compose.py'))
base=dict(prior['base']);base.update(prior['after']);before={};after={}
def load(path):before[path]=base[path] if path in base else (a.native/path).read_text();after[path]=before[path]
def change(path,old,new):
 if path not in after:load(path)
 assert after[path].count(old)==1,(path,old)
 after[path]=after[path].replace(old,new)
jsonmod='crates/adapters/src/native_web_json.rs'
load(jsonmod)
after[jsonmod]='mod canonical;\n'+after[jsonmod]
change(jsonmod,'impl Json{','impl Json{\n pub(crate) fn canonical_sha256(&self)->Result<[u8;32],Invalid>{canonical::hash(self)}\n pub(crate) fn canonical_is_object(&self)->Result<bool,Invalid>{canonical::is_object(self)}\n pub(crate) fn range_in(&self,parent:&Payload)->Option<Range<usize>>{self.body.range_in(parent)}')
start=after[jsonmod].index(' pub(crate) fn is_number(');end=after[jsonmod].index('\n',start)
after[jsonmod]=after[jsonmod][:start]+' pub(crate) fn is_number(&self)->bool{serde_json::from_slice::<serde_json::Number>(self.raw()).is_ok()}'+after[jsonmod][end:]
change(jsonmod,"b'\"'=>{self.string()?;},b'-'|b'0'..=b'9'=>self.number()?,",
 "b'\"'=>{self.string()?;},b'-'|b'0'..=b'9'=>{let begin=self.at;self.number()?;if check{serde_json::from_slice::<serde_json::Number>(&self.input[begin..self.at]).map_err(|_|Invalid)?;}},")
payload='crates/adapters/src/native_web_payload.rs'
change(payload,' pub fn span(&self,range:Range<usize>)->Option<Self>{',
 ''' pub(crate) fn range_in(&self,parent:&Self)->Option<Range<usize>>{
  if !Arc::ptr_eq(&self.allocation,&parent.allocation)||self.range.start<parent.range.start||self.range.end>parent.range.end{return None}
  Some(self.range.start-parent.range.start..self.range.end-parent.range.start)
 }
 pub fn span(&self,range:Range<usize>)->Option<Self>{''')
path='crates/adapters/src/native_web_json/canonical.rs';assert not(a.native/path).exists();before[path]='';after[path]=(root/'canonical.rs').read_text()
material='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_materialization.rs'
load(material);text=after[material]
text=text.replace('use std::{collections::{BTreeMap,BTreeSet},ops::Range,sync::Arc};','use std::{collections::BTreeSet,ops::Range};')
start=text.index('pub fn materialize_resolved_web_files(');end=text.index('#[cfg(test)]mod tests{',start)
after[material]=text[:start]+(root/'materialize.rs').read_text()+'\n'+text[end:]
patch=[]
for path,text in after.items():
 text=''.join(line.rstrip(' \t\r\n')+'\n' for line in text.splitlines());after[path]=text
 patch.extend(difflib.unified_diff(before[path].splitlines(True),text.splitlines(True),fromfile='a/'+path if before[path] else '/dev/null',tofile='b/'+path,n=0))
data=''.join(patch).encode();(root/'canonical-json.patch').write_bytes(data)
(root/'inputs.json').write_text(json.dumps({p:{'preimage_sha256':hashlib.sha256(before[p].encode()).hexdigest(),'proposed_sha256':hashlib.sha256(t.encode()).hexdigest()}for p,t in after.items()},indent=2)+'\n')
source=(root/'canonical.rs').read_text();body=(root/'materialize.rs').read_text()
checks={
 'four_exact_paths_after5de7':len(after)==4,
 'canonical_object_indexes_charged':'self.pool.allocate(capacity.max(1))' in source,
 'canonical_index_reserved_before_fill':source.index('self.pool.allocate(capacity.max(1))')<source.index('entries.refill_dynamic('),
 'canonical_keys_remain_source_spans':'compare_keys(&self.input[a],&self.input[b])' in source,
 'actual_dependency_map_order_probe':'serde_json::Map::new()' in source and 'if !preserve_order()' in source,
 'actual_library_string_escaping':'s.collect_str(self)' in source,
 'actual_library_number_parser_and_serializer':'let number:serde_json::Number=serde_json::from_slice(self.input)' in source and 'number.serialize(serializer)' in source,
 'std_f64_substitution_removed':'.parse::<f64>()' not in after[jsonmod]+source,
 'hash_output_streamed_not_full_vec':'serde_json::to_writer(&mut writer,&Node' in source,
 'legacy_full_body_view_ast_removed':'let view:Value' not in body and 'let before:Value' not in body and 'let mut expected=' not in body,
 'legacy_untracked_scanner_removed':'struct Scanner' not in after[material],
 'canonical_prompt_view_hash_preserved':'view.canonical_sha256()' in body and 'prompt_view_sha256' in body,
 'base64_destinations_before_decode':'allocate(base64::decoded_len_estimate' in body and 'STANDARD.decode_slice' in body,
 'base64_roundtrip_charged':'allocate(base64::encoded_len' in body and 'STANDARD.encode_slice' in body,
 'output_original_json_unknown_bytes_preserved':'effective.append(&original[last..span.start])' in body and 'effective.append(&original[last..])' in body,
 'no_new_protocol_or_ddl':all(not p.endswith('.sql') and not p.endswith('Cargo.toml') for p in after),
 'seven_meaningful_library_equivalence_fixtures_supplied':source.count('#[test]')==7 and 'assert_eq!(actual,legacy_bytes)' in source,
 'raw_and_number_private_keys_feature_selected':'raw_value_feature()' in source and 'arbitrary_precision_feature()' in source,
 'legacy_embedded_raw_duplicate_semantics_preserved':'data[prior*32+16..prior*32+32].copy_from_slice' in source,
 'legacy_raw_container_limit_matches_pinned_default':'containers>=127' in source,
 'legacy_semantic_root_object_shape_preserved':'before.canonical_is_object()' in body and 'semantic_object(decoded.as_ref(),pool,true)' in source,
}
assert all(checks.values()),checks
receipt={'scope':'unapplied finite source composition only; equivalence fixtures UNRUN','checks':checks,'passed':sum(checks.values()),'rust_fixtures_supplied':7,'rust_fixtures_run':False,'compiler_or_runtime_run':False,'ddl_or_dependency_change':False,'full_memory_or20MiB_qualified':False,'patch_bytes':len(data),'patch_sha256':hashlib.sha256(data).hexdigest(),'features':'Root prior cache receipt omits preserve_order/arbitrary_precision/float_roundtrip; raw_value mixed; final exact target closure remains Root qualification','remaining':['actual final target feature/Number scratch proof','Root exact compiler/library-equivalence and fuzz tests','full source provenance/path/WSL/HTTP/SQLite/bookkeeping bounds','actual full20MiB/64MiB qualification']}
(root/'review.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'passed':receipt['passed'],'patch_bytes':len(data),'patch_sha256':receipt['patch_sha256']}))
