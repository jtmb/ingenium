"""Closed real-FD metadata fixture. Never invokes private allocation or processes."""
import argparse,ast,json,os,stat,sys,hashlib
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--scratch-root',required=True);args=parser.parse_args()
root=Path(args.scratch_root).resolve(strict=True)
if root.name!='projects' or root.parent.name!='coordination': raise RuntimeError('not the declared task coordination root')
fixture=root/'native-local-v6-namespace-fixture'
if fixture.exists() or fixture.is_symlink(): raise RuntimeError('existing fixture is protected; no adoption')
helper=Path(__file__).parent/'sources/crates/adapters/src/local_custody/wsl-helper.py'
namespace={'__name__':'closed_metadata_fixture'}
exec(compile(ast.parse(helper.read_text()),str(helper),'exec'),namespace)
facts=namespace['local_namespace_facts'];check=namespace['local_namespace_check']
checks=[];created=[];removed=[]
def passed(name,call,deny=False):
    before=len(os.listdir('/proc/self/fd'))
    try: call()
    except (ValueError,OSError,KeyError,TypeError,IndexError):
        if not deny: raise
    else:
        if deny: raise AssertionError('unsafe namespace admitted: '+name)
    if len(os.listdir('/proc/self/fd'))!=before: raise AssertionError('FD leak: '+name)
    checks.append(name)
try:
    fixture.mkdir(mode=0o700);created.append(fixture)
    for relative in ['private','private/child','other']:
        item=fixture/relative;item.mkdir(mode=0o700);created.append(item)
    sentinel=fixture/'sentinel';sentinel.write_bytes(b'closed-fd-fixture\n');created.append(sentinel)
    alias=fixture/'alias';alias.symlink_to(fixture/'private',target_is_directory=True);created.append(alias)
    private=str(fixture/'private');other=str(fixture/'other')
    actual=facts([private])
    passed('disjoint actual FD chains',lambda:check([other],protected_facts=[actual]))
    passed('same physical root refused',lambda:check([private],protected_facts=[actual]),True)
    passed('ancestor refused',lambda:check([str(fixture)],protected_facts=[actual]),True)
    passed('descendant refused',lambda:check([str(fixture/'private/child')],protected_facts=[actual]),True)
    passed('symlink alias refused',lambda:check([str(alias)],protected_facts=[actual]),True)
    passed('missing path refused',lambda:check([str(fixture/'missing')],protected_facts=[actual]),True)
    passed('missing protected realm refused',lambda:check([other],protected_facts=[{'chains':[]}]),True)
    passed('malformed protected identity refused',lambda:check([other],protected_facts=[{'realm':actual['realm'],'chains':[[[1]]]}]),True)
    passed('empty candidate refused',lambda:check([],protected_facts=[actual]),True)
finally:
    # Every fixture object has one known regeneration source: this file. No
    # source, lockfile, original, transcript or unique evidence is inside it.
    expected=set(created)
    actual=set(fixture.rglob('*'))|{fixture} if fixture.exists() else set()
    if actual!=expected: raise RuntimeError('fixture inventory drift; retained '+str(fixture))
    if fixture.resolve(strict=True).parent!=root: raise RuntimeError('resolved ownership failed')
    # Our FD scopes have ended. Refuse another process's open fd/cwd/map or any
    # mount reference rather than stop it. Failure protects the exact fixture.
    text=str(fixture)
    for proc in Path('/proc').iterdir():
        if not proc.name.isdecimal() or int(proc.name)==os.getpid(): continue
        links=[proc/'cwd',proc/'root']
        try: links+=list((proc/'fd').iterdir())
        except (FileNotFoundError,PermissionError): continue
        for link in links:
            try: target=os.readlink(link)
            except (FileNotFoundError,PermissionError,OSError): continue
            if target==text or target.startswith(text+'/'): raise RuntimeError('active reference: '+str(link))
        try: mappings=(proc/'maps').read_text()
        except (FileNotFoundError,PermissionError,ProcessLookupError): continue
        if text in mappings: raise RuntimeError('active map: '+str(proc))
    if text in Path('/proc/self/mountinfo').read_text(): raise RuntimeError('mount reference')
    for item in sorted(created,key=lambda q:len(q.parts),reverse=True):
        m=item.lstat();size=m.st_size if not stat.S_ISDIR(m.st_mode) else 0
        if stat.S_ISDIR(m.st_mode): item.rmdir()
        elif item==sentinel or (item==alias and stat.S_ISLNK(m.st_mode)): item.unlink()
        else: raise RuntimeError('unrecognized fixture object retained: '+str(item))
        removed.append({'path':str(item),'bytes':size})
print(json.dumps({'evidenceClass':'closed-linux-fd-metadata-fixture','checks':checks,'count':len(checks),'removed':removed,'removedBytes':sum(v['bytes'] for v in removed),'windowsDiskRecoveryClaimed':False,'helperEffectsInvoked':False}))
