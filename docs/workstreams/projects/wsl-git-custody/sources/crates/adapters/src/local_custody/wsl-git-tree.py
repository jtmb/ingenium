# Fixed local Git subreaper. No process-group or serialized-PID authority.
import os,sys,signal,ctypes,selectors,time,json,uuid,stat,base64,errno
_WALL=0x40000000
_LIMIT=65536
_local_git_cancel_requested=False
class LocalGitTree:
    """Retain this object before capture_once. Dedicated single-thread helper."""
    def __init__(self,cwd,executable,arguments,environment):
        self.cwd=cwd;self.executable=executable;self.arguments=arguments;self.environment=environment
        self.originals={};self.pid=None;self.gate=None;self.pipes={};self.fds=set()
        self.buffers={'out':bytearray(),'err':bytearray()};self.truncated={'out':False,'err':False}
        self.leader_status=None;self.dispatched=False;self.stopping=False;self.failed=False
        self.empty=False;self.captured=False;self.capture_started=False;self.reaped=0;self.adopted=0;self.deadline=None
    def _pipe(self):
        pair=os.pipe2(os.O_CLOEXEC);self.fds.update(pair);return pair
    def _close(self,fd):
        if fd in self.fds: os.close(fd);self.fds.remove(fd)
    def capture_once(self):
        if self.captured: raise ValueError('Git original consumed')
        self.captured=True
        if len(os.listdir('/proc/self/task'))!=1: raise ValueError('dedicated single-thread owner required')
        signal.signal(signal.SIGCHLD,signal.SIG_DFL)
        try: os.waitid(os.P_ALL,0,os.WEXITED|os.WNOHANG|os.WNOWAIT|_WALL)
        except ChildProcessError: pass
        else: raise ValueError('unrelated child owner present')
        libc=ctypes.CDLL(None,use_errno=True);value=ctypes.c_int()
        if libc.prctl(36,1,0,0,0)!=0 or libc.prctl(37,ctypes.byref(value),0,0,0)!=0 or value.value!=1:
            raise ValueError('actual subreaper unavailable')
        if not hasattr(os,'pidfd_open') or not hasattr(signal,'pidfd_send_signal') or os.execve not in os.supports_fd:
            raise ValueError('pidfd/fd-exec unavailable')
        probe=os.pidfd_open(os.getpid());self.fds.add(probe)
        signal.pidfd_send_signal(probe,0);self._close(probe)
        # Privilege-changing exec must not make child signal authority disappear.
        if libc.prctl(38,1,0,0,0)!=0: raise ValueError('no-new-privileges unavailable')
        gate_read,gate_write=self._pipe();out_read,out_write=self._pipe();err_read,err_write=self._pipe()
        self.capture_started=True # owner retained even if fork return conversion fails
        pid=os.fork()
        if pid==0:
            try:
                os.dup2(out_write,1);os.dup2(err_write,2)
                null=os.open('/dev/null',os.O_RDONLY|os.O_CLOEXEC);os.dup2(null,0)
                keep={0,1,2,gate_read,self.cwd,self.executable}
                for name in os.listdir('/proc/self/fd'):
                    fd=int(name)
                    if fd not in keep:
                        try: os.close(fd)
                        except OSError as error:
                            if error.errno!=errno.EBADF: raise
                if os.read(gate_read,1)!=b'1': os._exit(125)
                os.close(gate_read);os.fchdir(self.cwd)
                for sig in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP,signal.SIGPIPE): signal.signal(sig,signal.SIG_DFL)
                os.execve(self.executable,self.arguments,self.environment)
            except BaseException: os._exit(126)
        self.pid=pid # original unreaped fork child; never caller-supplied PID
        self.gate=gate_write
        self._close(gate_read);self._close(out_write);self._close(err_write)
        self.pipes={out_read:'out',err_read:'err'}
        for fd in self.pipes: os.set_blocking(fd,False)
        try:
            pidfd=os.pidfd_open(pid);self.fds.add(pidfd);self.originals[pid]=pidfd
        except BaseException:
            # Git has never passed the gate; this exact unreaped original fork
            # child cannot be recycled. No descendant has been allowed to exec.
            os.kill(pid,signal.SIGKILL);self.failed=True;self.stopping=True;raise
    def dispatch_once(self):
        if self.dispatched or self.stopping or self.pid not in self.originals: raise ValueError('Git dispatch refused')
        self.dispatched=True;self.deadline=time.monotonic()+3
        os.write(self.gate,b'1');self._close(self.gate);self.gate=None
    def cancel(self):
        if self.dispatched:self.failed=True
        self.stopping=True
        if self.gate is not None:self._close(self.gate);self.gate=None
    def _reap(self):
        while True:
            try: pid,status=os.waitpid(-1,os.WNOHANG|_WALL)
            except ChildProcessError:self.empty=True;return
            if not pid:return
            if pid==self.pid:self.leader_status=status
            self.reaped=min(self.reaped+1,2**31-1)
            pidfd=self.originals.pop(pid,None)
            if pidfd is not None:self._close(pidfd)
    def _capture_adopted(self):
        # This kernel file enumerates only OUR direct children. No UID/PID/name
        # sweep. None can be recycled until this single-thread owner reaps it.
        with open('/proc/self/task/'+str(os.getpid())+'/children','rb',buffering=0) as file: raw=file.read(65537)
        if len(raw)>65536:raise ValueError('direct-child census capacity')
        for text in raw.split():
            pid=int(text)
            if pid in self.originals:continue
            if len(self.originals)>=256:raise ValueError('retained child capacity')
            pidfd=os.pidfd_open(pid);self.fds.add(pidfd);self.originals[pid]=pidfd
            try:os.waitid(os.P_PIDFD,pidfd,os.WEXITED|os.WNOHANG|os.WNOWAIT|_WALL)
            except BaseException:self.failed=True;raise
            self.adopted=min(self.adopted+1,2**31-1)
    def step(self):
        if _local_git_cancel_requested:self.cancel()
        if self.deadline is not None and time.monotonic()>=self.deadline:self.failed=True;self.cancel()
        for fd,kind in list(self.pipes.items()):
            try:data=os.read(fd,16384)
            except BlockingIOError:continue
            if not data:self._close(fd);del self.pipes[fd];continue
            remain=_LIMIT-len(self.buffers[kind]);self.buffers[kind].extend(data[:max(0,remain)])
            if len(data)>remain:self.truncated[kind]=True
        self._reap()
        if self.stopping and not self.empty:
            self._capture_adopted()
            for pidfd in self.originals.values():
                try:signal.pidfd_send_signal(pidfd,signal.SIGKILL)
                except ProcessLookupError:pass
        return self.empty and not self.pipes and not self.originals
    def drain_originals(self):
        # No elapsed deadline, bridge exit or leader exit can authorize dropping
        # live descendants. Keep this actual subreaper until ECHILD plus pipe EOF.
        self.cancel()
        while self.capture_started:
            try:
                if self.step():break
            except BaseException:self.failed=True
            time.sleep(0.005)
    def close_prepared_fds(self):
        if self.capture_started and not (self.empty and not self.pipes and not self.originals):raise ValueError('original Linux tree remains retained')
        for fd in list(self.fds):self._close(fd)
    def result(self):
        if not(self.empty and not self.pipes and not self.originals):raise ValueError('no final original tree proof')
        return {'tree_empty':True,'pipe_eof':True,'dispatched':self.dispatched,'outcome_unknown':self.failed,
          'exit_code':os.waitstatus_to_exitcode(self.leader_status) if self.leader_status is not None else None,
          'output':bytes(self.buffers['out']).decode('utf-8','replace'),'stderr':bytes(self.buffers['err']).decode('utf-8','replace'),
          'output_base64':base64.b64encode(self.buffers['out']).decode('ascii'),'stderr_base64':base64.b64encode(self.buffers['err']).decode('ascii'),
          'output_complete':not any(self.truncated.values()),'truncated':self.truncated,'reaped_children':self.reaped,'adopted_children':self.adopted}

