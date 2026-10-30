"""SQL133 preservation behavior only. Structural reference IDs are not real users/auth sessions.
No Core principal, Native owner, login, permission or remote authority is synthesized.
"""
import sqlite3,json,pathlib,hashlib
root=pathlib.Path(__file__).resolve().parent
sql=(root/'files/packages/ingenium-core/data/migrations/133_customize_scoped_catalog.sql').read_text()
count=0

def database(fk,recursive):
 c=sqlite3.connect(':memory:',isolation_level=None)
 c.execute(f'PRAGMA foreign_keys={fk}');c.execute(f'PRAGMA recursive_triggers={recursive}')
 c.executescript('''CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE organizations(id TEXT PRIMARY KEY);
 CREATE TABLE projects(id TEXT PRIMARY KEY);CREATE TABLE skill_proposals(id TEXT PRIMARY KEY);
 CREATE TABLE native_hosted_governance_grants(id TEXT PRIMARY KEY);
 CREATE TABLE plugins(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,enabled INTEGER NOT NULL);''')
 for table,ids in [('users',['u','u2']),('organizations',['o','o2']),('projects',['p','p2']),('skill_proposals',['proposal','proposal2']),('native_hosted_governance_grants',['g','g2'])]:
  c.executemany(f'INSERT INTO {table}(id) VALUES(?)',[(v,) for v in ids])
 c.executescript(sql)
 c.executemany('INSERT INTO plugins(id,project_id,enabled) VALUES(?,?,0)',[('plugin','p'),('plugin2','p2')])
 for index in range(2):
  c.execute('INSERT INTO plugin_lifecycle_events(id,plugin_id,project_id,previous_revision,next_revision,action,created_at) VALUES(?,?,?,?,?,?,?)',(f'event{index}','plugin','p',0,1,'archive','time'))
  c.execute('INSERT INTO customize_catalog_sources(id,installation_id,organization_id,owner_user_id,visibility,kind,name,description,source_project_id,source_resource_id,source_revision,payload_json,payload_sha256,published_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(f'source{index}','installation','o','u','personal','plugin',f'name{index}','original','p','plugin',0,'{"source":"original"}','a'*64,'u','time'))
  c.execute('INSERT INTO customize_native_consents(id,owner_user_id,installation_id,parent_grant_id,enrollment_request_id,organization_id,hosted_project_id,native_custodian_grant_id,original_json,request_sha256,registration_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(f'consent{index}','u','installation','g','enrollment','o','p','custodian','{"fixture":"original"}','b'*64,'{"fixture":"registration"}','time'))
  c.execute('INSERT INTO customize_commands(id,installation_id,actor_id,project_id,kind,resource_key,original_json,payload_sha256,result_json,created_at,native_consent_id,native_request_sha256) VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?)',(f'command{index}','installation','u','p','plugin','plugin','{"fixture":"original"}','c'*64,'time','consent0','d'*64))
  c.execute('INSERT INTO customize_installations(id,source_id,source_sha256,project_id,kind,target_name,resource_id,command_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',(f'installation{index}','source0','a'*64,'p','plugin','target','plugin',f'command{index}','u','time'))
  c.execute('INSERT INTO customize_projection_preimages(command_id,snapshot_json,snapshot_sha256) VALUES(?,?,?)',(f'command{index}','{"fixture":"preimage"}','e'*64))
 c.execute('UPDATE customize_catalog_sources SET archived_at=?,revision=revision+1 WHERE id=?',('withdrawn','source1'))
 c.execute('UPDATE customize_native_consents SET revoked_at=?,revision=revision+1 WHERE id=?',('revoked','consent1'))
 c.execute('UPDATE customize_commands SET result_json=? WHERE id=?',(receipt('command1'),'command1'))
 return c

def receipt(operation,outcome='succeeded',digest='c'*64):return json.dumps({'operationId':operation,'payloadSha256':digest,'outcome':outcome},sort_keys=True)
def state(c):return tuple(c.iterdump())
def rejected(c,statement,parameters=()):
 global count
 before=state(c)
 try:c.execute(statement,parameters)
 except sqlite3.Error:pass
 else:raise AssertionError('Mutation accepted: '+statement)
 assert state(c)==before,statement+' changed preserved state'
 count+=1

def rows(c,table):
 cur=c.execute(f'SELECT * FROM {table} ORDER BY 1');cols=[r[0] for r in cur.description]
 return [dict(zip(cols,row)) for row in cur.fetchall()]
def insert(table,row,mode=''):
 return f'INSERT {mode} INTO {table}('+','.join(row)+') VALUES('+','.join('?' for _ in row)+')',tuple(row.values())

matrix=[]
for fk in [0,1]:
 for recursive in [0,1]:
  c=database(fk,recursive);start=count
  tables={'plugin_lifecycle_events':('id','action','restore'),'customize_catalog_sources':('id','description','changed'),'customize_commands':('id','original_json','{"fixture":"changed"}'),'customize_installations':('id','target_name','changed'),'customize_projection_preimages':('command_id','snapshot_json','{"fixture":"changed"}'),'customize_native_consents':('id','registration_json','{"fixture":"changed"}')}
  for table,(key,field,changed) in tables.items():
   original=rows(c,table)
   assert len(original)==2
   for row in original:
    for mode in ['', 'OR IGNORE','OR REPLACE']:
     for variant in [row,{**row,field:changed}]:rejected(c,*insert(table,variant,mode))
     for missing in [None,'']:
      invalid={**row,key:missing}
      # A fresh provenance command prevents the secondary-key guard from masking a missing ID.
      if table=='customize_installations':invalid['command_id']='unused-reference'
      rejected(c,*insert(table,invalid,mode))
     for destination in ['new-original',original[1 if row==original[0] else 0][key]]:
      rejected(c,f'UPDATE {mode} {table} SET {key}=? WHERE {key}=?',(destination,row[key]))
     rejected(c,f'UPDATE {mode} {table} SET {field}=? WHERE {key}=?',(changed,row[key]))
    rejected(c,f'DELETE FROM {table} WHERE {key}=?',(row[key],))
   # A fresh installation ID must not replace/ignore an existing command provenance key.
   if table=='customize_installations':
    for mode in ['', 'OR IGNORE','OR REPLACE']:
     rejected(c,*insert(table,{**original[0],'id':'fresh-installation'},mode))
  for mode in ['', 'OR IGNORE','OR REPLACE']:
   # Terminal first receipt cannot be cleared, replaced, or applied to a different original.
   for bad in [None,receipt('command1','refused'),receipt('command0'),receipt('command1',digest='f'*64)]:
    rejected(c,f'UPDATE {mode} customize_commands SET result_json=? WHERE id=?',(bad,'command1'))
   for bad in [receipt('command0','unknown'),'null','[]','{}',receipt('different'),receipt('command0',digest='f'*64)]:
    rejected(c,f'UPDATE {mode} customize_commands SET result_json=? WHERE id=?',(bad,'command0'))
   for field,value in [('native_consent_id','consent1'),('native_request_sha256','f'*64)]:
    rejected(c,f'UPDATE {mode} customize_commands SET {field}=?,result_json=? WHERE id=?',(value,receipt('command0'),'command0'))
   rejected(c,f'UPDATE {mode} customize_native_consents SET revoked_at=NULL,revision=revision+1 WHERE id=?',('consent1',))
   rejected(c,f'UPDATE {mode} customize_native_consents SET revoked_at=?,revision=revision+1 WHERE id=?',('other-revocation','consent1'))
   # A pending command cannot acquire a Native context after its original claim.
   rejected(c,f'UPDATE {mode} customize_commands SET native_consent_id=NULL,native_request_sha256=NULL,result_json=? WHERE id=?',(receipt('command0'),'command0'))
   fresh={**rows(c,'customize_commands')[0],'id':'fresh-command','native_consent_id':None,'native_request_sha256':'d'*64}
   rejected(c,*insert('customize_commands',fresh,mode))
   for bad in ['null',receipt('fresh-command','unknown'),receipt('wrong')]:
    fresh={**rows(c,'customize_commands')[0],'id':'fresh-command','result_json':bad}
    rejected(c,*insert('customize_commands',fresh,mode))
  # Genuine one-way SQL transitions still work and preserve all immutable columns.
  old=rows(c,'customize_commands')[0]
  c.execute('UPDATE customize_commands SET result_json=? WHERE id=?',(receipt('command0','refused'),'command0'))
  final=rows(c,'customize_commands')[0];assert {**old,'result_json':receipt('command0','refused')}==final
  old=rows(c,'customize_native_consents')[0]
  c.execute('UPDATE customize_native_consents SET revoked_at=?,revision=revision+1 WHERE id=?',('one-way','consent0'))
  assert {**old,'revoked_at':'one-way','revision':2}==rows(c,'customize_native_consents')[0]
  source_before=rows(c,'customize_catalog_sources')[0]
  c.execute('UPDATE customize_catalog_sources SET archived_at=?,revision=revision+1 WHERE id=?',('withdrawn','source0'))
  c.execute('UPDATE customize_catalog_sources SET archived_at=NULL,revision=revision+1 WHERE id=?',('source0',))
  assert {**source_before,'revision':3}==rows(c,'customize_catalog_sources')[0]
  # Archive and restore produce distinct immutable lifecycle events; restore stays disabled.
  before=c.execute('SELECT count(*) FROM plugin_lifecycle_events').fetchone()[0]
  c.execute('UPDATE plugins SET archived_at=? WHERE id=?',('archived','plugin'))
  c.execute('UPDATE plugins SET archived_at=NULL WHERE id=?',('plugin',))
  assert c.execute('SELECT enabled,revision,archived_at FROM plugins WHERE id=?',('plugin',)).fetchone()==(0,2,None)
  assert c.execute('SELECT count(*) FROM plugin_lifecycle_events').fetchone()[0]==before+2
  for table,(key,_,_) in tables.items():
   assert all(r[3] for r in c.execute(f'PRAGMA table_info({table})') if r[1]==key),table
  if fk:assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
  matrix.append({'foreignKeys':fk,'recursiveTriggers':recursive,'rejectedMutationsPreservedExactDump':count-start,'legitimateFirstReceiptAndRevocation':'passed','pluginArchiveRestoreEvents':'passed'})
  c.close()
print(json.dumps({'sqlSha256':hashlib.sha256(sql.encode()).hexdigest(),'matrix':matrix,'totalRejectedMutations':count,'actualAuthSessionsOrPrincipalsCreated':0,'structuralReferenceIdentifiersOnly':True,'actualCoreMigrationNativeOrRuntimeAcceptance':False},indent=2))