# Fixed helper extension; no subprocess, shell, caller root or path reopen.
import base64, hashlib

def local_web_file_read(root_fd, root, request):
    parts=request.get('parts')
    limit=request.get('limit')
    if (not isinstance(parts,list) or not parts or len(parts)>128
        or type(limit) is not int or not 0<=limit<=8*1024*1024):
        raise ValueError('web file bounds')
    for part in parts:
        if (not isinstance(part,str) or not part or part in ('.','..')
            or len(part.encode('utf8'))>255 or '/' in part or '\\' in part
            or any(ord(c)<32 or ord(c)==127 for c in part)):
            raise ValueError('web file component')
    held=[]
    root_stat=os.fstat(root_fd)
    def mount_id(fd):
        with open('/proc/self/fdinfo/'+str(fd),encoding='ascii') as info:
            values=[line.split(':',1)[1].strip() for line in info if line.startswith('mnt_id:')]
        if len(values)!=1 or not values[0].isdigit(): raise ValueError('web mount identity')
        return int(values[0])
    root_mount=mount_id(root_fd)
    current=root_fd
    try:
        for part in parts[:-1]:
            current=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=current)
            held.append(current)
            observed=os.fstat(current)
            if observed.st_dev!=root_stat.st_dev or observed.st_uid!=os.geteuid() or mount_id(current)!=root_mount:
                raise ValueError('web ancestor custody')
        current=os.open(parts[-1],os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC,dir_fd=current)
        held.append(current)
        before=os.fstat(current)
        if (not stat.S_ISREG(before.st_mode) or before.st_nlink!=1
            or before.st_dev!=root_stat.st_dev or before.st_uid!=os.geteuid() or mount_id(current)!=root_mount
            or before.st_size>limit):
            raise ValueError('web file custody or size')
        chunks=[];count=0
        while True:
            chunk=os.read(current,min(65536,limit+1-count))
            if not chunk: break
            count+=len(chunk)
            if count>limit: raise ValueError('web file size changed')
            chunks.append(chunk)
        after=os.fstat(current)
        signature=lambda m:(m.st_dev,m.st_ino,m.st_nlink,m.st_uid,m.st_size,m.st_mtime_ns,m.st_ctime_ns)
        if signature(before)!=signature(after) or count!=after.st_size:
            raise ValueError('web file changed while captured')
        data=b''.join(chunks)
        return {'kind':'same-environment-web-file-capture-v1',
          'parts':parts,'size':count,'sha256':hashlib.sha256(data).hexdigest(),
          'bytes_base64':base64.b64encode(data).decode('ascii'),
          'identity':{'device':after.st_dev,'mount_id':root_mount,'inode':after.st_ino,'uid':after.st_uid,
            'mtime_ns':after.st_mtime_ns,'ctime_ns':after.st_ctime_ns}}
    finally:
        for fd in reversed(held): os.close(fd)
