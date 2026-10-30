"""Actual proposed Native custody SQL, reconstructed in memory from exact source hooks.
Pure journal preservation controls; no Native principal, grant, profile or Node authority is created.
"""
import json,pathlib,re,sqlite3,hashlib
here=pathlib.Path(__file__).resolve().parent
native=here.parents[3]/'windows-source'
# Explicit caller may point at Root's actual canonical Native source.
native=pathlib.Path('/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/windows-source')
hooks=json.loads((here/'native-scoped-v1-hooks.json').read_text())
row=next(r for r in hooks['sources'] if r['path']=='crates/adapters/src/utility_operations/hosted.rs')
source=(native/row['path']).read_text()
assert hashlib.sha256(source.encode()).hexdigest()==row['preimageSha256']
for patch in row['replacements']:
 assert source.count(patch['before'])==patch.get('count',1)
 source=source.replace(patch['before'],patch['after'])
assert hashlib.sha256(source.encode()).hexdigest()==row['postimageSha256']
def string(name):
 match=re.search(r'const '+name+r'\s*:\s*&str\s*=\s*"([^"\n]*)";',source)
 assert match,name
 return match.group(1)
project,resource=string('PROJECT_CUSTODY'),string('RESOURCE_CUSTODY')
admin=re.search(r'const ADMIN_UNRESOLVED\s*:\s*&str\s*=\s*r#"(.*?)"#;',source,re.S).group(1)
admin_scope=string('ADMIN_RESOURCE')
c=sqlite3.connect(':memory:')
c.executescript('CREATE TABLE originals(id TEXT PRIMARY KEY,kind TEXT NOT NULL,original TEXT NOT NULL,result TEXT,created INTEGER NOT NULL);CREATE TABLE hosted_dispatch(id TEXT PRIMARY KEY,owner_key TEXT NOT NULL,started INTEGER NOT NULL);')
encode=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)
owner={'enrollment_request_id':'enrollment','native_owner':{'library_id':'library','service_instance_id':'service','project':{'id':'native-project','revision':1,'name':'prójèct'}},'account_review':{'account':{'id':'account'}}}
proto='customize_scoped_consent_command_v1'
original={'protocol':proto,'command':{'operationId':'consent','review':{'fixture':'metadata-only'}},'private_owner':owner}
count=0

def clear():c.execute('DELETE FROM hosted_dispatch');c.execute('DELETE FROM originals')
def insert(ident,kind,original,result=None,dispatch=False):
 c.execute('INSERT INTO originals VALUES(?,?,?,?,0)',(ident,kind,encode(original),None if result is None else encode(result)))
 if dispatch:c.execute('INSERT INTO hosted_dispatch VALUES(?,?,0)',(ident,'f'*64))
def held():return bool(c.execute('SELECT EXISTS(SELECT 1 '+admin+admin_scope+')',('enrollment','account')).fetchone()[0])
def assert_hold(expected):
 global count
 assert held()==expected;count+=1

for legacy in [False,True]:
 clear();binding={'nativeProjectId':'native-project','grantId':'parent-grant','connectionId':'connection'}
 packet={'original':{'id':'operation',('binding' if legacy else 'baseBinding'):binding,**({}if legacy else{'consentId':'consent'})},'private_owner':owner}
 insert('operation','hosted_governance',packet,dispatch=True)
 assert c.execute(project,('native-project',)).fetchone()[0]==1;count+=1
 for key in ['parent-grant','connection','enrollment']+([]if legacy else['consent']):assert c.execute(resource,(key,key,key,key)).fetchone()[0]==1;count+=1
 assert c.execute(resource,('unrelated',)*4).fetchone()[0]==0;count+=1
 c.execute('UPDATE originals SET result=? WHERE id=?',(encode({'outcome':'refused'}),'operation'))
 assert c.execute(project,('native-project',)).fetchone()[0]==0;count+=1

repair={'protocol':'customize_scoped_consent_reconciliation_v1','command':{'consentId':'consent','requestSha256':'a'*64},'source_operation_id':'consent','source_original':original,'private_owner':owner}
valid={'state':'completed','value':{'registration_confirmed':True,'proof':'actual_Node_registration_fresh_parent_and_managed_profiles'}}
for first in [None,{'state':'unconfirmed'}]:
 clear();insert('consent','remote_admin',original,first);assert_hold(True)
 insert('repair-old','remote_admin',repair,{'state':'unconfirmed'});assert_hold(True)
 for bad in [None,{'state':'unconfirmed'},{'state':'completed','value':{'registration_confirmed':False,'proof':valid['value']['proof']}},{'state':'completed','value':{'registration_confirmed':True,'proof':'caller_says_success'}}]:
  insert('repair-new','remote_admin',repair,bad);assert_hold(True);c.execute('DELETE FROM originals WHERE id=?',('repair-new',))
 for key,value in [('source_operation_id','different'),('source_original',{'different':'original'}),('protocol','unrelated')]:
  insert('repair-new','remote_admin',{**repair,key:value},valid);assert_hold(True);c.execute('DELETE FROM originals WHERE id=?',('repair-new',))
 insert('repair-new','remote_admin',repair,valid);assert_hold(False)
 # A registration reconciliation does not release any independently executing original.
 insert('operation','hosted_governance',{'original':{'id':'operation','baseBinding':{'grantId':'parent-grant','connectionId':'connection','nativeProjectId':'native-project'},'consentId':'consent'},'private_owner':owner},dispatch=True)
 assert c.execute(resource,('consent',)*4).fetchone()[0]==1;count+=1

revocation={'protocol':'customize_scoped_consent_revocation_v1','command':{'consentId':'consent','requestSha256':'a'*64},'private_owner':owner}
revoked={'state':'completed','value':{'local_consent_revoked':True,'local_profile_revoked':True,'node':{'revoked':True,'consentId':'consent'}}}
for subject in ['initial','repair','revocation']:
 clear();insert('consent','remote_admin',original,{'state':'unconfirmed'})
 if subject=='repair':insert('repair-old','remote_admin',repair,{'state':'unconfirmed'})
 if subject=='revocation':insert('revoke-old','remote_admin',revocation,{'state':'unconfirmed'})
 assert_hold(True)
 for change in [('local_consent_revoked',False),('local_profile_revoked',False),('node',{'revoked':False,'consentId':'consent'}),('node',{'revoked':True,'consentId':'different'})]:
  insert('revoke-new','remote_admin',revocation,{'state':'completed','value':{**revoked['value'],change[0]:change[1]}});assert_hold(True);c.execute('DELETE FROM originals WHERE id=?',('revoke-new',))
 for changed_owner in [{**owner,'enrollment_request_id':'different'},{**owner,'account_review':{'account':{'id':'different'}}},{**owner,'native_owner':{**owner['native_owner'],'library_id':'different'}}]:
  insert('revoke-new','remote_admin',{**revocation,'private_owner':changed_owner},revoked);assert_hold(True);c.execute('DELETE FROM originals WHERE id=?',('revoke-new',))
 insert('revoke-new','remote_admin',revocation,revoked);assert_hold(False)
print(json.dumps({'actualProposedNativeSqlControls':count,'preservedLegacyAndScopedCustody':True,'unconfirmedAndWrongWitnessRemainHeld':True,'matchingPhysicalRevocationAndRegistrationWitnessesReleaseOnlyAdministrativeCustody':True,'actualNativeProfilesPrincipalsSessionsOrRemoteAcceptance':False,'postimageSha256':row['postimageSha256']},indent=2))
c.close()