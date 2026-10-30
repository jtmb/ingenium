"""One-field fixture delta; retain the original failure input in Git e5cca98c."""
import difflib
import hashlib
import json
from pathlib import Path
import subprocess

here = Path(__file__).resolve().parent
source = 'docs/workstreams/voice/local-mute/LocalMute.test.tsx'
root = '/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/parallel/voice'
before = subprocess.check_output(['wsl','-d','Ubuntu','-u','brajam','--','git','-C',root,'show','e5cca98c:'+source]).decode('utf-8')
after = (here/'LocalMute.test.tsx').read_text(encoding='utf-8')
expected = before.replace('active_utterance_id:turnId};','active_utterance_id:turnId,turn_request_id:turnId};')
if after != expected or before == expected:
    raise ValueError('Correction must be exactly the missing native turn join')
target = 'apps/web/src/features/voice-ui/LocalMute.test.tsx'
patch = ''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),fromfile='a/'+target,tofile='b/'+target))
(here/'retention-fixture-correction.patch').write_text(patch,encoding='utf-8',newline='\n')
receipt = {'path':target,'beforeSha256':hashlib.sha256(before.encode()).hexdigest(),'afterSha256':hashlib.sha256(after.encode()).hexdigest(),
    'patchSha256':hashlib.sha256(patch.encode()).hexdigest(),'rootFailureLog':'coordination/integration/native-voice-local-mute-semantics-r1.log',
    'cause':'Fixture omitted actual Native SessionView.turn_request_id, so original VAD guard refused the frame before capture',
    'runtimeChanges':0,'nativeComponentRerun':'Root-owned, not run here'}
(here/'retention-fixture-correction.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps(receipt))
