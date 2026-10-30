"""Read existing locked package/archive only; no download/install/extraction."""
import hashlib,json,tarfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent
CACHE=Path('/mnt/f/Veyra-Dock-build/cargo-cache/registry')
PACKAGE='reqwest-0.12.28';INDEX='index.crates.io-1949cf8c6b5b557f'
ARCHIVE=CACHE/'cache'/INDEX/(PACKAGE+'.crate')
CHECKSUM='eddd3ca559203180a307f12d114c268abf583f59b03cb906fd0b3ff8646c1147'
assert hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()==CHECKSUM
paths={'src/blocking/client.rs':[[1330,1355],[1363,1430],[1434,1467],[1472,1494],[1507,1511]],
 'src/blocking/response.rs':[[23,47],[417,443]],'src/blocking/request.rs':[[19,31],[564,574]],
 'src/blocking/body.rs':[[133,145],[169,176]]}
records=[]
with tarfile.open(ARCHIVE,'r:gz') as archive:
 for path,ranges in paths.items():
  archived=archive.extractfile(PACKAGE+'/'+path).read();actual=(CACHE/'src'/INDEX/PACKAGE/path).read_bytes()
  assert archived==actual,('cached source differs from exact locked archive',path)
  records.append({'path':path,'sha256':hashlib.sha256(actual).hexdigest(),'archive_exact':True,'lines':ranges})
receipt={'package':PACKAGE,'cargo_lock_version':'0.12.28','source':'registry+https://github.com/rust-lang/crates.io-index',
 'package_checksum':CHECKSUM,'actual_archive':'F:/Veyra-Dock-build/cargo-cache/registry/cache/'+INDEX+'/'+PACKAGE+'.crate',
 'read_only':True,'files':records,'facts':{
 'final_inner_arc_drop':'closes tx then synchronously calls actual runtime thread join',
 'inner_join_result':'discarded; runtime thread ended even if panic, not a normal-success assertion',
 'response':'owns KeepCoreThreadAlive clone; drop body/Response before final Client',
 'request_builder':'holds temporary Client clone; build(self) returns Request and drops clone',
 'request':'no Client/KeepCoreThreadAlive field',
 'original_sender':'fresh per-request Client; private Request owner not Clone; response is its only surviving additional InnerArc',
 'outer_worker':'must consume actual Response and final Client, then real JoinHandle checked; persistent Pending/Joined/Failed',
 'semantics':'transport termination only; raw observation unknown remains unknown; no engine/tree or HTTP success proof'},
 'runtime_tests_run':False}
(ROOT/'reqwest-ownership.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps({'version':'0.12.28','archive_checksum_verified':True,'source_files_exact':len(records),'runtime_tests_run':False}))
