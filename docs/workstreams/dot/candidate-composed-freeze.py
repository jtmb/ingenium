"""Compose two frozen SOURCE proposals losslessly; owned docs only, no runtime."""
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

waiting=json.loads((here/'candidate-original-manager-preimages.json').read_text())
finite=json.loads((here/'candidate-finite-program.json').read_text())['targets']
chain=[{'name':'waiting','commit':'597cf298fe5711dcee0d00aa2be1f9f4dc0e4209','patch':'candidate-original-manager.patch','patchSha256':'44166230a52b9760a9f3b8073810ae9a026e2a04716e2ebd43677c8b7b907610','rows':waiting},{'name':'finite','commit':'3c0e7016dd26218cd81cfcda328d53aa0e6633cd','patch':'candidate-finite-program.patch','patchSha256':'10897bb951e72f3ed0961614b03d62505c29e7490449beb49b310e1e8001df3e','rows':finite}]
posts={};pres={}
for c in chain:
 patch=(here/c['patch']).read_bytes();assert sha(patch)==c['patchSha256'];diff=sections(patch)
 post={r['target']:(here/r['source']).read_bytes()for r in c['rows']};assert set(post)==set(diff)
 pre={name:apply(value,diff[name],True)for name,value in post.items()}
 for r in c['rows']:
  name=r['target'];assert sha(post[name])==r['postimageSha256'];assert sha(pre[name])==(r['preimageSha256']or sha(b''));assert apply(pre[name],diff[name])==post[name]
 posts[c['name']]=post;pres[c['name']]=pre
w,f=posts['waiting'],posts['finite'];overlap=set(w)&set(f);assert len(overlap)==3
for name in overlap:assert pres['waiting'][name]==pres['finite'][name]
merged={**w,**f};merged_sources={}
# Three exact byte edits; no formatter, whole-file fallback or generic replacement.
for name in sorted(overlap):
 a,b,base=w[name].decode(),f[name].decode(),pres['waiting'][name].decode()
 if name.endswith('candidate-bootstrap-runtime.mjs'):
  needle=next(line for line in base.splitlines(True)if 'const carrier=createCandidateChildCarrier('in line)
  addition=next(line for line in a.splitlines(True)if 'const carrier=createCandidateChildCarrier('in line)
  assert b.count(needle)==1 and 'observeOriginalReadiness'in addition
  out=b.replace(needle,addition,1);assert out.replace(addition,needle,1)==b
  source='candidate-composed-bootstrap.proposal.mjs'
 elif name.endswith('candidate-loopback.mjs'):
  at=a.index('currentObservation(){');end=a.index('activate(capability){',at);addition=a[at:end]
  assert a.replace(addition,'',1)==base and b.count('activate(capability){')==1
  out=b.replace('activate(capability){',addition+'activate(capability){',1);assert out.replace(addition,'',1)==b
  source='candidate-composed-loopback.proposal.mjs'
 else:
  addition='currentObservation():Readonly<CandidateLocalObservation>;'
  assert a.count(addition)==1 and a.replace(addition,'',1)==base and b.count('activate(capability:string)')==1
  out=b.replace('activate(capability:string)',addition+'activate(capability:string)',1);assert out.replace(addition,'',1)==b
  source='candidate-composed-loopback.d.mts'
 merged[name]=out.encode();merged_sources[name]=source
 # Independent character-range three-way merge from identical frozen preimage.
 def edits(post):return[(i,j,post[x:y])for tag,i,j,x,y in difflib.SequenceMatcher(None,base,post,autojunk=False).get_opcodes()if tag!='equal']
 left,right=edits(a),edits(b)
 for i,j,_ in left:
  for x,y,_ in right:assert not(max(i,x)<min(j,y)or(i==j and x<=i<y)or(x==y and i<=x<j)or(i==j==x==y)),(name,'overlapping changed byte range',i,j,x,y)
 cursor=0;parts=[]
 for start,end,value in sorted(left+right):assert start>=cursor;parts+=[base[cursor:start],value];cursor=end
 parts.append(base[cursor:]);assert ''.join(parts)==out,(name,'three-way projection mismatch')
 if '--check-only'in sys.argv:assert(here/source).read_bytes()==merged[name]
 else:(here/source).write_bytes(merged[name])
