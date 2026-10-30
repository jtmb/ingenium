"""Pure source composition checks; no native/Rust/runtime qualification."""
import hashlib,json,re,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
n=runpy.run_path(str(ROOT/'compose.py'));before,after=n['before'],n['after']
passed=[]
def check(value,name):
 assert value,name
 passed.append(name);print('PASS '+name)
web=after[n['WEB']];comp=after[n['COMP']];carrier=after[n['CARRIER']]
helper=after[n['HELPER']];store=after[n['STORE']];input_source=after[n['INPUT']]
check('hold_local_windows_web_read_locked(&engine,lease,&original,current)' in web and 'hold_local_windows_web_read(lease' not in web,'Windows acquisition uses same engine lock')
check('check_local_windows_web_read_locked(engine,lease,original,read,current)' in web,'actual Windows recheck precedes prepare/send')
check('windows:Option<NativeWindowsWebRead>' in input_source and 'files:NativeWebFileInput' in store,'actual optional read carrier stays in move-only dispatch/slot')
check('identity_windows_web_body(original,w)' in input_source and 'materialize_resolved_web_files(original.body(),s)' in input_source,'Windows identity wire and WSL explicit transform are distinct')
check('bytes:original.body().to_vec()' in after[n['MAT']] and 'read.matches_original(original)' in after[n['MAT']],'raw Windows wire is exact under actual original read')
check('self.held.visit_sources(' in helper and 'self.held.chain_projection()' in helper and 'source_bytes_base64' in helper,'original writer evidence comes from real retained sources')
check('let mut provenance=files.journal_original(&original)' in store and 'source_blob_sha256' in store,'actual source bytes compact into existing BLOB writer')
check(comp.index('state.request=Some(request);')<comp.index('begin_actual_send()')<comp.index('execute_retained();'),'actual request owner retained before read begin and HTTP')
check(comp.index('execute_retained();')<comp.index('verify_materialized_user(original,user)')<comp.index('Some(NativeWebReadJoined{'),'join minted only after actual transport and materialized-file verification')
check('if observed.phase!=WebTransportPhase::Complete' in comp and 'if observed.status!=Some(200)' in comp,'partial transport/generic status cannot mint join')
check('if admission=="admitted"' in comp and '("rejected",None)' in comp,'HTTP rejection does not become a materialized read join')
check('self.input_sha256==original.input_sha256()' in helper and 'output.pointer("/source/uri")' in helper and 'inputs.len()!=outputs.len()' in helper,'materialization binds same original input and every URI occurrence')
check('decoded!=bytes||actual!=mime' in helper and 'STANDARD.encode(&decoded)!=data' in helper,'nonimage/source data and canonical base64 verified')
check('std::ptr::eq(self.held.as_ref(),actual)' in comp and 'published.matches_join(&self.identity,&self.operation,&self.input,&self.body)' in comp,'join binds actual held allocation and same slot/operation/input/body publication')
check('if !joined.matches_carrier(self)||!joined.matches_publication(published)' in carrier and 'state.phase!=Phase::Sending' in carrier,'carrier refuses foreign/copied/duplicate join and publication')
retire=carrier[carrier.index(' pub(crate) fn retire_published('):carrier.index(' pub(crate) fn is_closed(')]
check(retire.index('state.phase=Phase::Closing')<retire.index('state.native.close_once(deadline)?')<retire.index('state.phase=Phase::Closed'),'close fault cannot turn into Closed or authorize retry')
publication=comp[comp.index(' pub fn retain_publication('):comp.index(' pub fn check_empty(')]
check(publication.index('state.published=Some(published)')<publication.index('read.retire_published(')<publication.index('slots.remove(&operation)'),'actual publication retained before checked close and slot removal')
cleanup=comp[comp.index(' pub fn retire_never_sent('):comp.index(' pub fn outcomes(')]
check('Arc::strong_count(slot)!=1' in cleanup and 'state.outcome.is_none()' in cleanup and 'WebTransportPhase::Prepared' in cleanup,'never-sent cleanup excludes active/sent/uncertain slots')
check('retire_never_sent(deadline)' in cleanup and 'slots.remove(&operation)' in cleanup,'eligible inactive original cleanup performs checked close before removal')
check('monitor_stop' not in retire and 'EngineExit' not in retire,'no metadata/PID/stopped-flag engine retirement surrogate')
check('pub fn new' not in comp and 'pub fn new' not in input_source,'no renderer or public positive join/read-owner constructor')
def apply_exact(files,raw):
 files=files.copy();lines=raw.splitlines(True);i=0
 while i<len(lines):
  assert lines[i].startswith('--- ');path=lines[i+1][4:].strip()[2:];i+=2
  source=files.get(path,'').splitlines(True);out=[];cursor=0
  while i<len(lines) and not lines[i].startswith('--- '):
   match=re.match(r'@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@',lines[i]);assert match,lines[i];i+=1
   start=int(match[1]);out.extend(source[cursor:start-1 if start else 0]);cursor=start-1 if start else 0;consumed=0
   while i<len(lines) and not lines[i].startswith(('@@ ','--- ')):
    line=lines[i];i+=1
    if line in ('\n','\r\n'):line=' '+line
    if line.startswith('\\'):continue
    if line[0] in ' -':assert source[cursor]==line[1:],(path,cursor);cursor+=1;consumed+=1
    if line[0] in ' +':out.append(line[1:])
   assert consumed==int(match[2] or 1)
  out.extend(source[cursor:]);files[path]=''.join(out)
 return files
composed=apply_exact(n['env']['after'],(ROOT/'required-web-imports.patch').read_text())
for path in (n['READ'],n['CARRIER'],n['NATIVE']):composed[path]=before[path]
composed=apply_exact(composed,(ROOT/'windows-read-join.patch').read_text())
manifest=json.loads((ROOT/'manifest.json').read_text())
check(all(hashlib.sha256(composed[f['path']].encode()).hexdigest()==f['postimage_sha256'] for f in manifest['files']),'both patch layers reconstruct every exact postimage')
check(hashlib.sha256((ROOT.parent/'followon-094c'/'completion-slots.patch').read_bytes()).hexdigest()=='7c7738308e647c426279d59943901538cff4baf771fe0ba49508089037b75d9e','immutable492f checkpoint unchanged')
check(hashlib.sha256((ROOT.parent/'native15-originals.patch').read_bytes()).hexdigest()=='94e664c8e9aabbb517e1244fdf4514a04acf4ceae955acedff5515c603f77fc7','immutable094c checkpoint unchanged')
(ROOT/'review.json').write_text(json.dumps({'scope':'CPU source-order and exact composition only; not executed Rust/Windows/runtime tests','passed':passed,'count':len(passed),
 'rust_materialization_tests':'supplied3;UNRUN','rust_partial_transport_test':'supplied492f;UNRUN','activation':False,
 'remaining':['Memory3 retention/tombstone integration','Rust compilation/borrow/type checks','real source identity and checked-close qualification','real engine-tree retirement for unknown requests','20MiB/image/skill/ACK bounds','actual HTTP/SSE/PTY/native host runtime and visual acceptance']},indent=2)+'\n')
print(str(len(passed))+' CPU source/composition checks; all runtime gates OPEN')
