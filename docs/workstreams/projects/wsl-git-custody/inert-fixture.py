"""Actual dedicated-process owner fixtures. No WSL bridge/service/model/workload."""
from pathlib import Path
import argparse,os,json,subprocess,sys,stat,ast,uuid
RUNNER=r'''import os,sys,time,json,stat
from pathlib import Path
source=Path(sys.argv[1]);cwd=Path(sys.argv[2]);case=sys.argv[3]
namespace={'__name__':'closed_original_tree_fixture'}
exec(compile(source.read_text(),str(source),'exec'),namespace)
Tree=namespace['LocalGitTree'];base=len(os.listdir('/proc/self/fd'));results=[]
root=os.open(cwd,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
def run(exe,args,env=None,cancel=False,pre_cancel=False,gate_probe=None,early=False):
 fd=os.open(os.path.realpath(exe),os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 owner=Tree(root,fd,args,dict(os.environ) if env is None else env)
 try:
  owner.capture_once()
  if gate_probe is not None:
   time.sleep(.02);assert not gate_probe.exists(),'exec before dispatch'
  if pre_cancel:owner.cancel()
  else:owner.dispatch_once()
  start=time.monotonic();cancelled=False;early_done=False
  while True:
   if cancel and not cancelled and time.monotonic()-start>.06:owner.cancel();cancelled=True
   done=owner.step()
   if early and not early_done and time.monotonic()-start>.04:
    assert not done,'pipe/leader exit mistaken for full tree';early_done=True
   if done:break
   if time.monotonic()-start>5:raise RuntimeError('fixture original retained beyond bound')
   time.sleep(.005)
  value=owner.result();assert value['tree_empty'] and value['pipe_eof']
  return value
 finally:
  if owner.capture_started and not(owner.empty and not owner.pipes and not owner.originals):owner.drain_originals()
  owner.close_prepared_fds();os.close(fd)
try:
 py=os.path.realpath(sys.executable)
 if case=='gate':
  marker=cwd/'gate-proof';value=run(py,[py,'-B','-c','from pathlib import Path;Path('+repr(str(marker))+').write_text("dispatch")'],gate_probe=marker)
  assert marker.read_text()=='dispatch' and value['exit_code']==0;results.append('gated original pidfd before exec')
 elif case=='setsid_doublefork':
  code='import os,time; p=os.fork();\nif p==0:\n os.setsid(); q=os.fork();\n if q==0: time.sleep(.12);os.write(1,b"detached-owned");os._exit(0)\n os._exit(0)\nos._exit(0)'
  value=run(py,[py,'-B','-c',code.replace(chr(92)+'n',chr(10))]);assert value['reaped_children']>=3 and value['output']=='detached-owned';results.append('setsid double-fork descendants actually reaped')
 elif case=='cancel_escape':
  code='import os,time; p=os.fork();\nif p==0:\n os.setsid(); q=os.fork();\n if q==0: time.sleep(30);os._exit(0)\n os._exit(0)\nos._exit(0)'
  value=run(py,[py,'-B','-c',code.replace(chr(92)+'n',chr(10))],cancel=True);assert value['reaped_children']>=3 and value['adopted_children']>=1;results.append('escaped process group cancelled only by retained direct-child pidfds')
 elif case=='leader_pipe_exit':
  code='import os,time; p=os.fork();\nif p==0: os.setsid();os.close(1);os.close(2);time.sleep(.20);os._exit(0)\nos._exit(0)'
  value=run(py,[py,'-B','-c',code.replace(chr(92)+'n',chr(10))],early=True);assert value['reaped_children']>=2;results.append('leader exit plus pipe EOF insufficient until ECHILD')
 elif case=='output_bound':
  value=run(py,[py,'-B','-c','import os;os.write(1,b"x"*131072)']);assert len(value['output'])==65536 and not value['output_complete'] and value['exit_code']==0;results.append('bounded output drained with explicit truncation')
 elif case=='cancel_before_exec':
  marker=cwd/'must-not-exist';value=run(py,[py,'-B','-c','from pathlib import Path;Path('+repr(str(marker))+').write_text("unsafe")'],pre_cancel=True);assert not marker.exists() and not value['dispatched'];results.append('cancelled gate never executed command')
 elif case=='partial_pidfd':
  fd=os.open(py,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC);owner=Tree(root,fd,[py,'-B','-c','raise RuntimeError("must never exec")'],dict(os.environ))
  actual=os.pidfd_open
  def injected(pid,*args):
   if pid!=os.getpid():raise OSError(24,'fixture pidfd allocation fault')
   return actual(pid,*args)
  try:
   os.pidfd_open=injected
   try:owner.capture_once()
   except OSError:pass
   else:raise AssertionError('injected original pidfd fault not observed')
  finally:
   os.pidfd_open=actual;owner.drain_originals();owner.close_prepared_fds();os.close(fd)
  assert owner.empty and not owner.dispatched;results.append('partial fork/pidfd failure retained and gated original child reaped before any exec')
 elif case=='git_four_operations':
  git='/usr/bin/git';env={key:value for key,value in os.environ.items() if not key.startswith(('GIT_','GCM_'))}
  env.update(GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='/dev/null',GIT_AUTHOR_NAME='closed fixture',GIT_AUTHOR_EMAIL='fixture@invalid',GIT_COMMITTER_NAME='closed fixture',GIT_COMMITTER_EMAIL='fixture@invalid',GIT_AUTHOR_DATE='2001-01-01T00:00:00Z',GIT_COMMITTER_DATE='2001-01-01T00:00:00Z',GIT_TERMINAL_PROMPT='0')
  def operation(args):
   result=run(git,[git,'--no-pager','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null']+args,env)
   assert result['exit_code']==0,result['stderr'];return result
  operation(['init','--quiet']);operation(['commit','--allow-empty','--quiet','-m','closed fixture with no tracked files'])
  (cwd/'untracked-probe').write_text('reproducible inert fixture\n')
  assert 'untracked-probe' in operation(['status','--porcelain=v1','-z'])['output']
  assert operation(['diff','--no-ext-diff','--no-textconv'])['output']==''
  operation(['switch','-c','fixture-branch'])
  operation(['worktree','add','-b','fixture-worktree',str(cwd/'11111111-1111-4111-8111-111111111111')])
  assert operation(['ls-files','-z'])['output']==''
  results.append('actual Git status/diff/branch/worktree under the owner; empty commit and zero tracked files')
 else:raise ValueError(case)
finally:os.close(root)
assert len(os.listdir('/proc/self/fd'))==base,'fixture leaked original descriptors'
print(json.dumps({'case':case,'checks':results,'fdStable':True,'actualLinuxOriginalTreeClosed':True}))
'''
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--scratch-root',required=True);parser.add_argument('--reconcile-existing',action='store_true');args=parser.parse_args()
 root=Path(args.scratch_root).resolve(strict=True)
 if root.name!='projects' or root.parent.name!='coordination':raise RuntimeError('not declared task root')
 fixture=root/'wsl-git-custody-fixture'
 if (fixture.exists() or fixture.is_symlink()) and not args.reconcile_existing:raise RuntimeError('existing fixture protected')
 if args.reconcile_existing and (not fixture.is_dir() or fixture.is_symlink()):raise RuntimeError('original fixture missing or redirected')
 source=Path(__file__).parent/'sources/crates/adapters/src/local_custody/wsl-git-tree.py';ast.parse(source.read_text())
 if not args.reconcile_existing:fixture.mkdir(mode=0o700)
 results=[];removed=[];failed=None
 try:
  for case in ([] if args.reconcile_existing else ['gate','setsid_doublefork','cancel_escape','leader_pipe_exit','output_bound','cancel_before_exec','partial_pidfd','git_four_operations']):
   case_root=fixture/case;case_root.mkdir(mode=0o700)
   env=os.environ.copy();env.update(TMPDIR=str(root),TMP=str(root),TEMP=str(root),PYTHONDONTWRITEBYTECODE='1')
   child=subprocess.run([sys.executable,'-B','-c',RUNNER,str(source),str(case_root),case],capture_output=True,text=True,env=env)
   if child.returncode:raise RuntimeError(case+': '+child.stdout+child.stderr)
   results.append(json.loads(child.stdout))
  if not args.reconcile_existing:
   for dispatch in (True,False):
    case='protocol_dispatch' if dispatch else 'protocol_cancel'
    case_root=fixture/case;case_root.mkdir(mode=0o700)
    # Root acquisition is fixture-local and explicit; this does not qualify
    # the Windows bridge or real selected-user XDG custody.
    shim="import os\ndef local_private_operation(a):\n fd=os.open("+repr(str(case_root))+",os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)\n try:return local_git_tree(fd,"+repr(str(case_root))+",a)\n finally:os.close(fd)\n"
    nonce=uuid.uuid4().hex;request=str(uuid.uuid4())
    child=subprocess.Popen([sys.executable,'-B','-c',shim+source.read_text(),'--local-git-tree',nonce,request],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    initial={'action':'git_tree','nonce':nonce,'request_id':request,'operation':'status','expected':{'fixture_root_only':True}}
    child.stdin.write(json.dumps(initial)+'\n');child.stdin.flush()
    first=json.loads(child.stdout.readline());assert first['stage']=='prepared' and first['gate_closed'] and first['nonce']==nonce
    if dispatch:child.stdin.write(json.dumps({'command':'dispatch','nonce':nonce,'request_id':request})+'\n');child.stdin.flush()
    else:child.stdin.close()
    final=json.loads(child.stdout.readline());assert final['stage']=='settled' and final['result']['tree_empty'] and final['result']['pipe_eof']
    assert final['result']['dispatched']==dispatch
    if dispatch:child.stdin.close()
    assert child.wait()==0,child.stderr.read()
    child.stdout.close();child.stderr.close()
    results.append({'case':case,'checks':['actual production prepared/dispatch or cancel handshake; fixture-local root shim; original child tree and pipes closed'],'fdStable':True,'actualLinuxOriginalTreeClosed':True})
 except BaseException as error:failed=repr(error)
 finally:
  # Every byte under this exclusive root is a reproducible fixture derivative.
  # A real empty commit exercises worktrees with NO tracked files to preserve.
  if fixture.resolve(strict=True).parent!=root:raise RuntimeError('resolved ownership failed')
  text=str(fixture)
  for proc in Path('/proc').iterdir():
   if not proc.name.isdecimal() or int(proc.name)==os.getpid():continue
   try:links=list((proc/'fd').iterdir())+[proc/'cwd',proc/'root']
   except (FileNotFoundError,PermissionError,ProcessLookupError):continue
   for link in links:
    try:target=os.readlink(link)
    except OSError:continue
    if target==text or target.startswith(text+'/'):raise RuntimeError('active original protects fixture '+str(link))
   try:maps=(proc/'maps').read_text()
   except OSError:continue
   if text in maps:raise RuntimeError('active mapped fixture '+str(proc))
  if text in Path('/proc/self/mountinfo').read_text():raise RuntimeError('mounted fixture protected')
  paths=list(fixture.rglob('*'))
  for file in paths:
   if file.is_symlink():raise RuntimeError('unplanned symlink fixture protected '+str(file))
   if not(stat.S_ISDIR(file.lstat().st_mode) or stat.S_ISREG(file.lstat().st_mode)):raise RuntimeError('special fixture protected '+str(file))
  # The Git fixture's index is absent/empty; never remove tracked source.
  # Reconciliation of the original failed size heuristic: Git's empty v2
  # index may contain a TREE extension. Entry count, not total byte length,
  # determines tracked files. Independently checked original ls-files was0.
  import struct,hashlib
  for index in fixture.rglob('index'):
   raw=index.read_bytes()
   if len(raw)<32 or raw[:4]!=b'DIRC' or struct.unpack('>I',raw[4:8])[0] not in (2,3,4) or struct.unpack('>I',raw[8:12])[0]!=0 or hashlib.sha1(raw[:-20]).digest()!=raw[-20:]:
    raise RuntimeError('tracked/malformed index preservation check '+str(index))
  for file in sorted(paths,key=lambda f:len(f.parts),reverse=True):
   size=file.stat().st_size if file.is_file() else 0
   if file.is_dir():file.rmdir()
   else:file.unlink()
   removed.append({'path':str(file),'bytes':size})
  fixture.rmdir();removed.append({'path':str(fixture),'bytes':0})
 receipt={'evidenceClass':'actual-closed-inert-linux-subprocess-fixtures','results':results,'passed':len(results),'failure':failed,'removed':removed,'removedBytes':sum(v['bytes'] for v in removed),'windowsRecoveryClaimed':False,'windowsWSLTransportQualified':False,'servicesModelsOrUserWorkspacesTouched':False}
 (root/('wsl-git-custody-cleanup.json' if args.reconcile_existing else 'wsl-git-custody-fixture.json')).write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps({key:value for key,value in receipt.items() if key!='removed'}))
 if failed:raise RuntimeError(failed)
if __name__=='__main__':main()