base={**pres['waiting'],**pres['finite']}
assert len(merged)==11
source_map={r['target']:r['source']for c in chain for r in c['rows']};source_map.update(merged_sources)

def encode(before,after):
 patch=''
 for name in sorted(after):
  old=before.get(name,b'');value=after[name]
  if old==value:continue
  patch+='diff --git a/'+name+' b/'+name+'\n'
  if not old:patch+='new file mode 100644\n'
  for line in difflib.unified_diff(old.decode().splitlines(True),value.decode().splitlines(True),fromfile='a/'+name if old else'/dev/null',tofile='b/'+name):patch+=line if line.endswith('\n')else line+'\n\\ No newline at end of file\n'
 return patch.encode()
reports=[]
for name,before in [('root',base),('after-waiting',{**base,**w}),('after-finite',{**base,**f})]:
 patch=encode(before,merged);file=here/('candidate-composed-'+name+'.patch')
 if '--check-only'in sys.argv:assert file.read_bytes()==patch
 else:file.write_bytes(patch)
 diff=sections(file.read_bytes());result=dict(before)
 for target,hunks in diff.items():result[target]=apply(before.get(target,b''),hunks)
 assert result==merged
 reports.append({'base':name,'patch':file.name,'targets':len(diff),'sha256':sha(file.read_bytes()),'bytes':file.stat().st_size})
current=[]
for name,value in sorted(merged.items()):
 actual=(root/name).read_bytes()if(root/name).is_file()else b''
 current.append({'target':name,'rootPreimageExists':(root/name).is_file(),'rootPreimageSha256':sha(actual),'frozenCommonPreimageSha256':sha(base[name]),'matchesFrozenCommonPreimage':actual==base[name],'mergedSource':source_map[name],'mergedPostimageSha256':sha(value),'bytes':len(value),'waitingPreimageSha256':sha(pres['waiting'][name])if name in w else None,'waitingPostimageSha256':sha(w[name])if name in w else None,'finitePreimageSha256':sha(pres['finite'][name])if name in f else None,'finitePostimageSha256':sha(f[name])if name in f else None})
 if '--check-only'not in sys.argv:assert actual==base[name],(name,'Root target drift, no overwrite/rebase authorized')
code="""import{SourceTextModule}from'node:vm';import{stripTypeScriptTypes}from'node:module';let input='';for await(const chunk of process.stdin)input+=chunk;let js=0,types=0;for(const[name,source]of Object.entries(JSON.parse(input))){if(name.endsWith('.mjs')){new SourceTextModule(source,{identifier:name});js++;}else if(name.endsWith('.ts')){new SourceTextModule(stripTypeScriptTypes(source),{identifier:name});types++;}else if(name.endsWith('.mts')){stripTypeScriptTypes(source);types++;}}console.log(JSON.stringify({js,types,failures:0}));"""
env=os.environ.copy();env['NODE_COMPILE_CACHE']=''
r=subprocess.run(['/home/brajam/.local/bin/node','--experimental-vm-modules','--input-type=module','--eval',code],input=json.dumps({name:value.decode()for name,value in merged.items()}),env=env,text=True,capture_output=True);assert r.returncode==0,r.stderr
shell=subprocess.run(['/bin/sh','-n'],input=merged['scripts/runtime-entrypoint.sh'],capture_output=True);assert shell.returncode==0,shell.stderr
check=subprocess.run(['git','-C',str(root),'apply','--check',str(here/'candidate-composed-root.patch')],capture_output=True,text=True)
report={'frozenChains':[{k:v for k,v in c.items()if k!='rows'}for c in chain],'overlapTargets':sorted(overlap),'characterRangeThreeWayMerge':'passed; two independent nonoverlapping frozen edit sets equal explicit composition','artifacts':len(merged),'emitted':json.loads(r.stdout),'shellSyntax':shell.returncode,'patches':reports,'targets':current,'actualRootApplyCheck':{'exitCode':check.returncode,'stderr':check.stderr},'writes':0 if '--check-only'in sys.argv else 7,'sourceOnly':True,'runtimeCasesRun':0}
file=here/'candidate-composed.json'
if '--check-only'not in sys.argv:file.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items()if k not in ['targets','frozenChains']}))
