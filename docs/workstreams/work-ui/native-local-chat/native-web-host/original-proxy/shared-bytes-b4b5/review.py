"""Source/exact-byte composition checks only, not compiler/runtime evidence."""
import ast,hashlib,json,re,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
n=runpy.run_path(str(ROOT/'compose.py'));before,after=n['before'],n['after']
passed=[]
def check(value,label):
 assert value,label
 passed.append(label);print('PASS '+label)
web=after[n['WEB']];mat=after[n['MAT']];transport=after[n['TRANSPORT']]
check('body:Arc<[u8]>' in web and 'body:Arc::from(body)' in web,'captured raw bytes have one immutable shared owner')
check('scope["body_bytes"]=json!(self.body.as_ref())' in web,'native JSON projection serializes exact slice without serde Arc feature')
check('bytes:original.body_owner()' in mat and 'bytes:original.body().to_vec()' not in mat,'Windows identity effective body shares exact original allocation')
check('pub(crate) fn bytes_owner(&self)->Arc<[u8]>' in mat and 'effective.bytes_owner())?' in web,'actual prepared request receives same immutable effective owner')
check('Body::sized(std::io::Cursor::new(effective_body),length)' in transport and 'request.body(effective_body.to_vec())' not in transport,'reqwest request streams owned shared bytes instead of full request copy')
check(web.index('drop(view);')<web.index('match reserve(original,effective,files)'),'submit readonly JSON view ends before reserve/dispatch')
dispatch=web[web.index('    fn dispatch_local_web_prompt_locked('):web.index('    pub fn inspect_local_web_prompt(')]
check(dispatch.index('drop(body);')<dispatch.index('prepare_original_web_prompt('),'dispatch readonly JSON view ends before preparing HTTP')
pattern=r'fn input_hash\(.*?^\}'
check(re.search(pattern,before[n['WEB']],re.S|re.M).group()==re.search(pattern,web,re.S|re.M).group(),'complete original input hash framing unchanged')
check('retry(reqwest::retry::never())' in transport and 'redirect(reqwest::redirect::Policy::none())' in transport and '.no_proxy()' in transport,'single-send/private-origin transport policies unchanged')
check('effective_body.len()>LIMIT' in transport and 'const LIMIT:usize=16*1024*1024;' in transport,'existing wire bound unchanged')
check('actual_reader_body_keeps_same_owner_and_exact_wire_bytes' in transport and 'Arc::strong_count(&expected)>=2' in transport,'real TCP exact-byte/actual shared-owner fixture supplied')
check('let mut body=vec![0;length];reader.read_exact(&mut body).unwrap();' in transport,'partial-response fixture drains request before deliberate truncation')
check(all(pre==after[path] for path,pre in before.items() if path not in (n['WEB'],n['MAT'],n['TRANSPORT'],n['CLOSER'])),'all other Native source, auth, schema, quota/history and ownership code unchanged')
old_review=ast.parse((ROOT.parent/'windows-join-492f'/'review.py').read_text())
function=next(f for f in old_review.body if isinstance(f,ast.FunctionDef) and f.name=='apply_exact')
namespace={'re':re};exec(compile(ast.Module(body=[function],type_ignores=[]),'<frozen pure patch interpreter>','exec'),namespace)
actual=namespace['apply_exact'](before,(ROOT/'shared-request-bytes.patch').read_text())
manifest=json.loads((ROOT/'manifest.json').read_text())
check(all(hashlib.sha256(actual[f['path']].encode()).hexdigest()==f['postimage_sha256'] for f in manifest['files']),'exact delta reconstructs all4 source postimages')
body_path=Path('/mnt/f/Veyra-Dock-build/cargo-cache/registry/src/index.crates.io-1949cf8c6b5b557f/reqwest-0.12.28/src/blocking/body.rs')
body=body_path.read_bytes();body_hash=hashlib.sha256(body).hexdigest()
check(body_hash=='578d58f3c661a4c43b771e982bac1dd08a6fedaf98f8baacd096fbe0cad63f7a','actual reader implementation remains exact prior-verified locked source')
text=body.decode()
check('kind: Kind::Reader(Box::from(reader), Some(len))' in text and 'let cap = cmp::min(sender.body.1.unwrap_or(8192), 8192);' in text and '.send(Ok(buf.split().freeze()))' in text,'pinned sized reader uses requested8KiB producer buffer/channel path')
(ROOT/'review.json').write_text(json.dumps({'scope':'CPU source/composition only; no compiler/runtime/RSS claim','passed':passed,'count':len(passed),'new_rust_fixture_supplied':1,'rust_fixture_run':False,
 'reqwest_reader':{'version':'0.12.28','body_rs_sha256':body_hash,'lines':[[80,82],[133,145],[274,351]],'global_HTTP_buffer_bound_proved':False},
 'schema_or_caps_changed':False,'history_pruned':False,'activation':False,
 'remaining':['Root compiler/real TCP review','source/provenance and WSL recompute copies','SQLite full transient BLOB binds','bounded ACK parsing/base64 verification','allocation8 active/history and replay disposition','coherent20MiB/image/skill/total peak qualification']},indent=2)+'\n')
print(str(len(passed))+' source/composition checks; no compiler/runtime/RSS acceptance')
