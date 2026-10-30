from pathlib import Path
import argparse,json,hashlib,difflib
parser=argparse.ArgumentParser();parser.add_argument('--native-source-root',required=True);args=parser.parse_args()
owned=Path(__file__).resolve().parent;root=Path(args.native_source_root)
assert root.is_absolute() and root.resolve()==root
manifest=json.loads((owned/'inputs.json').read_text());rel='crates/adapters/src/opencode/attachments.rs'
entry=next(v for v in manifest['inputs'] if v['path']==rel)
raw=(root/rel).read_bytes();assert hashlib.sha256(raw).hexdigest()==entry['sha256'],'source drift; no fallback'
before=raw.decode();assert before.count('pub mod web_files;')==1
after=before.replace('pub mod web_files;','pub mod web_file_compat;\npub mod web_files;',1)
patch=''.join(difflib.unified_diff(before.splitlines(keepends=True),after.splitlines(keepends=True),fromfile='a/'+rel,tofile='b/'+rel))
(owned/'integration.patch').write_text(patch)
new=[{'path':str(f.relative_to(owned/'sources')),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted((owned/'sources').rglob('*')) if f.is_file()]
(owned/'proposal.json').write_text(json.dumps({'existingDeltas':[{'path':rel,'baseSha256':entry['sha256'],'proposedSha256':hashlib.sha256(after.encode()).hexdigest()}],'canonicalNewSources':new,'patchSha256':hashlib.sha256(patch.encode()).hexdigest(),'activeLimitsChanged':False,'activeResolverChanged':False,'compiled':False,'sharedWritten':False,'activationRequires':['Root allocation7 actual BLOB aggregate and acknowledgment reservation','Coordinated source/wire/WSL/full-memory envelope','Directory materialization and provenance owner','Actual network-root custody owner']},indent=2)+'\n')
print(json.dumps({'existingDeltas':1,'canonicalNewSources':len(new),'activation':False}))
