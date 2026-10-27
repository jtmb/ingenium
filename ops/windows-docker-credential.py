#!/usr/bin/env python3
"""Docker helper protocol, existing Windows Credential Manager entry, stdout to client only."""
import ctypes, ctypes.wintypes as w, json, sys
class Credential(ctypes.Structure):
    _fields_=[('Flags',w.DWORD),('Type',w.DWORD),('TargetName',w.LPWSTR),('Comment',w.LPWSTR),('LastWritten',w.FILETIME),('CredentialBlobSize',w.DWORD),('CredentialBlob',ctypes.POINTER(ctypes.c_ubyte)),('Persist',w.DWORD),('AttributeCount',w.DWORD),('Attributes',ctypes.c_void_p),('TargetAlias',w.LPWSTR),('UserName',w.LPWSTR)]
def main():
    if sys.platform!='win32' or sys.argv[1:]!=['get']: return 1
    server=sys.stdin.buffer.read(4097).decode('utf-8').strip()
    if server not in ['https://index.docker.io/v1/','registry-1.docker.io','docker.io','index.docker.io']: return 1
    api=ctypes.WinDLL('Advapi32.dll',use_last_error=True);api.CredReadW.argtypes=[w.LPCWSTR,w.DWORD,w.DWORD,ctypes.POINTER(ctypes.POINTER(Credential))];api.CredReadW.restype=w.BOOL;api.CredFree.argtypes=[ctypes.c_void_p]
    ptr=ctypes.POINTER(Credential)()
    if not api.CredReadW('https://index.docker.io/v1/',1,0,ctypes.byref(ptr)): return 1
    try:
        c=ptr.contents
        if c.UserName!='jtmb92' or not 1<=c.CredentialBlobSize<=4096:return 1
        secret=ctypes.string_at(c.CredentialBlob,c.CredentialBlobSize).decode('utf-8')
        sys.stdout.write(json.dumps({'ServerURL':server,'Username':c.UserName,'Secret':secret})+'\n');sys.stdout.flush()
    finally:api.CredFree(ptr)
    return 0
if __name__=='__main__':
    try:sys.exit(main())
    except Exception:sys.exit(1)
