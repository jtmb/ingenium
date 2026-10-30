"""Preserve original writer identity through actual SQLite close refusal."""
import difflib,hashlib,json,re,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parents[6]
BASE='df0b6eb23a487330d71159cf396cb34d8ba43bdf'
PREFIX='docs/workstreams/work-ui/native-local-chat/native-web-host/original-proxy/fixture-writer-identity-b178'
for path in subprocess.check_output(['git','-C',str(REPO),'ls-tree','-r','--name-only',BASE,'--',PREFIX]).decode().splitlines():
 assert (REPO/path).read_bytes()==subprocess.check_output(['git','-C',str(REPO),'show',BASE+':'+path]),('frozen fixture source drift',path)
prior=ROOT.parent/'fixture-writer-identity-b178'/'compose.py';source=prior.read_text()
# Its loop builds patch and postimages together; remove only final artifact
# writes, retaining exact frozen transformations and their round-trip asserts.
namespace={'__file__':str(prior),'__name__':'frozen_fixture_source'}
exec(compile(source[:source.index("raw=''.join(line[1:]")],str(prior),'exec'),namespace)
before=namespace['after'].copy();after=before.copy();sha=namespace['sha']
CLOSE='crates/adapters/src/projects/close.rs'
TEST='crates/adapters/src/projects/close/tests.rs'
BUSY='crates/adapters/src/projects/test_support/busy.rs'
OID='2364046fb3500453f3bb8c8508dc8ee9e5b9f053'
raw=subprocess.check_output([namespace['GIT'],'-c','safe.directory='+namespace['NATIVE'],'-C',namespace['NATIVE'],'cat-file','blob',OID])
before[CLOSE]=raw.decode();after[CLOSE]=before[CLOSE]
def replace(data,old,new):
 assert data.count(old)==1,old[:100]
 return data.replace(old,new,1)
data=after[CLOSE]
old='Self { connection, local_custody, local_installation_id }'
assert data.count(old)==2
data=data.replace(old,'Self { connection, local_custody, local_installation_id, native_web_writer }')
assert 'NativeWebWriterOriginal::new' not in data
after[CLOSE]=data
data=after[TEST]
data=replace(data,'    original: *mut ffi::sqlite3,','    original: *mut ffi::sqlite3,\n    original_writer:std::sync::Arc<crate::projects::local_web_originals::NativeWebWriterOriginal>,')
data=replace(data,'        let original = unsafe { store.connection.handle() };','        let original = unsafe { store.connection.handle() };\n        let original_writer=store.native_web_writer.clone();')
data=replace(data,'            store: Some(store),\n            original,','            store: Some(store),\n            original,\n            original_writer,')
data=replace(data,'        assert_eq!(unsafe { store.connection.handle() }, self.original);','        assert_eq!(unsafe { store.connection.handle() }, self.original);\n        assert!(std::sync::Arc::ptr_eq(&store.native_web_writer,&self.original_writer),"close refusal must return the same private writer original");')
data=replace(data,'    super::super::validate_schema(&connection, super::super::SCHEMA_VERSION).unwrap();','    connection.execute_batch(include_str!("../0005.sql")).unwrap();\n    super::super::validate_schema(&connection, super::super::SCHEMA_VERSION).unwrap();')
after[TEST]=data
data=after[BUSY]
data=replace(data,'    validate_schema(&connection, SCHEMA_VERSION)?;','    connection.execute_batch(include_str!("../0005.sql"))?;\n    validate_schema(&connection, SCHEMA_VERSION)?;');after[BUSY]=data
patch=[];manifest=[]
for path,post in after.items():
 pre=before[path]
 if pre==post:continue
 patch.extend(difflib.unified_diff(pre.splitlines(True),post.splitlines(True),fromfile='a/'+path,tofile='b/'+path))
 manifest.append({'path':path,'preimage_sha256':sha(pre.encode()),'postimage_sha256':sha(post.encode()),'preimage_blob':OID if path==CLOSE else None,'fixture_predecessor':BASE if path!=CLOSE else None})
raw=''.join(line[1:] if line in (' \n',' \r\n') else line for line in patch).encode()
(ROOT/'store-close-identity.patch').write_bytes(raw)
(ROOT/'manifest.json').write_text(json.dumps({'base_fixture':BASE,'scope':'same original close-refusal identity plus two explicit current-schema test setups; no production migration/activation','patch_bytes':len(raw),'patch_sha256':sha(raw),'files':manifest,'rust_test_run':False},indent=2)+'\n')
print(json.dumps({'files':len(manifest),'patch_bytes':len(raw),'sha256':sha(raw),'rust_test_run':False}))
