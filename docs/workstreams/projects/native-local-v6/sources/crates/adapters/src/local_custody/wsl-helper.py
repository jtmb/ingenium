# Prepended to the existing retained selected-user WSL helper.
import os,sys,json,stat,pwd,uuid,subprocess,selectors,signal,time,ctypes
def local_namespace_facts(paths):
    if not isinstance(paths,list) or len(paths)>256: raise ValueError('namespace capacity')
    opened=[];chains=[]
    flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
    try:
        for path in paths:
            if not isinstance(path,str) or not path.startswith('/') or len(path)>4096 or os.path.realpath(path)!=path: raise ValueError('namespace path')
            current=os.open('/',flags);opened.append(current)
            identities=[(os.fstat(current).st_dev,os.fstat(current).st_ino)]
            for part in ([] if path=='/' else path.split('/')[1:]):
                if not part or part in ('.','..'): raise ValueError('namespace component')
                current=os.open(part,flags,dir_fd=current);opened.append(current)
                m=os.fstat(current);identities.append((m.st_dev,m.st_ino))
            chains.append(identities)
        realm=open('/proc/sys/kernel/random/boot_id',encoding='ascii').read().strip()
        if str(uuid.UUID(realm))!=realm: raise ValueError('kernel realm')
        return {'realm':realm,'chains':chains}
    finally:
        for fd in reversed(opened): os.close(fd)
def local_namespace_check(roots,protected=None,protected_facts=None):
    if not isinstance(roots,list) or not roots or len(roots)>128: raise ValueError('namespace capacity')
    candidate=local_namespace_facts(roots)
    snapshots=protected_facts if protected_facts is not None else [local_namespace_facts(protected or [])]
    if not isinstance(snapshots,list) or len(snapshots)>256: raise ValueError('namespace snapshot capacity')
    for snapshot in snapshots:
        if not isinstance(snapshot,dict) or set(snapshot)!={'realm','chains'}: raise ValueError('namespace snapshot shape')
        if not isinstance(snapshot['realm'],str) or str(uuid.UUID(snapshot['realm']))!=snapshot['realm']: raise ValueError('namespace realm')
        if not isinstance(snapshot['chains'],list) or len(snapshot['chains'])>256: raise ValueError('namespace chains')
        for chain in snapshot['chains']:
            if not isinstance(chain,list) or not chain or len(chain)>4097: raise ValueError('namespace chain')
            for identity in chain:
                if not isinstance(identity,(list,tuple)) or len(identity)!=2 or any(type(v) is not int or v<0 for v in identity): raise ValueError('namespace identity')
        if snapshot['realm']!=candidate['realm']: continue # supported private FS is local block storage, never network
        for other in candidate['chains']:
            for private in snapshot['chains']:
                # Metadata from two actual fixed helpers, never a caller principal.
                other=[tuple(v) for v in other];private=[tuple(v) for v in private]
                if other[-1] in private or private[-1] in other: raise ValueError('protected private namespace overlap')
    return {'separated':True}
def local_filesystem_identity(fd):
    # Linux statfs on supported 64-bit WSL; no subprocess, filesystem label or
    # guessed username. FSID survives device-number renumbering after restart.
    if ctypes.sizeof(ctypes.c_void_p)!=8: raise ValueError('unsupported WSL ABI')
    class StatFs(ctypes.Structure):
        _fields_=[('kind',ctypes.c_long),('bsize',ctypes.c_long),
          ('blocks',ctypes.c_ulong),('bfree',ctypes.c_ulong),('bavail',ctypes.c_ulong),
          ('files',ctypes.c_ulong),('ffree',ctypes.c_ulong),('fsid',ctypes.c_int*2),
          ('namelen',ctypes.c_long),('frsize',ctypes.c_long),('flags',ctypes.c_long),('spare',ctypes.c_long*4)]
    value=StatFs();libc=ctypes.CDLL(None,use_errno=True)
    if libc.fstatfs(fd,ctypes.byref(value))!=0: raise ValueError('private FS identity unavailable')
    if value.kind not in (0xEF53,0x9123683e,0x58465342) or tuple(value.fsid)==(0,0):
        raise ValueError('private WSL workdir requires qualified local block filesystem')
    return [value.kind,list(value.fsid)]
