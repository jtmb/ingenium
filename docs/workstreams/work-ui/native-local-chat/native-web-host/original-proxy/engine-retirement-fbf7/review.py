"""CPU-only source/composition review. Rust/real-TCP fixtures remain UNRUN."""
import ast,hashlib,json,re,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parent
n=runpy.run_path(str(ROOT/'compose.py'));before,after=n['before'],n['after']
passed=[]
def check(value,label):
 assert value,label
 passed.append(label);print('PASS '+label)
rt=after[n['RT']];web=after[n['WEB']];read=after[n['READ']];comp=after[n['COMP']]
tree=after[n['NEW']];closer=after[n['CLOSER']];transport=after[n['TRANSPORT']];svc=after[n['SVC']]
check(rt.count('native_web_original:Arc::new(')==1 and all(after[p].count('native_web_original:Arc::new(')==1 for p in n['PINNED']),'all3 actual engine constructors allocate opaque original')
check('native_engine_original:engine.native_web_original.clone()' in web and 'native_engine_original:lease.native_engine_original.clone()' in web,'lease and original retain actual engine allocation')
check('native_engine_original:engine.native_web_original.clone()' in read and 'Arc::ptr_eq(&self.native_engine_original,original.native_engine_original())' in after[n['HELPER']],'actual Windows read binds original engine allocation')
check('original.native_engine_original.admission_closed()' in web and 'engine.native_web_original.close_admission();' in rt,'stop revokes fresh admission without granting retirement')
check('generation:Arc<NativeWebRegistryOriginal>' in comp and 'Arc::ptr_eq(tree.registry(),&self.generation)' in comp,'retirement census bound same actual registry generation')
capture=tree[tree.index('pub(super) fn capture('):tree.index('#[derive(Clone,Copy,PartialEq,Eq)]')]
check('engine.child.try_wait()' in capture and 'job.is_empty()' in capture and 'engine.native_web_workers.require_all()?' in capture,'tree witness requires real leader/job/worker evidence')
check('monitor_stop' not in capture and 'admission_closed()' not in capture,'revocation flags are not retirement proof')
check('EngineProcess::Direct' in capture and 'engine.environment!=Environment::Windows' in capture,'unqualified backend cannot borrow Windows retirement witness')
check(rt.count('retire_stopped_windows_engine(engine,deadline)?;')==2 and rt.count('engine.finish_isolation_original(deadline)?;\n                self.native_web_completions.retire_stopped_windows_engine')==2,'both genuine stop branches invoke census after actual lifecycle joins')
check('enum JoinState{NeverStarted,Pending,Joined,Failed}' in tree and 'self.state=JoinState::Failed;\n  match handle.join()' in tree,'per-original worker failure precedes real handle consumption')
check('JoinState::NeverStarted|JoinState::Joined=>Ok(())' in tree and 'self.state=JoinState::Failed;Err(RuntimeError::Storage)' in tree,'missing pending/failed handles never become joined')
check(sum(after[p].count('engine.native_web_workers.begin(') for p in [n['RT'],*n['PINNED']])==4,'every actual monitor/event install seals Pending before spawn')
check('WorkerOriginals::new(bootstrap_writer.as_ref())' in rt and all('WorkerOriginals::new(None)' in after[p] for p in n['PINNED']),'bootstrap state derives actual original handle, not later absence')
settle=rt[rt.index('    fn settle_workers('):rt.index('    fn stop_linux(')]
check(all('join_'+role+'(self.'+field+'.take())' in settle for role,field in [('monitor','monitor_thread'),('event','event_thread'),('bootstrap','bootstrap_writer')]) and 'if failed{return Err(RuntimeError::Storage);}' in settle,'Direct/Native worker faults latch and all eligible joins reconcile')
check('failed_real_join_then_stop_retry_stays_failed' in tree and 'bootstrap_io_failure' in tree,'actual JoinHandle panic and bootstrap IO negatives supplied')
check('http:Arc<Client>' in transport and 'let http=Arc::new(http);' in transport,'actual native client owner is tracked, not freely cloned')
check(closer.index('drop(response);drop(request);')<closer.index('Arc::try_unwrap(http)')<closer.index('drop(http);Ok(WorkerResult::Ended)'),'actual Response drops before atomic final native Client unwrap/drop')
check('self.phase=Phase::Pending;let original=self.original.clone();' in closer and 'owner:Mutex::new(Some(owner))' in closer,'actual close capsule retains owners before spawn')
check('self.phase=Phase::Failed;\n  let worker=self.worker.take()' in closer and 'match worker.join()' in closer,'real closer failure seal survives consumed handle and retry')
check('Original transport closer pending; actual handle retained' in closer and 'Original transport close failure is latched' in closer,'pending and failed actual workers retain distinct states')
check('Arc::try_unwrap(http)' in closer and 'Some(OriginalWebPromptRequest{http,request:None,response:None,observation})' in closer,'extra actual Client owner cannot mint final transport end')
check('state.sender_finished=true;' in comp and comp.index('execute_retained();')<comp.index('state.sender_finished=true;'),'actual original sender returned before close eligibility')
check('state.transport_close=Some(RetainedWebTransportClose::retain(actual));' in comp and comp.index('state.transport_close=Some(RetainedWebTransportClose::retain(actual));')<comp.index('.finish_until(deadline);'),'actual slot retains capsule before starting/joining closer')
finish=comp[comp.index(' pub fn finish_transport_originals_until('):comp.index(' pub fn check_empty(')]
check('Arc::ptr_eq(ended.observation(),capsule.observation())' in finish and 'Arc::ptr_eq(&o.observed,ended.observation())' in finish,'transport end belongs same actual observed response')
check('if !state.read_closed{continue;}' in finish and 'p.matches_outcome(o)' in finish and 'if published||never_sent' in finish,'slot retirement needs read end, transport end and durable bytes or genuine never-send')
check('Partial/unknown with no private publication is NOT disposable' in finish,'raw unknown prefix survives read/transport end')
publication=comp[comp.index(' pub fn retain_publication('):comp.index(' /// Called only at the genuine existing OwnedEngine stop boundary.')]
check(publication.index('outcome.joined.is_none()')<publication.index('state.read_close_started=true;'),'missing materialization join does not pretend a close was attempted')
check('state.tree_retired.is_some()||state.read_close_started' in comp and 'state.read_close_started=true;' in comp,'failed read close cannot retry through engine retirement')
check('state.request.is_none()&&state.transport_close.is_none()' in comp,'never-sent cleanup cannot detach a moved closer owner')
check('actual.finish_transport_originals_until(deadline)' in svc and 'if actual.retain_publication(published).is_err(){failed=true;}' in svc,'service attempts transport reconciliation despite separate read/publication refusal')
check('extra_actual_client_owner_cannot_mint_final_closure' in closer and 'actual_outer_worker_panic_then_retry' in closer and 'actual_final_client_and_response_end' in closer,'real TCP and real outer-join negatives supplied without execution claim')
# Reuse ONLY the immutable pure patch interpreter function; do not execute its
# ancestor review (which regenerates that ancestor's files).
source=(ROOT.parent/'windows-join-492f'/'review.py').read_text();module=ast.parse(source)
function=next(node for node in module.body if isinstance(node,ast.FunctionDef) and node.name=='apply_exact')
namespace={'re':re};exec(compile(ast.Module(body=[function],type_ignores=[]),'<frozen pure patch interpreter>','exec'),namespace)
actual=namespace['apply_exact'](before,(ROOT/'windows-engine-retirement.patch').read_text())
manifest=json.loads((ROOT/'manifest.json').read_text())
check(all(hashlib.sha256(actual[f['path']].encode()).hexdigest()==f['postimage_sha256'] for f in manifest['files']),'exact delta reconstructs all12 Native postimages')
check(hashlib.sha256((ROOT.parent/'windows-join-492f'/'windows-read-join.patch').read_bytes()).hexdigest()=='274f020ae1b1ea93d05a58c90b30b83c3c2220956d2893cc4a148b4f59f21d5c','frozen fbf7 artifact unchanged')
ownership=json.loads((ROOT/'reqwest-ownership.json').read_text())
check(ownership['package_checksum']=='eddd3ca559203180a307f12d114c268abf583f59b03cb906fd0b3ff8646c1147' and all(f['archive_exact'] for f in ownership['files']),'all4 inspected sources were exact locked reqwest archive bytes')
(ROOT/'review.json').write_text(json.dumps({'scope':'CPU source/composition checks ONLY','passed':passed,'count':len(passed),'rust_tests_supplied':7,'rust_tests_run':False,'compiler_run':False,'runtime_qualified':False,'activation':False,
 'remaining':['Root semantic and compiler review','real TCP/Windows handle/path/close fault qualification','permitted private persistence of partial/unknown observations','Root allocation8 active/history disposition review and implementation','full20MiB image/skill expansion and bounded replay','remaining host/HTTP/SSE/PTY/native workflow/visual acceptance']},indent=2)+'\n')
print(str(len(passed))+' CPU source/composition checks; Rust/Windows/runtime gates OPEN')
