"""CPU-only SQLite fixtures; exact actual allocation6 input, no runtime or file DB."""
import hashlib,json,sqlite3,subprocess,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
NATIVE='//wsl.localhost/Ubuntu/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/windows-source'
GIT='/mnt/c/Program Files/Git/cmd/git.exe'
V6PIN=json.loads((ROOT/'native15-inputs.json').read_text())['behavior_inputs'][0]
V6BYTES=subprocess.check_output([GIT,'-c','safe.directory='+NATIVE,'-C',NATIVE,'cat-file','blob',V6PIN['blob']])
assert hashlib.sha256(V6BYTES).hexdigest()==V6PIN['sha256']
V6=V6BYTES.decode()
V7=(ROOT/'sources/crates/adapters/src/projects/0007.sql').read_text()
def fixture(migrate=True):
 db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON');db.execute('PRAGMA recursive_triggers=OFF')
 db.executescript(V6)
 db.execute("INSERT INTO local_installation VALUES(1,'library','windows_sid','sid','physical',?,0,?)",('a'*64,'b'*64))
 db.execute("INSERT INTO local_migration_receipts VALUES(6,'library',?,?)",('a'*64,'b'*64))
 db.execute("INSERT INTO local_workspaces VALUES('ws','library',?,'{}',0,?,'active','physical','/private')",('a'*64,'c'*64))
 db.execute('CREATE TABLE legacy_probe(value BLOB)');db.execute('INSERT INTO legacy_probe VALUES(?)',(b'\x00\xfflegacy\r\n\x80',));db.commit()
 if migrate:db.executescript('BEGIN IMMEDIATE;'+V7+'COMMIT;')
 return db
def insert_original(db,op='original',stable='message',body=b'{ "id":"msg_original", "parts":[1,2] }',source=b'captured'):
 method='POST';target='/api/session/ses_original/prompt?x=a%20b';headers='[["content-type","application/json"]]';scope='{"owner":"ws","engine":"original"}'
 size=sum(len(x.encode()) for x in [method,target,headers,scope])+len(body)
 digest=hashlib.sha256(target.encode()+body).hexdigest()
 db.execute("INSERT INTO local_workspace_operations VALUES(?,'ws','{}',?,'native_web_original','intent',NULL)",(op,digest))
 db.execute('INSERT INTO local_web_original_keys VALUES(?,?,?,?,?,?)',(op,stable,digest,hashlib.sha256(body).hexdigest(),size,size+len(body)+4+len(source)+64))
 db.execute('INSERT INTO local_web_original_sources VALUES(?,?,?)',(op,hashlib.sha256(source).hexdigest(),source))
 db.execute('INSERT INTO local_web_original_payloads VALUES(?,?,?,?,?,?,?,?,?)',(op,method,target,headers,scope,body,body,'[]','{}'))
 return digest