def local_git_tree(cwd,root,a):
    nonce=a['nonce'];request=a['request_id']
    if len(nonce)!=32 or any(c not in '0123456789abcdef' for c in nonce) or str(uuid.UUID(request))!=request or uuid.UUID(request).int==0:raise ValueError('Git original identity')
    kind=a['operation']
    if kind=='status':argv=['status','--porcelain=v1','-z']
    elif kind=='diff':argv=['diff','--no-ext-diff','--no-textconv']
    elif kind in ('branch','worktree'):
        branch=a['branch']
        if not branch or len(branch)>128 or branch.startswith('-') or '..' in branch or '@{' in branch or any(c.isspace() or ord(c)<32 or c in '~^:?*[\\' for c in branch):raise ValueError('branch')
        if kind=='branch':argv=['switch','-c',branch]
        else:
            name=a['name']
            if str(uuid.UUID(name))!=name or uuid.UUID(name).int==0:raise ValueError('worktree identity')
            try:os.stat(name,dir_fd=cwd,follow_symlinks=False)
            except FileNotFoundError:pass
            else:raise ValueError('worktree target exists; never adopted')
            argv=['worktree','add','-b',branch,name]
    else:raise ValueError('Git operation')
    executable=os.open('/usr/bin/git',os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
    owner=None
    try:
        meta=os.fstat(executable)
        if not stat.S_ISREG(meta.st_mode) or meta.st_uid!=0 or meta.st_mode&0o022:raise ValueError('original Git executable custody')
        env={key:value for key,value in os.environ.items() if not key.upper().startswith(('GIT_','GCM_','OPENCODE_')) and not any(s in key.upper() for s in ('TOKEN','SECRET','API_KEY'))}
        env.update(GIT_TERMINAL_PROMPT='0',GCM_INTERACTIVE='never',GIT_CONFIG_NOSYSTEM='1',GIT_CONFIG_GLOBAL='/dev/null',GIT_OPTIONAL_LOCKS='0')
        arguments=['/usr/bin/git','--git-dir=.git','--work-tree=.','--no-pager','-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-c','core.untrackedCache=false']+argv
        owner=LocalGitTree(cwd,executable,arguments,env) # retained before fork
        try:owner.capture_once()
        except BaseException:
            if owner.capture_started:
                owner.failed=True;owner.drain_originals()
                if owner.dispatched:raise
            owner.close_prepared_fds()
            return {'nonce':nonce,'request_id':request,'tree_empty':True,'pipe_eof':True,'dispatched':False,'outcome_unknown':False,'admission':'not_admitted','reason':'Linux_original_owner_prerequisite_unavailable'}
        prepared={'stage':'prepared','nonce':nonce,'request_id':request,'root_identity':a['expected'],'mechanism':'subreaper_pidfd','gate_closed':True}
        os.write(1,(json.dumps(prepared,separators=(',',':'))+'\n').encode())
        os.set_blocking(0,False);control=bytearray();admission_deadline=time.monotonic()+5
        while True:
            try:
                if not owner.dispatched and time.monotonic()>=admission_deadline:owner.cancel()
                try:data=os.read(0,4096)
                except BlockingIOError:data=None
                if data==b'':owner.cancel()
                elif data:
                    control.extend(data)
                    if len(control)>8192:raise ValueError('control capacity')
                    while b'\n' in control:
                        line,_,rest=control.partition(b'\n');control=bytearray(rest);message=json.loads(line)
                        if message.get('nonce')!=nonce or message.get('request_id')!=request:raise ValueError('control original mismatch')
                        if message.get('command')=='dispatch':owner.dispatch_once()
                        elif message.get('command')=='cancel':owner.cancel()
                        else:raise ValueError('control operation')
                if owner.step():break
            except BaseException:owner.failed=True;owner.cancel()
            time.sleep(0.005)
        result=owner.result();result.update(nonce=nonce,request_id=request,admission='admitted' if owner.dispatched else 'not_admitted')
        return result
    finally:
        if owner is not None:
            if owner.capture_started and not(owner.empty and not owner.pipes and not owner.originals):owner.failed=True;owner.drain_originals()
            owner.close_prepared_fds()
        os.close(executable)

if len(sys.argv)==4 and sys.argv[1]=='--local-git-tree':
    # Nonce/request belong to the original static argv before any payload or
    # fork, so an input-writer failure can prove non-admission without a PID.
    nonce,request=sys.argv[2:]
    if len(nonce)!=32 or any(c not in '0123456789abcdef' for c in nonce) or str(uuid.UUID(request))!=request:sys.exit(2)
    def cancel_signal(signum,frame):
        global _local_git_cancel_requested
        _local_git_cancel_requested=True
    for sig in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):signal.signal(sig,cancel_signal)
    try:
        body=sys.stdin.buffer.readline(65537)
        if not body.endswith(b'\n') or len(body)>65536:raise ValueError('bounded original input')
        original=json.loads(body)
        if original.get('action')!='git_tree' or original.get('nonce')!=nonce or original.get('request_id')!=request:raise ValueError('typed Git original required')
    except BaseException:
        result={'nonce':nonce,'request_id':request,'tree_empty':True,'pipe_eof':True,'dispatched':False,'outcome_unknown':False,'admission':'not_admitted','reason':'original_input_not_admitted'}
    else:
        try:result=local_private_operation(original)
        except BaseException:
            # Missing final proof is unknown, never authority to infer exit.
            sys.exit(2)
    final={'stage':'settled','nonce':nonce,'request_id':request,'result':result}
    raw=(json.dumps(final,separators=(',',':'))+'\n').encode()
    if len(raw)>1048576:sys.exit(3)
    while raw:
        count=os.write(1,raw)
        if count<=0:sys.exit(3)
        raw=raw[count:]
    sys.exit(0)
