"""Source-only SQL131/owner freeze; --check-only writes nothing."""
from pathlib import Path
import hashlib,json,re,difflib,subprocess,os,sys
here=Path(__file__).resolve().parent
root=Path(os.environ['VEYRA_DOT_PROPOSAL_SOURCE_ROOT']).resolve()
sha=lambda b:hashlib.sha256(b).hexdigest()
source_map={
 'packages/ingenium-core/data/migrations/131_candidate_waiting_lifecycle.sql':'131_candidate_waiting_lifecycle.proposal.sql',
 'services/ingenium-api/lib/dot-v2/candidate-lifecycle-owner.mjs':'candidate-lifecycle-owner.proposal.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-lifecycle-owner.d.mts':'candidate-lifecycle-owner.d.mts',
 'services/ingenium-api/lib/dot-v2/candidate-lifecycle-original-gates.mjs':'candidate-lifecycle-original-gates.proposal.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-lifecycle-original-gates.d.mts':'candidate-lifecycle-original-gates.d.mts',
 'services/ingenium-api/lib/dot-v2/core126-owner.mjs':'core126-lifecycle-owner.proposal.mjs',
 'services/ingenium-api/lib/dot-v2/core126-owner.d.mts':'core126-lifecycle-owner.d.mts'}
post={name:(here/file).read_bytes()for name,file in source_map.items()}
manifest=[json.loads((here/file).read_text())for file in ['candidate-lifecycle-core-preimage.json','candidate-lifecycle-declaration-preimage.json']]
def sections(patch):
 lines=patch.decode().splitlines(True);at=0;result={}
 while at<len(lines):
  if not lines[at].startswith('--- '):at+=1;continue
  assert lines[at+1].startswith('+++ b/');name=lines[at+1][6:].strip();assert name not in result
  at+=2;hunks=[]
  while at<len(lines)and not lines[at].startswith(('--- ','diff --git ')):
   match=re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@',lines[at])
   if not match:at+=1;continue
   old_start,new_start=int(match[1]),int(match[3]);at+=1;rows=[]
   while at<len(lines)and not lines[at].startswith(('@@ ','--- ','diff --git ')):
    item=lines[at];at+=1;kind,text=item[0],item[1:];assert kind in [' ','-','+'],item
    if at<len(lines)and lines[at].startswith('\\ No newline'):assert text.endswith('\n');text=text[:-1];at+=1
    rows.append((kind,text))
   hunks.append((old_start,new_start,rows))
  result[name]=hunks
 return result

def apply(source,hunks,reverse=False):
 lines=source.decode().splitlines(True);at=0;out=[]
 for old_start,new_start,rows in hunks:
  start=max(0,(new_start if reverse else old_start)-1);assert start>=at
  out+=lines[at:start];at=start
  for kind,text in rows:
   if reverse:kind={' ':' ','+':'-','-':'+'}[kind]
   if kind in [' ','-']:assert at<len(lines)and lines[at]==text,(at,text);at+=1
   if kind in [' ','+']:out.append(text)
 out+=lines[at:];return ''.join(out).encode()


minimal=sections((here/'candidate-lifecycle-core-splice.patch').read_bytes()+(here/'candidate-lifecycle-declarations.patch').read_bytes())
pre={name:b''for name in post}
for row in manifest:
 name=row['target'];assert sha(post[name])==row['postimageSha256'];pre[name]=apply(post[name],minimal[name],True);assert sha(pre[name])==row['preimageSha256']
patch=''
for name,value in post.items():
 patch+='diff --git a/'+name+' b/'+name+'\n'
 if not pre[name]:patch+='new file mode 100644\n'
 for line in difflib.unified_diff(pre[name].decode().splitlines(True),value.decode().splitlines(True),fromfile='a/'+name if pre[name]else'/dev/null',tofile='b/'+name):patch+=line if line.endswith('\n')else line+'\n\\ No newline at end of file\n'
