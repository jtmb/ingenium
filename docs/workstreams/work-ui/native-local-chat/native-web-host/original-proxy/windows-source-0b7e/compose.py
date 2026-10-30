"""Owned-source follow-on only; compose after0b7e without changing Native."""
import argparse,difflib,hashlib,json,runpy
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--native',type=Path,required=True);a=p.parse_args();root=Path(__file__).resolve().parent
prior=runpy.run_path(str(root.parent/'selective-json-7e8c'/'compose.py'))
base=dict(prior['base']['post']);base.update(prior['after']);before={};after={}
def load(path):
 text=base[path] if path in base else (a.native/path).read_text();before[path]=text;after[path]=text
def change(path,old,new):
 if path not in after:load(path)
 assert after[path].count(old)==1,(path,old)
 after[path]=after[path].replace(old,new)
native='crates/adapters/src/local_execution/windows_web_read/native.rs'
change(native,'pub(crate) bytes:Vec<u8>','pub(crate) bytes:crate::native_web_payload::Buffer')
change(native,'files:&[String],batch_limit:usize,current:', 'files:&[String],batch_limit:usize,pool:&std::sync::Arc<crate::native_web_payload::Pool>,current:')
change(native,'let mut bytes=Vec::new();file.take(remaining as u64+1).read_to_end(&mut bytes).map_err(|_|"held source read refused")?;\n   total=total.checked_add(bytes.len()).filter(|n|*n<=batch_limit).ok_or("source bound exceeded")?;\n   let (mime,_)=crate::attachments::sniff_for_prompt(&bytes).map_err(|_|"source MIME unsupported by current native policy")?;',
 '''let expected=usize::try_from(node.stamp.as_ref().ok_or("source identity missing")?.size).map_err(|_|"source size unsupported")?;
   let capacity=expected.checked_add(1).ok_or("source capacity overflow")?;
   let bytes=pool.allocate(capacity).map_err(|_|"original resident source budget retained")?;
   self.sources.push(Source{bytes,mime:String::new(),absolute:absolute.clone()});
   let source=self.sources.last_mut().ok_or("actual source owner missing")?;
   let mut input=file.take(capacity as u64);
   loop{current()?;let count=source.bytes.read_once(&mut input,8192).map_err(|_|"held source read refused; prefix retained")?;
    if source.bytes.len()>expected{return Err("held source grew; original prefix retained".into())}if count==0{break}
   }
   if source.bytes.len()!=expected{return Err("held source length changed; original prefix retained".into())}
   total=total.checked_add(source.bytes.len()).filter(|n|*n<=batch_limit).ok_or("source bound exceeded")?;
   let (mime,_)=crate::attachments::sniff_for_prompt(source.bytes.as_ref()).map_err(|_|"source MIME unsupported by current native policy")?;
   source.mime=mime.into();''')
change(native,'   self.sources.push(Source{bytes,mime:mime.into(),absolute:absolute.clone()});','')
carrier='crates/adapters/src/local_execution/windows_web_read.rs'
change(carrier,'absolute_files:&[String],inline_bytes:usize,current:', 'absolute_files:&[String],inline_bytes:usize,pool:&std::sync::Arc<crate::native_web_payload::Pool>,current:')
change(carrier,'crate::attachments::MAX_BATCH_BYTES-inline_bytes,&||','crate::attachments::MAX_BATCH_BYTES-inline_bytes,pool,&||')
change(carrier,'let _=(absolute_files,inline_bytes);','let _=(absolute_files,inline_bytes,pool);')
windows='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_original/windows_read.rs'
change(windows,'held.capture(&lease.binding,&inputs.absolute_files,inputs.inline_bytes,current)', 'held.capture(&lease.binding,&inputs.absolute_files,inputs.inline_bytes,original.body_owner().pool(),current)')
payload='crates/adapters/src/native_web_payload.rs'
change(payload,' pub(crate) fn append(&mut self,bytes:&[u8])->Result<(),Refused>{',
 ''' pub(crate) fn refill_dynamic<E>(&mut self,fill:impl FnOnce(&mut[u8])->Result<usize,E>)->Result<(),Option<E>>{
  let actual=Arc::get_mut(&mut self.allocation).ok_or(None)?;self.length=0;
  let length=fill(&mut actual.bytes).map_err(Some)?;if length>actual.bytes.len(){return Err(None)}self.length=length;Ok(())
 }
 pub(crate) fn append(&mut self,bytes:&[u8])->Result<(),Refused>{''')
