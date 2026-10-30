import fs from 'node:fs';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';import {createHash} from 'node:crypto';
const root=process.env.DOT_FENCE_REVIEW_ROOT;if(!root?.startsWith('/'))throw Error('Explicit existing read-only integration root required');
const sqlPath=resolve(root,'packages/ingenium-core/data/migrations/130_dot_original_dispatch_fence.sql'),sha=v=>createHash('sha256').update(v).digest('hex');
let baseline=fs.readFileSync(sqlPath,'utf8');
// Retain a lossless historical recipe after Root's precise appended collision fix.
// This NEVER writes canonical SQL and NEVER represents current fixed source as defective.
if(sha(baseline)==='18027e08cbfd859eaaef1813785fef8b166c1632d6b76faf2f8ad2a0b19ff998')baseline=baseline.slice(0,baseline.indexOf('-- REPLACE may not invoke DELETE triggers')).trimEnd()+'\n';
if(sha(baseline)!=='fb94676ba942e87bbe781b2a8c4e72281181b8615620aa86e1631a65b38eb573')throw Error('Reviewed SQL130 preimage changed; re-review before running');
const fixtureURL=pathToFileURL(resolve(root,'packages/ingenium-core/tests/dot-original-dispatch-fence.test.mjs'));
let source=fs.readFileSync(fixtureURL,'utf8');source=source.slice(0,source.indexOf('\ntest(')).replaceAll('import.meta.url',JSON.stringify(fixtureURL.href));
source=source.replace('const sql=n=>readFileSync(',"const sql=n=>n==='130_dot_original_dispatch_fence.sql'?"+JSON.stringify(baseline)+':readFileSync(');
source+=String.raw`
test('review witness: REPLACE can erase a closed original operation and reopen/admit the same Run with recursive triggers off',t=>{
 const f=fixture();t.after(f.close);f.db.exec('PRAGMA recursive_triggers=OFF');assert.equal(f.db.prepare('PRAGMA recursive_triggers').get().recursive_triggers,0);
 f.owner.closeOriginalUnadmittedDotOperation(f.selection);assert.equal(f.read().managedDispatch.fence,'closed-unadmitted-v1');
 const body={...f.op};delete body.managedDispatch;
 f.db.prepare('INSERT OR REPLACE INTO veyra_dot_records(kind,id,organization_id,owner_user_id,scope_key,revision,body) VALUES(?,?,?,?,?,?,?)').run('operation',body.id,'org','owner',JSON.stringify(Object.values(f.scope)),body.revision,JSON.stringify(body));
 assert.equal(f.read().managedDispatch,undefined);
 f.db.exec("UPDATE job_runs SET status='running',finished_at=NULL WHERE id='run'");assert.equal(f.getRun().status,'running');f.insert();assert.equal(f.db.prepare('SELECT phase FROM job_run_managed_execution').get().phase,'prepared');
});
test('review witness: REPLACE bypasses UPDATE/DELETE guards on the original closed Run while its marker remains',t=>{
 const f=fixture();t.after(f.close);f.db.exec('PRAGMA recursive_triggers=OFF');f.owner.closeOriginalUnadmittedDotOperation(f.selection);
 const run={...f.getRun(),status:'running',finished_at:null};f.db.prepare('INSERT OR REPLACE INTO job_runs('+Object.keys(run).join(',')+') VALUES('+Object.keys(run).map(()=>'?').join(',')+')').run(...Object.values(run));
 assert.equal(f.read().managedDispatch.fence,'closed-unadmitted-v1');assert.equal(f.getRun().status,'running');assert.throws(()=>f.owner.closeOriginalUnadmittedDotOperation(f.selection));
});
`;
await import('data:text/javascript;base64,'+Buffer.from(source+'\n//# sourceURL=dot-dispatch-review-in-memory.mjs').toString('base64'));
