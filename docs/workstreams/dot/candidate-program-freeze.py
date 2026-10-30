"""Lossless finite-program proposal freeze; exact serialized patched artifacts checked.
No shared writes/build/runtime. --check-only writes no files.
"""
from pathlib import Path
import hashlib,json,re,difflib,subprocess,os,sys
here=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
manifest=json.loads((here/'candidate-finite-program-preimages.json').read_text())
source_map={
 'services/ingenium-api/lib/dot-v2/candidate-response-program.mjs':'candidate-response-program.proposal.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-response-program.d.mts':'candidate-response-program.d.mts',
 'services/ingenium-api/lib/dot-v2/candidate-loopback.mjs':'candidate-loopback-program.proposal.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-bootstrap-runtime.mjs':'candidate-bootstrap-program.proposal.mjs',
 'services/ingenium-api/lib/dot-v2/candidate-loopback.d.mts':'candidate-loopback-program.d.mts'}
post={name:(here/file).read_bytes()for name,file in source_map.items()}

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

# Recover exact preimages losslessly from canonical postimage + minimal existing
# hunks. No full source snapshots, current-source fallback or normalized EOF.
minimal=sections((here/'candidate-finite-program-integration.patch').read_bytes())
pre={name:b''for name in post}
for row in manifest:
 name=row['target'];assert sha(post[name])==row['postimageSha256'];pre[name]=apply(post[name],minimal[name],True);assert sha(pre[name])==row['preimageSha256'];assert apply(pre[name],minimal[name])==post[name]
patch=''
for name,value in post.items():
 patch+='diff --git a/'+name+' b/'+name+'\n'
 if not pre[name]:patch+='new file mode 100644\n'
 for line in difflib.unified_diff(pre[name].decode().splitlines(True),value.decode().splitlines(True),fromfile='a/'+name if pre[name]else'/dev/null',tofile='b/'+name):patch+=line if line.endswith('\n')else line+'\n\\ No newline at end of file\n'
encoded=patch.encode();destination=here/'candidate-finite-program.patch'
if '--check-only'in sys.argv:assert destination.read_bytes()==encoded
else:destination.write_bytes(encoded)
# Re-read the serialized on-disk patch. Inputs being valid is insufficient.
serialized=destination.read_bytes();diff=sections(serialized);assert set(diff)==set(post)
artifacts={name:apply(pre[name],diff[name])for name in post};assert artifacts==post
for row in manifest:assert sha(artifacts[row['target']])==row['postimageSha256']
code=r"""import{SourceTextModule}from'node:vm';import{stripTypeScriptTypes}from'node:module';const values=JSON.parse(process.argv[2]);for(const[path,source]of Object.entries(values)){if(path.endsWith('.mjs'))new SourceTextModule(source,{identifier:path});else stripTypeScriptTypes(source);}console.log(JSON.stringify({artifacts:Object.keys(values).length,syntaxFailures:0}));"""
env=os.environ.copy();env['NODE_COMPILE_CACHE']=''
syntax=subprocess.run(['/home/brajam/.local/bin/node','--experimental-vm-modules','--input-type=module','-',json.dumps({name:value.decode()for name,value in artifacts.items()})],input=code,text=True,capture_output=True,check=True,env=env)
parsed=json.loads(syntax.stdout)
receipt={'kind':'finite original candidate inert provider source proposal','patchSha256':sha(serialized),'patchBytes':len(serialized),'serializedArtifactChecks':parsed,'targets':[{'target':name,'source':source_map[name],'preimageSha256':sha(pre[name])if pre[name]else None,'postimageSha256':sha(value),'bytes':len(value)}for name,value in artifacts.items()],'sourceOnly':True,'runtimeCasesRun':0,'remaining':['Original Core probeProgram source/case binding and candidate-only projection install/agentHash refresh','Candidate result schema/probeObservation corroboration','Exact closure/copier and strict API/Core checks','Pinned binary/commit relation and real native provider/parser/tool/Core result/CLI verifier/retirement cases','Independent image approval and phases1-7 acceptance'],'cleanup':{'disposableOutputs':[],'removedPaths':[],'removedBytes':0,'retained':'Minimal authored source, lossless delta, tests and source metadata/receipt for Root integration; no upstream tree/package copies'}}
if '--check-only'not in sys.argv:(here/'candidate-finite-program.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'artifacts':len(artifacts),'syntaxFailures':0,'patchSha256':sha(serialized),'writes':0 if '--check-only'in sys.argv else 2}))