projects='crates/adapters/src/projects/local_web_originals.rs'
change(projects,'let mut sources=std::collections::BTreeMap::<String,Vec<u8>>::new();','let mut sources=std::collections::BTreeMap::<String,crate::native_web_payload::Payload>::new();')
change(projects,'let bytes=STANDARD.decode(&encoded).map_err(|_|StoreError::Invalid)?;',
 '''let capacity=base64::decoded_len_estimate(encoded.len()).max(1);
                let mut bytes=original.body_owner().pool().allocate(capacity).map_err(|_|StoreError::Conflict)?;
                bytes.refill_dynamic(|dst|STANDARD.decode_slice(encoded.as_bytes(),dst)).map_err(|_|StoreError::Invalid)?;
                let bytes=bytes.freeze();''')
change(projects,'Sha256::digest(&bytes))!=source_hash||STANDARD.encode(&bytes)!=encoded','Sha256::digest(bytes.as_ref()))!=source_hash||STANDARD.encode(bytes.as_ref())!=encoded')
change(projects,'if previous!=bytes{return Err(StoreError::Conflict);}','if previous.as_ref()!=bytes.as_ref(){return Err(StoreError::Conflict);}')
change(projects,'params![original.operation_id(),hash,bytes])','params![original.operation_id(),hash,bytes.as_ref()])')
change(projects,'        let count:i64=tx.query_row("SELECT count(*) FROM local_workspace_operations",[],|r|r.get(0))?;\n        if count>=4096{return Err(StoreError::Invalid);}\n','')
patch=[]
for path,text in after.items():
 text=''.join(line.rstrip(' \t\r\n')+'\n' for line in text.splitlines());after[path]=text
 patch.extend(difflib.unified_diff(before[path].splitlines(True),text.splitlines(True),fromfile='a/'+path,tofile='b/'+path,n=0))
data=''.join(patch).encode();(root/'source-charge.patch').write_bytes(data)
(root/'inputs.json').write_text(json.dumps({p:{'preimage_sha256':hashlib.sha256(before[p].encode()).hexdigest(),'proposed_sha256':hashlib.sha256(t.encode()).hexdigest()}for p,t in after.items()},indent=2)+'\n')
checks={
 'five_exact_followon_paths':len(after)==5,
 'source_buffer_charged':'bytes:crate::native_web_payload::Buffer' in after[native],
 'source_pool_from_actual_original':'original.body_owner().pool()' in after[windows],
 'reserve_before_real_file_read':after[native].index('pool.allocate(capacity)')<after[native].index('source.bytes.read_once('),
 'enroll_actual_source_before_read':after[native].index('self.sources.push(Source{bytes,mime:String::new()')<after[native].index('source.bytes.read_once('),
 'source_no_read_to_end_vec':'read_to_end(' not in after[native] and 'bytes:Vec<u8>' not in after[native],
 'source_actual_size_verified':'source.bytes.len()!=expected' in after[native],
 'source_failures_keep_actual_owner':'prefix retained' in after[native],
 'decode_destination_before_decode':after[projects].index('pool().allocate(capacity)')<after[projects].index('STANDARD.decode_slice('),
 'blob_bind_borrows_actual_charged_bytes':'hash,bytes.as_ref()])' in after[projects],
 'source_map_shares_owner_not_vec':'BTreeMap::<String,crate::native_web_payload::Payload>' in after[projects],
 'rust_lifetime_brake_removed':'SELECT count(*) FROM local_workspace_operations' not in after[projects],
 'unknown_original_fence_preserved':"kind='native_web_original' AND state IN ('intent','unknown')" in after[projects],
 'no_new_counter_release':'fetch_sub(' not in ''.join(after[p] for p in [native,carrier,windows,projects]),
}
assert all(checks.values()),checks
receipt={'scope':'unapplied finite source composition only','checks':checks,'passed':sum(checks.values()),'compiler_or_runtime_run':False,'ddl_or_dependency_change':False,'memory_or_20MiB_qualified':False,'patch_bytes':len(data),'patch_sha256':hashlib.sha256(data).hexdigest()}
(root/'review.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'passed':receipt['passed'],'patch_bytes':len(data),'patch_sha256':receipt['patch_sha256']}))
