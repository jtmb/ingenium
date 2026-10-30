"""Strict exact preimage proposal. Never modifies shared source or its index."""
from pathlib import Path
import argparse,json,hashlib,difflib
parser=argparse.ArgumentParser();parser.add_argument('--native-source-root',required=True);args=parser.parse_args()
owned=Path(__file__).resolve().parent;root=Path(args.native_source_root)
assert root.is_absolute() and root.resolve()==root
manifest=json.loads((owned/'inputs.json').read_text());original={}
for item in manifest['inputs']:
 raw=(root/item['path']).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=item['sha256']:raise RuntimeError('source drift; no fallback: '+item['path'])
 original[item['path']]=raw.decode()
changed=dict(original)
def replace(rel,before,after):
 if changed[rel].count(before)!=1:raise RuntimeError('exact anchor drift: '+rel)
 changed[rel]=changed[rel].replace(before,after,1)
replace('crates/adapters/src/local_execution.rs','use crate::{local_custody::LocalCustody,projects::ProjectStore};','mod web_files;\nuse crate::{local_custody::LocalCustody,projects::ProjectStore};')
replace('crates/adapters/src/opencode/attachments.rs','use super::{Admission, OpenCodeClient, validate_session};','pub mod web_files;\npub use web_files::{resolve_local_web_files,NativeWebFilesOriginal,NativeWebFileReplacement};\nuse super::{Admission, OpenCodeClient, validate_session};')
replace('crates/adapters/src/local_custody/wsl-helper.py',"        if action=='terminal':", "        if action=='web_file_read': return local_web_file_read(current,root,a)\n        if action=='terminal':")
replace('crates/adapters/src/wsl_workspace.rs','const SCRIPT: &str = concat!(include_str!("local_custody/wsl-helper.py"), r#"','const SCRIPT: &str = concat!(include_str!("local_custody/wsl-helper.py"), include_str!("local_custody/web-files.py"), r#"')
patch=[];proof=[]
for rel,before in original.items():
 after=changed[rel]
 if after==before:continue
 proof.append({'path':rel,'baseSha256':hashlib.sha256(before.encode()).hexdigest(),'proposedSha256':hashlib.sha256(after.encode()).hexdigest()})
 patch.extend(difflib.unified_diff(before.splitlines(keepends=True),after.splitlines(keepends=True),fromfile='a/'+rel,tofile='b/'+rel))
raw=''.join(patch);(owned/'integration.patch').write_text(raw)
new=[{'path':str(f.relative_to(owned/'sources')),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted((owned/'sources').rglob('*')) if f.is_file()]
(owned/'proposal.json').write_text(json.dumps({'existingDeltas':proof,'canonicalNewSources':new,'patchSha256':hashlib.sha256(raw.encode()).hexdigest(),'sharedWritten':False,'compiled':False,'runtimeQualified':False,'journalAllocation':'Root allocation7 existing writer only; no worker schema','unsupportedCompatibility':['20MiB upstream parity','application/x-directory directory listing','other binary formats','UNC/network native custody'],'resolver':'opencode::attachments::resolve_local_web_files','rawOriginalPreserved':'Work1 owns exact raw original and URI-only span patch + approved missing basename insertion; no request reserialization'},indent=2)+'\n')
print(json.dumps({'existingDeltas':len(proof),'canonicalNewSources':len(new),'patchBytes':len(raw.encode())}))
