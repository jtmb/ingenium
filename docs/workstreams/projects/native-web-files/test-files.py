"""Inert real Linux FD fixtures for canonical helper; not WSL/Windows acceptance."""
from pathlib import Path
import argparse,os,stat,json,hashlib,base64,time
parser=argparse.ArgumentParser();parser.add_argument('--fixture-root',required=True);parser.add_argument('--receipt',required=True);args=parser.parse_args()
owned=Path(__file__).resolve().parent;root=Path(args.fixture_root);receipt=Path(args.receipt)
allowed=Path('/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/coordination/projects')
assert root.parent.resolve()==allowed and root.name=='native-web-files-fixture' and not root.exists()
assert receipt.parent.resolve()==allowed and receipt.name=='native-web-files.json'
source=owned/'sources/crates/adapters/src/local_custody/web-files.py'
protected={f:hashlib.sha256(f.read_bytes()).hexdigest() for f in [source,owned/'inputs.json',owned/'test-files.py']}
namespace={'os':os,'stat':stat};exec(compile(source.read_text(),str(source),'exec'),namespace)
read=namespace['local_web_file_read'];cases=[];removed=[];failure=None
root.mkdir(mode=0o700);root_identity=(root.stat().st_dev,root.stat().st_ino)
def check(name,run):
 run();cases.append({'name':name,'passed':True})
def refuses(parts,limit=1024):
 try:read(root_fd,str(root),{'parts':parts,'limit':limit})
 except (ValueError,OSError):return
 raise AssertionError('unexpected capture '+repr(parts))
root_fd=None
try:
 (root/'nested').mkdir();(root/'nested/a.txt').write_bytes(b'first\r\nselected\r\nlast\n')
 (root/'outside.txt').write_bytes(b'outside fixture data')
 root_fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 fd_count=lambda:len(os.listdir('/proc/self/fd'))
 baseline=fd_count()
 def exact():
  r=read(root_fd,str(root),{'parts':['nested','a.txt'],'limit':1024});data=(root/'nested/a.txt').read_bytes()
  assert base64.b64decode(r['bytes_base64'])==data and r['sha256']==hashlib.sha256(data).hexdigest()
  assert r['identity']['inode']==(root/'nested/a.txt').stat().st_ino
 check('actual retained fd bytes/hash/identity',exact)
 check('component traversal/absolute/control refused',lambda:[refuses(p) for p in [['..','outside.txt'],['/outside.txt'],['nested','a\\b'],['nested','\x00'],[]]])
 (root/'link').symlink_to('nested',target_is_directory=True)
 (root/'nested/link.txt').symlink_to('../outside.txt')
 check('symlink ancestor and final inode refused',lambda:[refuses(['link','a.txt']),refuses(['nested','link.txt'])])
 os.link(root/'outside.txt',root/'hard.txt')
 check('multiply linked file refused',lambda:refuses(['hard.txt']))
 (root/'large.txt').write_bytes(b'x'*2048)
 check('original size bound refused before read',lambda:refuses(['large.txt'],1024))
 os.mkfifo(root/'pipe')
 check('FIFO refused without blocking',lambda:refuses(['pipe']))
 check('directory never masquerades as file',lambda:refuses(['nested']))
 def swap_after_open():
  actual_open=os.open;swapped=False
  def swap(path,*a,**k):
   nonlocal swapped
   fd=actual_open(path,*a,**k)
   if path=='a.txt' and not swapped:
    swapped=True
    os.rename(root/'nested/a.txt',root/'nested/captured-original.txt')
    (root/'nested/a.txt').write_bytes(b'changed new pathname')
   return fd
  os.open=swap
  try:r=read(root_fd,str(root),{'parts':['nested','a.txt'],'limit':1024})
  finally:os.open=actual_open
  assert base64.b64decode(r['bytes_base64'])==b'first\r\nselected\r\nlast\n'
  assert r['identity']['inode']==(root/'nested/captured-original.txt').stat().st_ino
  assert r['identity']['inode']!=(root/'nested/a.txt').stat().st_ino
 check('replacement after open cannot change captured inode bytes',swap_after_open)
 def mutate_while_read():
  actual_read=os.read;changed=False
  def mutate(fd,count):
   nonlocal changed
   data=actual_read(fd,count)
   if data and not changed:
    changed=True
    with open(root/'nested/a.txt','ab') as f:f.write(b'more')
   return data
  os.read=mutate
  try:refuses(['nested','a.txt'])
  finally:os.read=actual_read
 check('file mutation during capture refused',mutate_while_read)
 check('success/failure paths close all opened descriptors',lambda:(_ for _ in ()).throw(AssertionError('fd leak')) if fd_count()!=baseline else None)
except BaseException as e:
 failure=type(e).__name__+': '+str(e)
finally:
 if root_fd is not None:os.close(root_fd)
 # Checked exclusive new fixture tree only, never shared/source/older output.
 assert root.resolve()==root and root.parent.resolve()==allowed
 assert (root.stat().st_dev,root.stat().st_ino)==root_identity
 for f,digest in protected.items():assert f.exists() and hashlib.sha256(f.read_bytes()).hexdigest()==digest
 assert not (root/'.git').exists()
 mounts=[line.split()[4].replace('\\040',' ') for line in Path('/proc/self/mountinfo').read_text().splitlines()]
 assert not any(v==str(root) or v.startswith(str(root)+'/') for v in mounts)
 active=[]
 for process in Path('/proc').iterdir():
  if not process.name.isdigit():continue
  try:
   if process.stat().st_uid!=os.geteuid():continue
   targets=[process/'cwd',*(process/'fd').iterdir()]
   for target in targets:
    try:value=os.readlink(target)
    except (FileNotFoundError,PermissionError,OSError):continue
    if value==str(root) or value.startswith(str(root)+'/'):active.append(str(target))
  except (FileNotFoundError,PermissionError,ProcessLookupError):continue
 assert not active,active
 entries=sorted(root.rglob('*'),key=lambda p:len(p.parts),reverse=True)
 for target in entries:
  assert target.parent.resolve().is_relative_to(root)
  info=target.lstat();size=info.st_size if not stat.S_ISDIR(info.st_mode) else 0
  removed.append({'path':str(target),'bytes':size})
  if stat.S_ISDIR(info.st_mode):target.rmdir()
  else:target.unlink()
 root.rmdir();removed.append({'path':str(root),'bytes':0})
 result={'passed':len(cases),'failed':int(failure is not None),'failure':failure,'cases':cases,'helperSha256':hashlib.sha256(source.read_bytes()).hexdigest(),
  'evidenceClass':'actual inert Linux current-euid descriptor-relative helper; not Windows/selected-user WSL transport/engine acceptance',
  'cleanup':{'removed':removed,'removedBytes':sum(v['bytes'] for v in removed),'retainedFixtureExceptions':[],'noActiveProcessOrMountReferences':True,'sourcePreserved':True,'regeneration':str(owned/'test-files.py')+' --fixture-root '+str(root)+' --receipt '+str(receipt),'windowsRecoveredBytes':0}}
 receipt.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if failure:raise SystemExit(1)
