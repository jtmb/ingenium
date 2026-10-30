from pathlib import Path
import argparse,subprocess,json,hashlib,re
parser=argparse.ArgumentParser();parser.add_argument('--repository',required=True);parser.add_argument('--receipt',required=True);args=parser.parse_args()
owned=Path(__file__).resolve().parent;inputs=json.loads((owned/'inputs.json').read_text());repo=Path(args.repository);assert repo.resolve()==repo
receipt=Path(args.receipt);allowed=Path('/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/coordination/projects')
assert receipt.parent.resolve()==allowed and receipt.name=='native15-composition.json'
prefix='docs/workstreams/work-ui/native-local-chat/native-web-host/original-proxy/'
def gitfile(commit,path):return subprocess.run(['git','show',commit+':'+path],cwd=repo,capture_output=True,check=True).stdout
commit=inputs['work1Commit'];manifest=gitfile(commit,prefix+'native15-manifest.json');assert hashlib.sha256(manifest).hexdigest()==inputs['work1ManifestSha256']
assert hashlib.sha256(gitfile(commit,prefix+'native15-originals.patch')).hexdigest()==inputs['work1PatchSha256']
sources={}
for item in inputs['frozenReviewInputs']:
 raw=gitfile(commit,prefix+'sources/'+item['path']);assert len(raw)==item['bytes'] and hashlib.sha256(raw).hexdigest()==item['sha256'];sources[item['path']]=raw.decode()
findings=[]
rel='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_original.rs';source=sources[rel]
a=source.index('        let sent=engine.client()?.send_original_web_prompt_once');z=source.index('        Ok(LocalWebPromptOutcome{',a)
for marker,reason in [('persist_prompt_records(', 'fallible prompt persistence after actual send and before outcome enrollment'),('self.active_turns.lock()', 'fallible lock after actual response before outcome enrollment'),('lease.revoke();return Err(local_error())','current-scope refusal after real ACK drops unsealed local outcome'),('sent.map_err(', 'transport failure exits without an owned unknown outcome')]:
 at=source.index(marker,a,z);findings.append({'path':rel,'line':source[:at].count('\n')+1,'marker':marker,'finding':reason})
rel='crates/adapters/src/opencode/local_web_transport.rs';source=sources[rel]
for marker,reason in [('response.take(16*1024*1024+1).read_to_end(&mut body).map_err','partial response bytes are local and dropped on read error'),('if body.len()>16*1024*1024{return Err','oversize observed bytes are dropped before a completion owner exists')]:
 at=source.index(marker);findings.append({'path':rel,'line':source[:at].count('\n')+1,'marker':marker,'finding':reason})
rel='apps/service/src/routes/local_workspaces/web_original.rs';source=sources[rel];marker='acknowledge_native_web_prompt(&pending.outcomes[index],&service.instance_id).is_ok()';at=source.index(marker)
findings.append({'path':rel,'line':source[:at].count('\n')+1,'finding':'is_ok/remove after storage publication lacks typed original join and checked handle retirement'})
# Pure exact delta application, no filesystem tree or index mutation.
helper='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_original/windows_read.rs'
base_path='docs/workstreams/projects/native-web-files/retained-windows/sources/'+helper
before=gitfile(inputs['helperBaseCommit'],base_path).decode();assert hashlib.sha256(before.encode()).hexdigest()==inputs['helperPreimageSha256']
patch=(owned/'locked-helper.patch').read_text();assert hashlib.sha256(patch.encode()).hexdigest()==inputs['patchSha256']
old=before.splitlines(keepends=True);out=[];cursor=0;lines=patch.splitlines(keepends=True);i=2
while i<len(lines):
 match=re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@',lines[i]);assert match,lines[i]
 start=int(match[1])-1;out+=old[cursor:start];cursor=start;i+=1
 while i<len(lines) and not lines[i].startswith('@@ '):
  line=lines[i];prefix_char=line[0];content=line[1:]
  if prefix_char in ' -':assert old[cursor]==content;cursor+=1
  if prefix_char in ' +':out.append(content)
  i+=1
out+=old[cursor:];after=''.join(out);canonical=owned.parent/'sources'/helper
assert after==canonical.read_text() and hashlib.sha256(after.encode()).hexdigest()==inputs['helperPostimageSha256']
assert 'self.inspect_local_web_prompt(lease,original,current)' not in after
for name in ['hold_local_windows_web_read_locked','check_local_windows_web_read_locked','visit_local_windows_read_sources_locked']:assert 'pub(super) fn '+name in after
result={'evidenceClass':'exact frozen source/ordering and pure in-memory delta review; NOT Rust execution/runtime','work1Commit':commit,'shaVerifiedSourceCount':len(sources),'findings':findings,'lockedHelperDeltaAppliedExactlyInMemory':True,'sharedWritten':False,'compiled':False,'runtimeQualified':False,'activationReady':False,'cleanup':{'scratchOrFixturePaths':[],'removedPaths':[],'removedBytes':0,'retained':'minimal source/signature/delta review artifacts and this receipt for Root composition','windowsRecoveredBytes':0}}
receipt.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'sourcesVerified':len(sources),'sourceOrderingFindings':len(findings),'exactDelta':True,'activationReady':False}))
