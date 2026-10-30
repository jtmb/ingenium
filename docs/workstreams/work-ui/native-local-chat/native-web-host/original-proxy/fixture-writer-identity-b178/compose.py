"""Exact existing fixture constructor correction. No Native writes or builds."""
import difflib,hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
NATIVE='//wsl.localhost/Ubuntu/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/windows-source'
GIT='/mnt/c/Program Files/Git/cmd/git.exe'
PINS={
 'crates/adapters/src/projects/close/tests.rs':'c55e0702c7264e8978f940271c086982d2408397',
 'crates/adapters/src/projects/saved_metadata_search/tests.rs':'e75f962995d001f78519edbed8180f91837a8b43',
 'crates/adapters/src/projects/presentation/tests.rs':'90677e9b2c1742000a2be46ce28799d68541129b',
 'crates/adapters/src/projects/test_support/busy.rs':'0be3fa9c71da7f909538c88c75286de61ff1e87e',
 'crates/adapters/src/projects/presentation/task_names/tests.rs':'b9a07550cb02aa0df0d2195850cb2820e5bf94cf',
 'crates/adapters/src/projects/presentation/task_names/saved_metadata/tests.rs':'e8197989dc9dc411d716bf402202dc9706509a68',
}
EXPECTED=[1,1,4,1,4,1]
FIELD='native_web_writer: std::sync::Arc::new(crate::projects::local_web_originals::NativeWebWriterOriginal::new())'
PATTERN=r'(\bProjectStore\s*\{)([ \t]*\n[ \t]*|[ \t]+)(?=local_custody\s*:)'
def sha(data):return hashlib.sha256(data).hexdigest()
before={};after={};patch=[];manifest=[]
for (path,oid),expected in zip(PINS.items(),EXPECTED):
 raw=subprocess.check_output([GIT,'-c','safe.directory='+NATIVE,'-C',NATIVE,'cat-file','blob',oid]);text=raw.decode()
 post,count=re.subn(PATTERN,lambda m:m[1]+m[2]+FIELD+','+m[2],text)
 assert count==expected,(path,count,expected)
 # Removing only inserted fields must reproduce the ENTIRE exact source.
 assert re.sub(re.escape(FIELD)+r',([ \t]*\n[ \t]*|[ \t]+)','',post)==text,path
 before[path]=text;after[path]=post
 patch.extend(difflib.unified_diff(text.splitlines(True),post.splitlines(True),fromfile='a/'+path,tofile='b/'+path))
 manifest.append({'path':path,'preimage_blob':oid,'preimage_sha256':sha(raw),'postimage_sha256':sha(post.encode()),'constructors':count})
assert sum(item['constructors'] for item in manifest)==12
raw=''.join(line[1:] if line in (' \n',' \r\n') else line for line in patch).encode()
(ROOT/'fixture-writer-identity.patch').write_bytes(raw)
(ROOT/'manifest.json').write_text(json.dumps({'requires':'492f private ProjectStore writer identity; current b178 source chain','scope':'six existing test/helper sources only; no test assertions/behavior changes; compiler UNRUN','patch_sha256':sha(raw),'patch_bytes':len(raw),'constructors':12,'files':manifest},indent=2)+'\n')
print(json.dumps({'files':len(manifest),'constructors':12,'patch_bytes':len(raw),'sha256':sha(raw),'source_roundtrip':'PASS','compiler_run':False}))