file=here/'candidate-lifecycle-sql131.patch';encoded=patch.encode()
if '--check-only'in sys.argv:assert file.read_bytes()==encoded
else:file.write_bytes(encoded)
diff=sections(file.read_bytes());assert set(diff)==set(post)
artifacts={name:apply(pre[name],diff[name])for name in post};assert artifacts==post
# Feed source payload over stdin, not one potentially oversized argv item.
code=r"""import{readFileSync}from'node:fs';import{SourceTextModule}from'node:vm';import{stripTypeScriptTypes}from'node:module';import{DatabaseSync}from'node:sqlite';let input='';for await(const chunk of process.stdin)input+=chunk;const{root,artifacts}=JSON.parse(input);let js=0,types=0,sql=0;for(const[path,source]of Object.entries(artifacts)){if(path.endsWith('.mjs')){new SourceTextModule(source,{identifier:path});js++;}else if(path.endsWith('.sql')){const db=new DatabaseSync(':memory:');try{db.exec('PRAGMA foreign_keys=ON;CREATE TABLE service_principals(id TEXT PRIMARY KEY);CREATE TABLE job_runs(id TEXT PRIMARY KEY,job_id TEXT,project_id TEXT,organization_id TEXT,effective_service_principal_id TEXT,job_revision INTEGER,schedule_revision INTEGER,authorization_revision INTEGER,trigger TEXT,scheduled_for TEXT,created_at TEXT,status TEXT,finished_at TEXT);CREATE TABLE veyra_dot_records(kind TEXT,id TEXT,organization_id TEXT,owner_user_id TEXT,scope_key TEXT,revision INTEGER,body TEXT,PRIMARY KEY(kind,id));');for(const file of['126_managed_job_execution.sql','129_managed_candidate_purpose.sql','130_dot_original_dispatch_fence.sql'])db.exec(readFileSync(root+'/packages/ingenium-core/data/migrations/'+file,'utf8'));db.exec(source);if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('SQL131 foreign key check failed');sql++;}finally{db.close();}}else{stripTypeScriptTypes(source);types++;}}console.log(JSON.stringify({artifacts:Object.keys(artifacts).length,js,types,sql,failures:0}));"""
env=os.environ.copy();env['NODE_COMPILE_CACHE']=''
check=subprocess.run(['/home/brajam/.local/bin/node','--experimental-vm-modules','--input-type=module','--eval',code],input=json.dumps({'root':str(root),'artifacts':{name:value.decode()for name,value in artifacts.items()}}),text=True,capture_output=True,env=env)
if check.returncode:print(check.stderr[:2000],file=sys.stderr);raise SystemExit(check.returncode)
parsed=json.loads(check.stdout)
sql=post['packages/ingenium-core/data/migrations/131_candidate_waiting_lifecycle.sql'].decode()
receipt={'kind':'SQL131 immutable original candidate waiting lifecycle SOURCE proposal','patchSha256':sha(encoded),'patchBytes':len(encoded),'emittedArtifactCheck':parsed,'targets':[{'target':name,'source':source_map[name],'preimageSha256':sha(pre[name])if pre[name]else None,'postimageSha256':sha(value),'bytes':len(value)}for name,value in artifacts.items()],'migrationRegistration':{'file':'131_candidate_waiting_lifecycle.sql','tables':['managed_candidate_lifecycle_schema','job_run_candidate_lifecycle'],'addedBaseColumn':'candidate_waiting_protocol','triggers':re.findall(r'CREATE TRIGGER ([a-z0-9_]+)',sql),'foreignKey':'job_run_candidate_lifecycle.run_id -> job_run_managed_execution.run_id ON DELETE RESTRICT, not parent.id'},'closedActualConstructors':['current persisted candidate context/source/placement','original retained control after withdrawal/restart','original create/child/attach/start/readiness','candidate-only credential/frame material issuance','actual candidate result/native verification','original unknown/cancel/physical/no-create retirement'],'sourceOnly':True,'runtimeCasesRun':0,'cleanup':{'removedPaths':[],'removedBytes':0,'disposableOutputs':[],'retained':'Minimal durable SQL/helper/gates/types/patch/source fixtures and Root audit for integration; existing one C-backed WSL root'}}
if '--check-only'not in sys.argv:(here/'candidate-lifecycle-sql131.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'artifacts':len(artifacts),'emittedCheck':parsed,'patchSha256':sha(encoded),'writes':0 if '--check-only'in sys.argv else 2}))