def local_private_operation(a):
    if a.get('action')=='namespace_check': return local_namespace_check(a['roots'],protected_facts=a['protected_facts'])
    if a.get('action')=='namespace_paths': return local_namespace_facts(a['roots'])
    installation=str(uuid.UUID(a['installation_id']))
    workspace=str(uuid.UUID(a['workspace_id']))
    if installation!=a['installation_id'] or workspace!=a['workspace_id']: raise ValueError('identity')
    action=a['action']
    home=pwd.getpwuid(os.geteuid()).pw_dir
    if not home.startswith('/') or os.path.realpath(home)!=home: raise ValueError('home custody')
    flags=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
    held=[]
    try:
        current=os.open(home,flags);held.append(current)
        for part in ('.local','state','veyra-private-workspaces',installation):
            if action=='create':
                try: os.mkdir(part,0o700,dir_fd=current)
                except FileExistsError: pass
            current=os.open(part,flags,dir_fd=current);held.append(current)
            m=os.fstat(current)
            forbidden=0o022 if part in ('.local','state') else 0o077
            if m.st_uid!=os.geteuid() or m.st_mode&forbidden: raise ValueError('private ancestor custody')
        if action=='create':
            local_filesystem_identity(current)
            local_namespace_check([os.path.join(home,'.local','state','veyra-private-workspaces',installation)],protected_facts=a.get('exclusions',[]))
            os.mkdir(workspace,0o700,dir_fd=current) # existing is a collision, never adoption
        current=os.open(workspace,flags,dir_fd=current);held.append(current)
        m=os.fstat(current)
        machine=open('/etc/machine-id',encoding='ascii').read().strip()
        if len(machine)!=32 or not all(c in '0123456789abcdef' for c in machine): raise ValueError('machine identity')
        identity={'uid':os.geteuid(),'machine':machine,'filesystem':local_filesystem_identity(current),'inode':m.st_ino}
        if m.st_uid!=os.geteuid() or m.st_mode&0o077: raise ValueError('private root custody')
        if action!='create' and a.get('expected')!=identity: raise ValueError('changed private custody')
        root=os.path.join(home,'.local','state','veyra-private-workspaces',installation,workspace)
        if action=='namespace_snapshot': return local_namespace_facts([root])
        if action in ('create','verify'): return {'root':root,'identity':identity}
        if action=='terminal':
            shells={'bash':('/bin/bash',['-li']),'sh':('/bin/sh',['-i']),
                    'zsh':('/usr/bin/zsh',['-li']),'fish':('/usr/bin/fish',['-li'])}
            executable,argv=shells[a['shell']]
            os.fchdir(current)
            os.execv(executable,[executable]+argv)
        if action!='git': raise ValueError('operation')
        kind=a['operation']
        if kind=='status': argv=['status','--porcelain=v1','-z']
        elif kind=='diff': argv=['diff','--no-ext-diff','--no-textconv']
        elif kind in ('branch','worktree'):
            branch=a['branch']
            if not branch or len(branch)>128 or branch.startswith('-') or '..' in branch or '@{' in branch or any(c.isspace() or ord(c)<32 or c in '~^:?*[\\' for c in branch): raise ValueError('branch')
            if kind=='branch': argv=['switch','-c',branch]
            else:
                name=str(uuid.UUID(a['name']))
                if name!=a['name']: raise ValueError('worktree identity')
                try: os.mkdir('worktrees',0o700,dir_fd=current)
                except FileExistsError: pass
                parent=os.open('worktrees',flags,dir_fd=current);held.append(parent)
                pm=os.fstat(parent)
                if pm.st_uid!=os.geteuid() or pm.st_mode&0o077: raise ValueError('worktree custody')
                try: os.stat(name,dir_fd=parent,follow_symlinks=False)
                except FileNotFoundError: pass
                else: raise ValueError('worktree target exists')
                argv=['worktree','add','-b',branch,os.path.join(root,'worktrees',name)]
        else: raise ValueError('git operation')
        # No shell interpolation, pager, external diff or repository hooks.
        command=['/usr/bin/git','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','--no-pager']+argv
        env={k:v for k,v in os.environ.items() if not k.startswith(('GIT_','GCM_'))}
        env.update(GIT_TERMINAL_PROMPT='0',GCM_INTERACTIVE='never')
        child=subprocess.Popen(command,cwd='/proc/self/fd/'+str(current),stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,start_new_session=True)
        output=bytearray();poll=selectors.DefaultSelector();poll.register(child.stdout,selectors.EVENT_READ)
        deadline=time.monotonic()+3
        try:
            while True:
                if time.monotonic()>=deadline or len(output)>1024*1024: raise ValueError('git result uncertain')
                for key,event in poll.select(0.02):
                    data=os.read(key.fileobj.fileno(),16384)
                    if data: output.extend(data)
                    elif child.poll() is not None: return {'exit_code':child.returncode,'output':output.decode('utf-8','replace')}
        finally:
            poll.close()
            if child.poll() is None:
                os.killpg(child.pid,signal.SIGKILL)
            child.wait()
    finally:
        for fd in reversed(held): os.close(fd)
if len(sys.argv)==3 and sys.argv[1]=='--local-terminal':
    local_private_operation(dict(json.loads(sys.argv[2]),action='terminal'))
