// Extracted ACTUAL db.ts methods with proposal applied IN MEMORY only.
// Synthetic constructor/config/guard/close faults never become production ports.
import test from 'node:test';import assert from 'node:assert/strict';
import {createRequire,stripTypeScriptTypes} from 'node:module';import {createHash} from 'node:crypto';
import {proposal} from './proposal.mjs';
const app=process.env.VEYRA_SOURCE_APP,p=proposal(app),Database=createRequire(app+'/package.json')('better-sqlite3');
function owner({fault=null,closeFault=null,real=false,env={},uid=1000,reentry=null}={}){
 const state={fault,closeFault,constructed:[],migrated:[],closed:[],config:[],reentryResults:[],mkdirs:0};let api;
 const failAt=stage=>{if(reentry===stage){try{api.getDb('/wrong-new-path');state.reentryResults.push('returned');}catch(e){state.reentryResults.push(e.message);}}if(reentry===stage+'-maintenance'){for(const action of ['closeDbForMaintenance','resetDbForTest'])try{api[action]();state.reentryResults.push('unexpected close');}catch(e){state.reentryResults.push(e.message);}}if(state.fault===stage)throw Error('fixture '+stage);};
 function Constructor(){failAt('constructor');let original;
  if(real){original=new Database(':memory:');}
  else{let open=true;original={get open(){if(state.closeFault==='unknown')return undefined;if(state.closeFault==='getter')throw Error('fixture close-state getter');return open;},function(){state.config.push('function');failAt('function');},pragma(v){state.config.push(v);failAt(v);},close(){state.closed.push(original);if(reentry==='close'){try{api.getDb();}catch(e){state.reentryResults.push(e.message);}try{api.closeDbForMaintenance();}catch(e){state.reentryResults.push(e.message);}}if(state.closeFault==='throw')throw Error('fixture close threw');if(state.closeFault!=='still-open'&&state.closeFault!=='unknown'&&state.closeFault!=='getter')open=false;}};}
  state.constructed.push(original);return original;
 }
 const code='let db: Database.Database | null = null;\n'+p.custody+'\nlet writeCount=7;\n'+p.getDb+'\n'+p.close+'\n'+p.reset;
 const js=stripTypeScriptTypes(code.replace(/^export /gm,''),{mode:'strip'})+'\nreturn {getDb,closeDbForMaintenance,resetDbForTest,inspect:()=>({db,state:dbBootstrapState,failure:dbBootstrapFailure,writeCount})};';
 api=new Function('Database','resolveCoreDbPath','dirname','mkdirSync','createHash','runMigrations','process',js)(Constructor,v=>v??'/fixture-only',()=>'/synthetic-no-directory',()=>{state.mkdirs++;},createHash,original=>{state.migrated.push(original);if(real){original.exec('PRAGMA cache_size=-8192; CREATE TABLE fixture_guard(n INTEGER); INSERT INTO fixture_guard VALUES(1)');}failAt('migration-guard');},{env,getuid:uid===null?undefined:()=>uid});
 return {api,state};
}
for(const stage of ['constructor','function','journal_mode = WAL','busy_timeout = 5000','foreign_keys = ON','migration-guard'])test('actual extraction '+stage+' failure closes exact opened original; fresh retry rechecks guards',()=>{
 const f=owner({fault:stage});assert.throws(()=>f.api.getDb('/first'),new RegExp('fixture '+stage));
 assert.equal(f.api.inspect().db,null);assert.equal(f.api.inspect().state,'closed');
 if(stage!=='constructor'){assert.equal(f.state.closed.length,1);assert.strictEqual(f.state.closed[0],f.state.constructed[0]);assert.equal(f.state.constructed[0].open,false);}
 f.state.fault=null;const next=f.api.getDb('/retry');assert.equal(f.state.migrated.at(-1),next);assert.equal(f.api.inspect().state,'ready');assert.strictEqual(f.api.getDb('/other-ignored-existing-singleton'),next);f.api.closeDbForMaintenance();
});
for(const closeFault of ['throw','still-open','unknown','getter'])for(const reset of ['closeDbForMaintenance','resetDbForTest'])test('failed bootstrap retains exact original under '+closeFault+'; '+reset+' clears only after positive close',()=>{
 const f=owner({fault:'migration-guard',closeFault});assert.throws(()=>f.api.getDb('/first'),/BOOTSTRAP_CLOSE_UNCONFIRMED/);
 const original=f.state.constructed[0];assert.strictEqual(f.api.inspect().db,original);assert.equal(f.api.inspect().state,'failed');assert.match(f.api.inspect().failure.message,/migration-guard/);
 for(let n=0;n<2;n++)assert.throws(()=>f.api.getDb('/no-new-connection'),/BOOTSTRAP_UNAVAILABLE/);
 assert.equal(f.state.constructed.length,1);assert.equal(f.state.mkdirs,1);
 assert.throws(()=>f.api[reset](),/fixture close|CLOSE_UNCONFIRMED/);assert.strictEqual(f.api.inspect().db,original);assert.equal(f.api.inspect().writeCount,7);
 f.state.closeFault=null;f.api[reset]();assert.equal(f.api.inspect().db,null);assert.equal(f.api.inspect().failure,null);assert.equal(f.api.inspect().state,'closed');assert.equal(f.api.inspect().writeCount,0);
 f.state.fault=null;const retry=f.api.getDb('/new');assert.notStrictEqual(retry,original);assert.strictEqual(f.state.migrated.at(-1),retry);f.api.closeDbForMaintenance();
});
for(const stage of ['constructor','function','migration-guard'])test('synchronous reentry during '+stage+' cannot expose opening original or open second connection',()=>{
 const f=owner({reentry:stage});f.api.getDb();assert.deepEqual(f.state.reentryResults,['CORE_DATABASE_BOOTSTRAP_UNAVAILABLE']);assert.equal(f.state.constructed.length,1);f.api.closeDbForMaintenance();
});
test('reentry during exact close is refused and cannot interrupt custody',()=>{const f=owner({reentry:'close'}),original=f.api.getDb();f.api.closeDbForMaintenance();assert.deepEqual(f.state.reentryResults,['CORE_DATABASE_BOOTSTRAP_UNAVAILABLE','CORE_DATABASE_BOOTSTRAP_UNAVAILABLE']);assert.equal(original.open,false);assert.equal(f.api.inspect().state,'closed');});
test('maintenance and test reset cannot close an original while configuration is still opening',()=>{const f=owner({reentry:'function-maintenance'}),original=f.api.getDb();assert.deepEqual(f.state.reentryResults,['CORE_DATABASE_BOOTSTRAP_UNAVAILABLE','CORE_DATABASE_BOOTSTRAP_UNAVAILABLE']);assert.equal(f.state.closed.length,0);assert.equal(original.open,true);f.api.closeDbForMaintenance();});
for(const [mode,uid,migrations] of [['execute',0,0],['execute',1000,1],['execute',null,1],['other',0,1],['',0,1]])test('unchanged exact restore maintenance gate mode='+mode+' uid='+uid,()=>{
 const f=owner({env:{INGENIUM_RESTORE_MAINTENANCE_MODE:mode},uid});f.api.getDb();assert.equal(f.state.migrated.length,migrations);assert.equal(f.state.config.length,4);f.api.closeDbForMaintenance();
});
test('normal ready connection close failure also refuses cached return and reset until exact close confirmed',()=>{
 const f=owner(),original=f.api.getDb();f.state.closeFault='throw';assert.throws(()=>f.api.closeDbForMaintenance(),/close threw/);assert.strictEqual(f.api.inspect().db,original);assert.throws(()=>f.api.getDb(),/BOOTSTRAP_UNAVAILABLE/);f.state.closeFault=null;f.api.resetDbForTest();assert.equal(f.api.inspect().db,null);
});
test('actual better-sqlite3 memory original closes on injected guard failure then new memory connection reruns guard',()=>{
 const f=owner({real:true,fault:'migration-guard'});assert.throws(()=>f.api.getDb(),/fixture migration-guard/);const first=f.state.constructed[0];assert.equal(first.open,false);assert.equal(f.api.inspect().db,null);f.state.fault=null;const next=f.api.getDb();assert.notStrictEqual(first,next);assert.equal(next.prepare('SELECT n FROM fixture_guard').get().n,1);assert.strictEqual(f.state.migrated.at(-1),next);assert.ok(next.pragma('page_count',{simple:true})*next.pragma('page_size',{simple:true})<64*1024*1024);f.api.closeDbForMaintenance();assert.equal(next.open,false);
});
test('maintenance/test reset with no retained original is idempotent',()=>{const f=owner();f.api.closeDbForMaintenance();f.api.resetDbForTest();assert.equal(f.state.constructed.length,0);assert.equal(f.api.inspect().writeCount,0);});
