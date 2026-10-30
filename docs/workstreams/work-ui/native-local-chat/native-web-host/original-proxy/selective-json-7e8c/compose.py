"""Compose after frozen7e8c entirely in memory; no Native writes/compilation."""
import argparse,difflib,hashlib,json,runpy
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--native',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parent
base=runpy.run_path(str(root.parent/'charged-owner-3d27'/'compose.py'))
before={p:s for p,s in base['post'].items()};after={}
lib='crates/adapters/src/lib.rs'
after[lib]=before[lib].replace('pub mod native_web_payload;','pub mod native_web_payload;\nmod native_web_json;')
path='crates/adapters/src/native_web_json.rs';assert not (a.native/path).exists();before[path]='';after[path]=(root/'selective_json.rs').read_text()
original='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_original.rs'
text=before[original]
start=text.index('        let value: Value = serde_json::from_slice(&self.body)')
end=text.index('        // Stable across native/proxy',start)
replacement='''        let value=crate::native_web_json::Json::parse(self.body_owner()).map_err(|_|local_error())?;
        let Some(id)=value.member("id").map_err(|_|local_error())? else{return Ok(None)};
        let id=id.decoded_string_bounded(160).map_err(|_|local_error())?;
        let id=std::str::from_utf8(id.as_ref()).map_err(|_|local_error())?;
        if !id.starts_with(prefix)||id.len()<=prefix.len()||!id.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-'){return Err(local_error())}
'''
text=text[:start]+replacement+text[end:]
old='let key = serde_json::to_vec(&(&owner.installation_id,&owner.custodian_key,\n            &owner.workspace_id,&owner.environment,self.session_id(),self.route(),id)).map_err(|_|RuntimeError::Storage)?;'
new='let key = crate::native_web_payload::json_payload(self.body.pool(),&(&owner.installation_id,&owner.custodian_key,\n            &owner.workspace_id,&owner.environment,self.session_id(),self.route(),id)).map_err(|_|RuntimeError::Storage)?;'
assert text.count(old)==1;text=text.replace(old,new);after[original]=text
completion='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_completion.rs'
text=before[completion];start=text.index('fn classify(');assert text[start:].count('\nfn ')==0
after[completion]=text[:start]+(root/'classify.rs').read_text()
patch=[]
for path,text in after.items():
 text=''.join(line.rstrip(' \t\r\n')+'\n' for line in text.splitlines());after[path]=text
 patch.extend(difflib.unified_diff(before[path].splitlines(True),text.splitlines(True),fromfile='a/'+path if before[path] else '/dev/null',tofile='b/'+path,n=0))
data=''.join(patch).encode();(root/'selective-json.patch').write_bytes(data)
pins={path:{'preimage_sha256':hashlib.sha256(before[path].encode()).hexdigest(),'proposed_sha256':hashlib.sha256(text.encode()).hexdigest()}for path,text in after.items()}
(root/'inputs.json').write_text(json.dumps(pins,indent=2)+'\n')
source=(root/'selective_json.rs').read_text();classification=(root/'classify.rs').read_text()
checks={
 'four_path_followon_exact_7e8c_in_memory':len(after)==4,
 'no_full_value_or_string_ast':'serde_json::Value' not in source and 'String' not in source.split('#[cfg(test)]')[0].replace('owned-string',''),
 'same_actual_payload_pool_for_keys':'self.pool.allocate(count.checked_mul(32)' in source,
 'key_destination_before_append':source.index('self.pool.allocate(count.checked_mul(32)')<source.index('keys.append(&digest[..])'),
 'selected_destination_before_decode_copy':source.index('let mut out=self.body.pool().allocate')<source.index('out.append(c?'),
 'bounded_selected_length_before_allocation':source.index('filter(|n|*n<=maximum)')<source.index('let mut out=self.body.pool().allocate'),
 'decoded_duplicate_keys_checked':'prior==&digest[..]' in source,
 'bounded_depth_nodes_and_keys':all(x in source for x in ['DEPTH:usize=64','NODES:usize=200_000','KEYS:usize=4096']),
 'surrogate_pair_and_raw_utf8_checks':all(x in source for x in ['0xD800..=0xDBFF','0xDC00..=0xDFFF','std::str::from_utf8']),
 'selected_members_are_actual_spans':'self.body.span(begin..end)' in source,
 'stable_key_serialization_still_same_tuple':'json_payload(self.body.pool(),&(&owner.installation_id' in after[original],
 'ack_classification_retains_required_fields':all(x in classification for x in ['"sessionID"','"type"','"user"','"time"','"created"','"payload"','"delivery"','"steer"','"queue"']),
 'no_materialization_join_minted':'NativeWebReadJoined{' not in classification,
 'five_rust_fixtures_supplied_unrun':source.count('#[test]')==5,
}
assert all(checks.values()),checks
receipt={'scope':'unintegrated finite source/composition checks only','checks':checks,'passed':sum(checks.values()),'rust_fixtures_supplied':5,'rust_fixtures_run':False,'compiler_or_runtime_run':False,'ddl_or_dependency_change':False,'patch_sha256':hashlib.sha256(data).hexdigest(),'patch_bytes':len(data),'remaining':['Root semantic/compiler/fuzz/real JSON qualification','Windows materialization/WSL canonical provenance AST replacement','source/decode/path/HTTP/SQLite/bookkeeping budgets','real20MiB/full64MiB acceptance']}
(root/'review.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'passed':receipt['passed'],'patch_bytes':len(data),'patch_sha256':receipt['patch_sha256']}))
