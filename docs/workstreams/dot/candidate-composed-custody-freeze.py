from pathlib import Path
import difflib,hashlib,json,os,re,subprocess,sys
here=Path(__file__).resolve().parent
root=Path(os.environ['VEYRA_DOT_PROPOSAL_SOURCE_ROOT'])
sha=lambda b:hashlib.sha256(b).hexdigest()
def sections(raw):
 lines=raw.decode().splitlines(True);result={};at=0
 while at<len(lines):
  if not lines[at].startswith('--- '):at+=1;continue
  at+=1;assert lines[at].startswith('+++ b/');name=lines[at][6:].strip();at+=1;hunks=[]
  while at<len(lines)and lines[at].startswith('@@ '):
   match=re.match(r'@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@',lines[at]);assert match
   old_start,new_start=int(match[1]),int(match[2]);at+=1;rows=[]
   while at<len(lines)and not lines[at].startswith(('@@ ','--- ','diff --git ')):
    item=lines[at];at+=1;kind,text=item[0],item[1:];assert kind in [' ','-','+']
    if at<len(lines)and lines[at].startswith('\\ No newline'):text=text[:-1];at+=1
    rows.append((kind,text))
   hunks.append((old_start,new_start,rows))
  result[name]=hunks
 return result

def apply(source,hunks,reverse=False):
 lines=source.decode().splitlines(True);at=0;out=[]
 for old_start,new_start,rows in hunks:
  start=max(0,(new_start if reverse else old_start)-1);assert start>=at;out+=lines[at:start];at=start
  for kind,text in rows:
   if reverse:kind={' ':' ','+':'-','-':'+'}[kind]
   if kind in [' ','-']:assert at<len(lines)and lines[at]==text;at+=1
   if kind in [' ','+']:out.append(text)
 out+=lines[at:];return ''.join(out).encode()

def encode(before,after):
 patch=''
 for name in sorted(after):
  old=before.get(name,b'');value=after[name]
  if old==value:continue
  patch+='diff --git a/'+name+' b/'+name+'\n'
  if not old:patch+='new file mode 100644\n'
  for line in difflib.unified_diff(old.decode().splitlines(True),value.decode().splitlines(True),fromfile='a/'+name if old else'/dev/null',tofile='b/'+name):patch+=line if line.endswith('\n')else line+'\n\\ No newline at end of file\n'
 return patch.encode()

receipt=json.loads((here/'candidate-composed.json').read_text());frozen=(here/'candidate-composed-root.patch').read_bytes();assert sha(frozen)=='e1baf7a784819e70b99be6b87906d7e220158e2a85f3543a8cae3c0498f912b0'
diff=sections(frozen);old={r['target']:(here/r['mergedSource']).read_bytes()for r in receipt['targets']}
base={name:apply(value,diff[name],True)for name,value in old.items()}
for row in receipt['targets']:assert sha(old[row['target']])==row['mergedPostimageSha256'];assert sha(base[row['target']])==row['frozenCommonPreimageSha256']
new=dict(old);sources={r['target']:r['mergedSource']for r in receipt['targets']}
for name,source in [('services/ingenium-api/lib/dot-v2/candidate-original-manager.mjs','candidate-composed-custody-owner.proposal.mjs'),('services/ingenium-api/lib/dot-v2/candidate-original-manager.d.mts','candidate-composed-custody-owner.d.mts')]:new[name]=(here/source).read_bytes();sources[name]=source
# Pin the exact permitted hardening: two executable splices and one declaration.
a='services/ingenium-api/lib/dot-v2/candidate-original-manager.mjs'
expected=old[a].decode().replace("schemaVersion:1,domain:'candidate-observation-v1',kind,runId:s.runId","schemaVersion:1,domain:'candidate-observation-v1',kind,custodyId:s.custodyId,runId:s.runId",1).replace("const expected=s.revision,envelope=authenticate(s,'original-candidate-'+stage+'-v1',facts);const v=await core","const expected=s.revision,envelope=authenticate(s,'original-candidate-'+stage+'-v1',facts);must(envelope.observation.custodyId===s.custodyId,'CANDIDATE_CUSTODY_BINDING_CHANGED');const v=await core",1)
assert expected.encode()==new[a]
a='services/ingenium-api/lib/dot-v2/candidate-original-manager.d.mts';assert old[a].decode().replace("domain:'candidate-observation-v1';kind:string;runId:string;","domain:'candidate-observation-v1';kind:string;custodyId:string;runId:string;",1).encode()==new[a]
reports=[]
for name,before in [('delta',old),('root',base)]:
 file=here/('candidate-composed-custody-'+name+'.patch');encoded=encode(before,new)
 if '--check-only'in sys.argv:assert file.read_bytes()==encoded
 else:file.write_bytes(encoded)
 serialized=sections(file.read_bytes());emitted=dict(before)
 for target,hunks in serialized.items():emitted[target]=apply(before[target],hunks)
 assert emitted==new;reports.append({'base':name,'patch':file.name,'targets':len(serialized),'sha256':sha(encoded),'bytes':len(encoded)})
code="""import{SourceTextModule}from'node:vm';import{stripTypeScriptTypes}from'node:module';let input='';for await(const c of process.stdin)input+=c;let js=0,types=0;for(const[n,s]of Object.entries(JSON.parse(input))){if(n.endsWith('.mjs')){new SourceTextModule(s,{identifier:n});js++;}else if(n.endsWith('.ts')){new SourceTextModule(stripTypeScriptTypes(s),{identifier:n});types++;}else if(n.endsWith('.mts')){stripTypeScriptTypes(s);types++;}}console.log(JSON.stringify({js,types,failures:0}));"""
env=os.environ.copy();env['NODE_COMPILE_CACHE']='';run=subprocess.run(['/home/brajam/.local/bin/node','--experimental-vm-modules','--input-type=module','--eval',code],input=json.dumps({n:v.decode()for n,v in new.items()}),text=True,capture_output=True,env=env);assert run.returncode==0,run.stderr
shell=subprocess.run(['/bin/sh','-n'],input=new['scripts/runtime-entrypoint.sh'],capture_output=True);assert shell.returncode==0,shell.stderr
check=subprocess.run(['git','-C',str(root),'apply','--check',str(here/'candidate-composed-custody-root.patch')],capture_output=True,text=True)
rows=[]
for name,value in sorted(new.items()):
 actual=(root/name).read_bytes()if(root/name).is_file()else b''
 rows.append({'target':name,'source':sources[name],'originalRootPreimageSha256':sha(base[name]),'currentRootPreimageSha256':sha(actual),'currentRootPreimageExists':(root/name).is_file(),'priorComposedPostimageSha256':sha(old[name]),'hardenedPostimageSha256':sha(value),'bytes':len(value)})
report={'sourceOnly':True,'runtimeCasesRun':0,'priorComposedCommit':'6edde3a32696bc2e34d1e6a4f6d580af2dadf990','priorComposedRootPatchSha256':sha(frozen),'frozenWaitingCommit':'597cf298fe5711dcee0d00aa2be1f9f4dc0e4209','frozenFiniteCommit':'3c0e7016dd26218cd81cfcda328d53aa0e6633cd','patches':reports,'targets':rows,'emitted':json.loads(run.stdout),'shellSyntax':shell.returncode,'actualRootApplyCheck':{'exitCode':check.returncode,'stderr':check.stderr},'writes':0 if '--check-only'in sys.argv else 3}
if '--check-only'not in sys.argv:(here/'candidate-composed-custody.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items()if k!='targets'}))
