"""Lossless source freeze: no global replacements; verify emitted artifacts, not inputs.
Run with VEYRA_DOT_PROPOSAL_SOURCE_ROOT and existing Node installed. No shared writes.
"""
from pathlib import Path
import os,sys,json,hashlib,subprocess,difflib,re
here=Path(__file__).resolve().parent
root=Path(os.environ['VEYRA_DOT_PROPOSAL_SOURCE_ROOT']).resolve()
prior=json.loads((here/'candidate-waiting-bootstrap.json').read_text())
sha=lambda value:hashlib.sha256(value).hexdigest()
old_patch=(here/'candidate-waiting-bootstrap.patch').read_bytes()
assert sha(old_patch)==prior['patchSha256']=='4bc26ae03d291aeb71ac367c81a68a163644d7173ea2ed71ec3c8e5ee261f180'
pre={}
for target in prior['targets']:
 name=target['target']
 if target['preimageSha256'] is None:pre[name]=b''
 else:
  result=subprocess.run(['git','show',prior['rootHeadObserved']+':'+name],cwd=root,capture_output=True,check=True)
  assert sha(result.stdout)==target['preimageSha256'],name
  pre[name]=result.stdout

def emitted_postimages(patch,preimages):
 lines=patch.decode('utf8').splitlines(True);at=0;out={}
 while at<len(lines):
  if not lines[at].startswith('--- '):at+=1;continue
  assert lines[at+1].startswith('+++ b/');name=lines[at+1][6:].strip();assert name in preimages and name not in out,name
  before=preimages[name].decode('utf8').splitlines(True);cursor=0;result=[];at+=2
  while at<len(lines) and not lines[at].startswith(('--- ','diff --git ')):
   if not lines[at].startswith('@@ '):at+=1;continue
   begin=max(0,int(re.match(r'@@ -(\d+)',lines[at]).group(1))-1)
   assert begin>=cursor;result+=before[cursor:begin];cursor=begin;at+=1
   while at<len(lines) and not lines[at].startswith(('@@ ','--- ','diff --git ')):
    item=lines[at];at+=1;kind=item[:1];text=item[1:]
    assert kind in [' ','-','+'],(name,item)
    if at<len(lines) and lines[at].startswith('\\ No newline'):assert text.endswith('\n');text=text[:-1];at+=1
    if kind in [' ','-']:assert cursor<len(before) and before[cursor]==text,(name,cursor,item);cursor+=1
    if kind in [' ','+']:result.append(text)
  result+=before[cursor:];out[name]=''.join(result).encode('utf8')
 assert set(out)==set(preimages),(set(preimages)-set(out))
 return out

def syntax(images):
 # Check EXACT emitted reconstructed bytes. MJS goes through JavaScript parser,
 # declarations/TS through strip-only parser; never execute module or resolve imports.
 code=r"""import{SourceTextModule}from'node:vm';import{stripTypeScriptTypes}from'node:module';const values=JSON.parse(process.argv[2]),failures=[];for(const[path,source]of Object.entries(values)){try{if(path.endsWith('.mjs'))new SourceTextModule(source,{identifier:path});else stripTypeScriptTypes(source);}catch(error){failures.push({path,message:error.message.split('\n')[0]});}}console.log(JSON.stringify({artifacts:Object.keys(values).length,failures}));"""
 values={name:value.decode('utf8')for name,value in images.items()}
 env=os.environ.copy();env['NODE_COMPILE_CACHE']=''
 result=subprocess.run(['/home/brajam/.local/bin/node','--experimental-vm-modules','--input-type=module','-',json.dumps(values)],input=code,text=True,capture_output=True,env=env,check=True)
 return json.loads(result.stdout)

# Preserve and positively reproduce the P1: old patch has exactly these invalid
# emitted artifacts even though canonical proposal/manifest bytes are valid.
old_images=emitted_postimages(old_patch,pre)
old_mismatches=[t['target']for t in prior['targets']if sha(old_images[t['target']])!=t['postimageSha256']]
expected_bad=['services/ingenium-api/lib/dot-v2/candidate-carrier.mjs','services/ingenium-api/lib/dot-v2/candidate-loopback.mjs']
assert sorted(old_mismatches)==sorted(expected_bad),old_mismatches
old_syntax=syntax(old_images);assert sorted(f['path']for f in old_syntax['failures'])==sorted(expected_bad),old_syntax

# Old minimal shared diffs are already lossless. For new files, use canonical
# source bytes individually. No declaration string ever touches an MJS artifact.
images={}
for target in prior['targets']:
 name=target['target']
 images[name]=(here/target['source']).read_bytes()if 'source'in target else old_images[name]
 assert sha(images[name])==target['postimageSha256'],name
patch=''
for name,new in images.items():
 old=pre[name];patch+='diff --git a/'+name+' b/'+name+'\n'
 if not old:patch+='new file mode 100644\n'
 for line in difflib.unified_diff(old.decode().splitlines(True),new.decode().splitlines(True),fromfile='a/'+name if old else '/dev/null',tofile='b/'+name):
  patch+=line if line.endswith('\n')else line+'\n\\ No newline at end of file\n'
encoded=patch.encode('utf8');reconstructed=emitted_postimages(encoded,pre)
assert reconstructed==images
new_syntax=syntax(reconstructed);assert not new_syntax['failures'],new_syntax
report={'kind':'explicit P1 emitted-patch correction r2','priorPatchSha256':sha(old_patch),'priorReceiptSha256':sha((here/'candidate-waiting-bootstrap.json').read_bytes()),'priorBadArtifacts':old_mismatches,'priorSyntax':old_syntax,'correctedPatchSha256':sha(encoded),'correctedPatchBytes':len(encoded),'postimageChecks':len(images),'emittedArtifactSyntax':new_syntax,'targets':[{'target':name,'preimageSha256':sha(pre[name])if pre[name]else None,'postimageSha256':sha(value),'bytes':len(value)}for name,value in images.items()],'limits':'Exact source byte/syntax checks; no builds/import execution/runtime/SQL/manager/readiness/18-case qualification','cleanup':{'disposableOutputs':[],'removedPaths':[],'removedBytes':0,'retained':'Explicit prior failure evidence, lossless corrected patch and checker for Root integration'}}
if '--check-only'not in sys.argv:
 (here/'candidate-waiting-bootstrap-r2.patch').write_bytes(encoded)
 (here/'candidate-waiting-bootstrap-r2.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'priorInvalidArtifacts':len(old_mismatches),'correctedPostimages':len(images),'syntaxFailures':len(new_syntax['failures']),'correctedPatchSha256':sha(encoded),'outputsWritten':0 if '--check-only'in sys.argv else 2}))
