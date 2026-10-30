"""Pure source arithmetic and actual allocation7 in-memory SQL counterexamples.
No Native/application runtime, compiler, disk DB, model, GPU or downloads.
"""
import hashlib,json,runpy,sqlite3,subprocess,base64
from pathlib import Path
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parents[6]
BASE='b4b5c353c702a4439fbdaef15a093819594eb22d'
PREFIX='docs/workstreams/work-ui/native-local-chat/native-web-host/original-proxy/engine-retirement-fbf7'
for path in subprocess.check_output(['git','-C',str(REPO),'ls-tree','-r','--name-only',BASE,'--',PREFIX]).decode().splitlines():
 assert (REPO/path).read_bytes()==subprocess.check_output(['git','-C',str(REPO),'show',BASE+':'+path]),('frozen source drift',path)
prior=ROOT.parent/'engine-retirement-fbf7'/'compose.py';n={'__file__':str(prior),'__name__':'source_audit'}
exec(compile(prior.read_text().rsplit('\npatch=[];manifest=[]\n',1)[0],str(prior),'exec'),n)
sources=n['after'];sha=n['sha'];MiB=1024*1024
attachments=n['native_git']('69b2ee33fe4aea454849945092312ba4f0608c3e').decode()
assert 'pub const MAX_BATCH_BYTES: usize = 8 * 1024 * 1024;' in attachments
assert 'pub const MAX_TEXT_BYTES: usize = 1024 * 1024;' in attachments
web=sources[n['WEB']];wire=sources[n['TRANSPORT']]
materialization=sources['crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_materialization.rs']
assert 'let view:Value=serde_json::from_slice(original.body())' in web
assert 'let body:Value=serde_json::from_slice(effective.bytes())' in web
assert 'bytes:original.body().to_vec()' in materialization
assert 'request.body(effective_body.to_vec()).build()' in wire
assert 'body.try_reserve_exact(LIMIT+1)' in wire
def b64(n):return ((n+2)//3)*4
# This is owned byte/capacity arithmetic at the source-level overlap, NOT RSS.
# No8MiB/20MiB input is generated for these formulas and optimizer savings are
# not assumed as a resource guarantee. JSON framing/allocator overhead excluded.
capacity=[]
for decoded in (8*MiB,20*MiB):
 encoded=b64(decoded)
 capacity.append({'case':'Windows inline identity','decoded_source_bytes':decoded,'base64_bytes':encoded,
  'live_source_buffers':['original raw Vec','identity effective Vec','submit view Value string','dispatch body Value string','reqwest request Vec copy'],
  'copy_count':5,'ack_capacity_bytes':16*MiB+1,'source_level_owned_capacity_floor_bytes':5*encoded+16*MiB+1,
  'actual_rss_measured':False,'within_current_decoded_batch_limit':decoded<=8*MiB})
provenance=[{'decoded_source_bytes':size,'source_vec_bytes':size,'provenance_base64_bytes':b64(size),
 'full_projection_hash_serde_vec_bytes_at_least':b64(size),'source_level_overlap_bytes_at_least':size+2*b64(size)} for size in (8*MiB,20*MiB)]
fixtures=runpy.run_path(str(ROOT.parent/'test_migration7.py'))
fixture,insert=fixtures['fixture'],fixtures['insert_original']
results={}
def acknowledge(db,op,digest,body):
 headers='[["content-type","application/json"]]'
 db.execute('INSERT INTO local_web_original_acknowledgements VALUES(?,?,?,?,?,?,?)',(op,digest,200,headers,hashlib.sha256(body).hexdigest(),body,len(headers.encode())+len(body)+64))
 db.execute("UPDATE local_workspace_operations SET state='committed',result_json=? WHERE id=? AND state='unknown'",('{"admission":"admitted","upstream_id":null,"status":200}',op))
def forget(db,op,digest):
 db.execute('INSERT INTO local_web_original_forget_receipts VALUES(?,?,?)',(op,digest,'forget-'+op))
 for table in ('local_web_original_acknowledgements','local_web_original_sources','local_web_original_payloads'):
  db.execute('DELETE FROM '+table+' WHERE operation_id=?',(op,))
db=fixture()
try:
 encoded=base64.b64encode(b'a'*MiB)
 raw=b'{"text":"x","files":[{"uri":"data:text/plain;base64,'+encoded+b'"}]}'
 ack=b'{"data":{"id":"msg_fixture","sessionID":"ses_original","type":"user","time":{"created":1},"delivery":"steer","payload":{"text":"x","files":[{"data":"'+encoded+b'","mime":"text/plain","source":{"type":"inline"}}]}}}'
 accepted=0;failure=None
 while accepted<20:
  op='rich-'+str(accepted)
  try:
   digest=insert(db,op,op,raw)
   db.execute("UPDATE local_workspace_operations SET state='unknown' WHERE id=?",(op,))
   acknowledge(db,op,digest,ack);db.commit();accepted+=1
  except sqlite3.IntegrityError as error:db.rollback();failure=str(error);break
 assert accepted>0 and accepted<20 and failure
 payloads=db.execute('SELECT count(*) FROM local_web_original_payloads').fetchone()[0]
 terminals=db.execute("SELECT count(*) FROM local_workspace_operations WHERE state='committed'").fetchone()[0]
 assert payloads==terminals==accepted
 charged=db.execute('SELECT COALESCE(sum(k.retained_bytes+a.retained_bytes),0) FROM local_web_original_keys k JOIN local_web_original_payloads p ON p.operation_id=k.operation_id JOIN local_web_original_acknowledgements a ON a.operation_id=k.operation_id').fetchone()[0]
 results['terminal_history_quota']={'terminal_rows':accepted,'active_effects_in_fixture':0,'rejected_next_original':True,'actual_trigger_error':failure,
  'charged_historical_bytes':charged,'raw_body_bytes_each':len(raw),'ack_body_bytes_each':len(ack),'all_history_preserved':True,
  'scope':'actual frozen7 SQL only; simulated completed publications, NOT native auth/engine acceptance'}
finally:db.close()
db=fixture()
try:
 for i in range(4096):
  op='closed-'+str(i);raw=json.dumps({'id':'msg_'+str(i),'text':'x'}).encode()
  digest=insert(db,op,op,raw)
  db.execute("UPDATE local_workspace_operations SET state='unknown' WHERE id=?",(op,))
  ack=json.dumps({'data':{'id':'msg_'+str(i),'sessionID':'ses_original','type':'user','time':{'created':1},'delivery':'steer','payload':{'text':'x'}}}).encode()
  acknowledge(db,op,digest,ack);forget(db,op,digest);db.commit()
 assert db.execute('SELECT count(*) FROM local_web_original_payloads').fetchone()[0]==0
 assert db.execute('SELECT count(*) FROM local_web_original_keys').fetchone()[0]==4096
 try:insert(db,'next','next',b'{"text":"x"}');db.commit()
 except sqlite3.IntegrityError as error:db.rollback();failure=str(error)
 else:raise AssertionError('lifetime keys unexpectedly accepted4097')
 results['lifetime_identity_cap']={'closed_explicitly_forgotten_rows':4096,'remaining_payload_rows':0,'remaining_keys':4096,
  'rejected4097':True,'actual_trigger_error':failure,'scope':'actual frozen7 SQL only; no real user data or privacy action'}
finally:db.close()
output={'base':BASE,'scope':'source-level capacity and actual SQLite fixtures; NOT runtime/RSS/20MiB acceptance',
 'current_actual_batch_limit_bytes':8*MiB,'current_actual_text_limit_bytes':MiB,
 'attachments_blob':'69b2ee33fe4aea454849945092312ba4f0608c3e','attachments_sha256':sha(attachments.encode()),
 'inspected_source_sha256':{p:sha(sources[p].encode()) for p in (n['WEB'],n['TRANSPORT'],'crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_materialization.rs',n['env']['STORE'])},
 'owned_capacity_examples':capacity,'provenance_hash_overlap':provenance,'sql_counterexamples':results,
 'schema7_modified':False,'schema8_implemented':False,'runtime_or_models_run':False,
 'cleanup':{'disk_databases':[],'in_memory_fixtures_closed':2,'temporary_files':[],'removed_paths':[],'removed_bytes':0,'no_disk_recovery_claim':True}}
(ROOT/'audit.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps({'sql_counterexamples':results,'source8MiB_inline_owned_capacity_floor':capacity[0]['source_level_owned_capacity_floor_bytes'],'runtime_or_rss_acceptance':False}))
