"""CPU-only exact-source/SQLite checks. NOT Rust compilation/runtime acceptance."""
import hashlib,json,runpy,sqlite3
from pathlib import Path
ROOT=Path(__file__).resolve().parent
ns=runpy.run_path(str(ROOT/'compose.py'))
before,after=ns['before'],ns['after']
def check(condition,label):
 assert condition,label
 print('PASS '+label)
web=after[ns['WEB']];store=after[ns['STORE']];service=after[ns['SVC']]
completion=after[ns['COMPLETION']];transport=after[ns['TRANSPORT']]
dispatch=web[web.index('    fn dispatch_local_web_prompt_locked'):web.index('    pub fn inspect_local_web_prompt(')]
check(dispatch.index('native_web_completions.enroll(dispatch)')<dispatch.index('prepare_original_web_prompt')<dispatch.index('send_retained(')<dispatch.index('let _postprocessing='),'actual slot before HTTP and all fallible postprocessing')
check('sent.map_err' not in dispatch and 'Ok(outcome)' in dispatch,'unknown transport survives sender result')
check('state.request=Some(request);' in completion and completion.index('state.request=Some(request);')<completion.index('execute_retained();'),'actual transport owner stored before execute')
check(transport.index('self.response=Some(response)')<transport.index('observed.status=Some('),'actual Response stored before parsing')
check('read_to_end' not in transport and 'observed.body.extend_from_slice' in transport and 'body-read-unknown' in transport,'read failures keep exact body prefix')
check('Arc::ptr_eq(old,&actual)' in service and service.index('web.bind(')<service.index('spawn_blocking('),'service bound same runtime before worker')
check('if !std::sync::Arc::ptr_eq(&self.native_web_writer,outcome.writer_identity())' in store,'retention requires actual original writer allocation')
ack=store[store.index('pub fn acknowledge_native_web_prompt'):store.index('    /// Caller retains')]
check('check_local_owner(' not in ack and 'require_local_session(' not in ack,'revocation does not destroy same-row completion append')
reserve=store[store.index('pub fn reserve_native_web_original'):store.index('    /// Explicit native privacy')]
check('self.check_local_owner(original.owner(),instance)?;' in reserve and 'self.require_local_session(' in reserve,'fresh dispatch still checks current ownership and session')
check('forgotten||scope.as_deref()!=Some(outcome.original_scope())' in ack and 'NativeWebPublished::from_actual(outcome)' in ack,'forgotten/missing/copied scope cannot append; sealed publication returned')
check('.remove(' not in completion and '.close_once(' not in completion,'publication alone never retires original read')
check('is_ok()' not in service,'service does not use success boolean to drop outcome')
# Real allocation6+7 SQL, with real production completion INSERT and settlement
# statement. Simulated current authorization state is deliberately irrelevant:
# original row+scope remain; no fresh admission is attempted by this fixture.
pin=json.loads(ns['frozen']('native15-inputs.json'))['behavior_inputs'][0]
db=sqlite3.connect(':memory:');db.execute('PRAGMA foreign_keys=ON');db.executescript(ns['blob'](pin['blob']).decode());db.executescript(before['crates/adapters/src/projects/0007.sql'])
# These fixtures exercise actual immutable/tombstone triggers independently of
# native-only Arc custody. Copied pointer/DTO authority is a Rust review gate.
tables=db.execute("SELECT name,sql FROM sqlite_master WHERE type='table'").fetchall()
check(any(name=='local_web_original_forget_receipts' for name,_ in tables),'actual forget fence table present')
check(db.execute('PRAGMA foreign_keys').fetchone()[0]==1,'fixture matches original writer foreign-key enforcement')
fixtures=runpy.run_path(str(ROOT.parent/'test_migration7.py'))
db=fixtures['fixture']();digest=fixtures['insert_original'](db)
db.execute("UPDATE local_workspace_operations SET state='unknown' WHERE id='original'");db.commit()
scope=db.execute("SELECT scope_engine_json FROM local_web_original_payloads WHERE operation_id='original'").fetchone()[0]
# Current workspace revision changes after dispatch. The original row and its
# captured scope stay immutable. Retention append does not write a new scope.
db.execute("UPDATE local_workspaces SET revision=revision+1 WHERE id='ws'");db.commit()
body=b'{"data":{"id":"msg_original","sessionID":"ses_original","type":"user","time":{"created":1},"payload":{"text":"x"},"delivery":"steer"}}'
headers='[["content-type","application/json"]]'
values=('original',digest,200,headers,hashlib.sha256(body).hexdigest(),body,len(headers.encode())+len(body)+64)
db.execute('BEGIN IMMEDIATE')
db.execute('INSERT INTO local_web_original_acknowledgements VALUES(?,?,?,?,?,?,?)',values)
db.execute("UPDATE local_workspace_operations SET state='committed',result_json=? WHERE id=? AND state='unknown'",('{"admission":"admitted","upstream_id":"msg_original","status":200}','original'))
db.commit()
check(db.execute("SELECT scope_engine_json FROM local_web_original_payloads WHERE operation_id='original'").fetchone()[0]==scope and db.execute("SELECT body FROM local_web_original_acknowledgements WHERE operation_id='original'").fetchone()[0]==body,'real SQL retains original ACK after current workspace revision change')
db.execute("INSERT INTO local_web_original_forget_receipts VALUES('original',?,'forget')",(digest,))
db.execute("DELETE FROM local_web_original_acknowledgements WHERE operation_id='original'")
db.execute("DELETE FROM local_web_original_sources WHERE operation_id='original'")
db.execute("DELETE FROM local_web_original_payloads WHERE operation_id='original'");db.commit()
check(db.execute("SELECT EXISTS(SELECT 1 FROM local_web_original_forget_receipts WHERE operation_id='original')").fetchone()[0]==1 and db.execute("SELECT scope_engine_json FROM local_web_original_payloads WHERE operation_id='original'").fetchone() is None,'actual forget tombstone removes payload and makes retention append refuse')
try:db.execute('INSERT INTO local_web_original_acknowledgements VALUES(?,?,?,?,?,?,?)',values);db.commit()
except sqlite3.IntegrityError:db.rollback()
else:raise AssertionError('forgotten ACK resurrected')
check(db.execute('SELECT count(*) FROM local_web_original_acknowledgements').fetchone()[0]==0,'actual SQL rejects forgotten ACK resurrection')
check(hashlib.sha256((ROOT.parent/'native15-originals.patch').read_bytes()).hexdigest()=='94e664c8e9aabbb517e1244fdf4514a04acf4ceae955acedff5515c603f77fc7','frozen094c patch bytes unchanged')
print('Rust compilation, real Arc forgery negatives, Windows join/close and runtime acceptance remain OPEN')