class Tests(unittest.TestCase):
 def test_legacy_bytes_and_old_migration_receipt_survive(self):
  db=fixture(False);before=db.execute('SELECT * FROM local_installation').fetchall(),db.execute('SELECT * FROM local_migration_receipts').fetchall(),db.execute('SELECT value FROM legacy_probe').fetchone()
  db.executescript('BEGIN IMMEDIATE;'+V7+'COMMIT;')
  self.assertEqual(before,(db.execute('SELECT * FROM local_installation').fetchall(),db.execute('SELECT * FROM local_migration_receipts').fetchall(),db.execute('SELECT value FROM legacy_probe').fetchone()))
  self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],7)
 def test_immutable_update_delete_and_replace_with_recursive_triggers_off(self):
  db=fixture();insert_original(db);db.commit()
  self.assertEqual(db.execute('PRAGMA recursive_triggers').fetchone()[0],0)
  for sql in ["UPDATE local_web_original_keys SET stable_key='changed'",'DELETE FROM local_web_original_keys',"UPDATE local_web_original_payloads SET raw_body=X'00'",'DELETE FROM local_web_original_payloads',
   'INSERT OR REPLACE INTO local_web_original_keys SELECT * FROM local_web_original_keys',
   'INSERT OR REPLACE INTO local_web_original_payloads SELECT * FROM local_web_original_payloads',
   'INSERT OR REPLACE INTO local_web_original_sources SELECT * FROM local_web_original_sources',
   "UPDATE local_web_original_sources SET source_bytes=X'00'",'DELETE FROM local_web_original_sources',
   'INSERT OR REPLACE INTO local_workspace_operations SELECT * FROM local_workspace_operations',
   'INSERT OR REPLACE INTO local_installation SELECT * FROM local_installation',
   'INSERT OR REPLACE INTO local_migration_receipts SELECT * FROM local_migration_receipts',
   'INSERT OR REPLACE INTO local_workspaces SELECT * FROM local_workspaces']:
   with self.assertRaises(sqlite3.IntegrityError,msg=sql):db.execute(sql)
  self.assertEqual(db.execute('SELECT raw_body FROM local_web_original_payloads').fetchone()[0],b'{ "id":"msg_original", "parts":[1,2] }')
 def test_duplicate_stable_identity_aborts_whole_reservation(self):
  db=fixture();insert_original(db);db.commit()
  with self.assertRaises(sqlite3.IntegrityError):
   try:db.execute('BEGIN IMMEDIATE');insert_original(db,'second','message',b'different')
   except:db.rollback();raise
  self.assertIsNone(db.execute("SELECT id FROM local_workspace_operations WHERE id='second'").fetchone())
 def test_unknown_cannot_forget_terminal_can_and_tombstone_blocks_replacement(self):
  db=fixture();digest=insert_original(db);db.execute("UPDATE local_workspace_operations SET state='unknown' WHERE id='original'");db.commit()
  with self.assertRaises(sqlite3.IntegrityError):db.execute("INSERT INTO local_web_original_forget_receipts VALUES('original',?,'forget')",(digest,))
  db.execute("UPDATE local_workspace_operations SET state='committed',result_json='{}' WHERE id='original'")
  db.execute("INSERT INTO local_web_original_forget_receipts VALUES('original',?,'forget')",(digest,));db.execute("DELETE FROM local_web_original_sources WHERE operation_id='original'");db.execute("DELETE FROM local_web_original_payloads WHERE operation_id='original'");db.commit()
  self.assertEqual(db.execute('SELECT count(*) FROM local_web_original_keys').fetchone()[0],1)
  for sql in ['UPDATE local_web_original_forget_receipts SET forget_request_id=forget_request_id','DELETE FROM local_web_original_forget_receipts','INSERT OR REPLACE INTO local_web_original_forget_receipts SELECT * FROM local_web_original_forget_receipts']:
   with self.assertRaises(sqlite3.IntegrityError):db.execute(sql)
  with self.assertRaises(sqlite3.IntegrityError):insert_original(db,'second','message')
 def test_migration_rollback_restores_exact_old_schema_and_data(self):
  db=fixture(False);schema=db.execute("SELECT name,sql FROM sqlite_master ORDER BY name").fetchall()
  db.executescript('BEGIN IMMEDIATE;'+V7);db.rollback()
  self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],6)
  self.assertEqual(schema,db.execute("SELECT name,sql FROM sqlite_master ORDER BY name").fetchall())
  self.assertEqual(db.execute('SELECT value FROM legacy_probe').fetchone()[0],b'\x00\xfflegacy\r\n\x80')
 def test_intake_and_aggregate_bounds(self):
  db=fixture()
  with self.assertRaises(sqlite3.IntegrityError):insert_original(db,body=b'x'*16777216)
  db.rollback()
  for i in range(1):insert_original(db,str(i),str(i),b'x'*(16*1024*1024-1024))
  db.commit()
  with self.assertRaises(sqlite3.IntegrityError):insert_original(db,'fifth','fifth',b'x'*8192)
 def test_private_ack_is_immutable_no_replace_and_transactionally_rolls_back(self):
  db=fixture();digest=insert_original(db);db.execute("UPDATE local_workspace_operations SET state='unknown'");db.commit()
  body=b'{"data":{"id":"msg_original","sessionID":"ses_original","type":"user"}}';headers='[["content-type","application/json"]]'
  values=('original',digest,200,headers,hashlib.sha256(body).hexdigest(),body,len(headers.encode())+len(body)+64)
  db.execute('BEGIN IMMEDIATE');db.execute('INSERT INTO local_web_original_acknowledgements VALUES(?,?,?,?,?,?,?)',values)
  db.execute("UPDATE local_workspace_operations SET state='committed',result_json='{}'");db.rollback()
  self.assertEqual(db.execute('SELECT state FROM local_workspace_operations').fetchone()[0],'unknown')
  self.assertEqual(db.execute('SELECT count(*) FROM local_web_original_acknowledgements').fetchone()[0],0)
  db.execute('INSERT INTO local_web_original_acknowledgements VALUES(?,?,?,?,?,?,?)',values);db.commit()
  for sql in ['INSERT OR REPLACE INTO local_web_original_acknowledgements SELECT * FROM local_web_original_acknowledgements',"UPDATE local_web_original_acknowledgements SET body=X'00'",'DELETE FROM local_web_original_acknowledgements']:
   with self.assertRaises(sqlite3.IntegrityError):db.execute(sql)
  self.assertEqual(db.execute('SELECT body FROM local_web_original_acknowledgements').fetchone()[0],body)
 def test_captured_source_cannot_commit_without_its_original_payload(self):
  db=fixture();digest='d'*64
  db.execute("INSERT INTO local_workspace_operations VALUES('orphan','ws','{}',?,'native_web_original','intent',NULL)",(digest,))
  db.execute("INSERT INTO local_web_original_keys VALUES('orphan',NULL,?,?,3,4)",(digest,digest))
  db.execute("INSERT INTO local_web_original_sources VALUES('orphan',?,?)",(hashlib.sha256(b'x').hexdigest(),b'x'))
  with self.assertRaises(sqlite3.IntegrityError):db.commit()
  db.rollback();self.assertIsNone(db.execute("SELECT id FROM local_workspace_operations WHERE id='orphan'").fetchone())
if __name__=='__main__':unittest.main()
