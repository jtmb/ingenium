"""Lossless per-file SOURCE patch and emitted artifact check; no runtime/build."""
from pathlib import Path
import difflib,hashlib,json,os,re,subprocess,sys
here=Path(__file__).resolve().parent
root=Path(os.environ['VEYRA_DOT_PROPOSAL_SOURCE_ROOT'])
sha=lambda b:hashlib.sha256(b).hexdigest()
source_map={
 'services/ingenium-api/lib/dot-v2/candidate-original-manager.mjs':'candidate-original-manager.proposal.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-original-manager.d.mts':'candidate-original-manager.d.mts',
 'services/ingenium-api/lib/dot-v2/candidate-carrier.mjs':'candidate-carrier-readiness.proposal.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-carrier.d.mts':'candidate-carrier-readiness.d.mts',
 'services/ingenium-api/lib/dot-v2/candidate-loopback.mjs':'candidate-loopback-readiness.proposal.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-loopback.d.mts':'candidate-loopback-readiness.d.mts',
 'services/ingenium-api/lib/dot-v2/candidate-bootstrap-runtime.mjs':'candidate-bootstrap-readiness.proposal.mjs',
 'services/ingenium-api/scripts/runtime-manager.ts':'runtime-manager-candidate-waiting.proposal.ts',
 'scripts/runtime-entrypoint.sh':'runtime-entrypoint-candidate.proposal.sh',
}
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
post={name:(here/file).read_bytes()for name,file in source_map.items()}
file=here/'candidate-original-manager.patch';manifest=here/'candidate-original-manager-preimages.json'
if '--check-only'in sys.argv:
 rows=json.loads(manifest.read_text());diff=sections(file.read_bytes());assert set(diff)==set(post)
 pre={name:apply(value,diff[name],True)for name,value in post.items()}
 for row in rows:assert sha(pre[row['target']])==row['preimageSha256'];assert sha(post[row['target']])==row['postimageSha256']
else:
 pre={name:(root/name).read_bytes()if(root/name).is_file()else b''for name in post};patch=''
 for name,value in post.items():
  patch+='diff --git a/'+name+' b/'+name+'\n'
  if not pre[name]:patch+='new file mode 100644\n'
  for line in difflib.unified_diff(pre[name].decode().splitlines(True),value.decode().splitlines(True),fromfile='a/'+name if pre[name]else'/dev/null',tofile='b/'+name):patch+=line if line.endswith('\n')else line+'\n\\ No newline at end of file\n'
 file.write_bytes(patch.encode());rows=[{'target':name,'source':source_map[name],'preimageSha256':sha(pre[name]),'postimageSha256':sha(value),'bytes':len(value)}for name,value in post.items()];manifest.write_text(json.dumps(rows,indent=2)+'\n');diff=sections(file.read_bytes())
emitted={name:apply(pre[name],diff[name])for name in post};assert emitted==post
code="""import{SourceTextModule}from'node:vm';import{stripTypeScriptTypes}from'node:module';let input='';for await(const chunk of process.stdin)input+=chunk;let js=0,types=0;for(const[name,source]of Object.entries(JSON.parse(input))){if(name.endsWith('.mjs')){new SourceTextModule(source,{identifier:name});js++;}else if(name.endsWith('.ts')){new SourceTextModule(stripTypeScriptTypes(source),{identifier:name});types++;}else if(name.endsWith('.mts')){stripTypeScriptTypes(source);types++;}}console.log(JSON.stringify({js,types,failures:0}));"""
env=os.environ.copy();env['NODE_COMPILE_CACHE']=''
r=subprocess.run(['/home/brajam/.local/bin/node','--experimental-vm-modules','--input-type=module','--eval',code],input=json.dumps({name:value.decode()for name,value in emitted.items()}),text=True,capture_output=True,env=env);assert r.returncode==0,r.stderr
shell=subprocess.run(['/bin/sh','-n'],input=emitted['scripts/runtime-entrypoint.sh'],capture_output=True);assert shell.returncode==0,shell.stderr
actual=subprocess.run(['git','-C',str(root),'apply','--check',str(file)],capture_output=True,text=True)
report={'targets':len(emitted),'patchSha256':sha(file.read_bytes()),'patchBytes':file.stat().st_size,'emitted':json.loads(r.stdout),'shellSyntax':shell.returncode,'actualRootApplyCheck':{'exitCode':actual.returncode,'stderr':actual.stderr},'writes':0 if '--check-only'in sys.argv else 2}
print(json.dumps(report))
