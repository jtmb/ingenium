import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const relative='packages/ingenium-core/lib/db.ts';
const expected='935061fb2e140e0f72da6854d4ae813c957e2aabe61e3c5377ab13f01ade9e31';
const sha=s=>createHash('sha256').update(s).digest('hex');
export function proposal(app){
 const ts=createRequire(app+'/package.json')('typescript'),path=app+'/'+relative,source=readFileSync(path,'utf8');
 if(sha(source)!==expected)throw Error('ACTUAL_DB_PREIMAGE_CHANGED: re-review exact original, do not force apply');
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 function method(name){const n=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);if(!n)throw Error('Actual method missing: '+name);return source.slice(n.getStart(ast),n.end);}
 const custody=readFileSync(new URL('./bootstrap-custody.ts',import.meta.url),'utf8').split('\n').slice(2).join('\n').trimEnd();
 const getDb=readFileSync(new URL('./getDb.ts',import.meta.url),'utf8').trimEnd();
 const close=readFileSync(new URL('./closeDbForMaintenance.ts',import.meta.url),'utf8').split('\n').slice(1).join('\n').trimEnd();
 const replacements=[{old:'let db: Database.Database | null = null;',next:'let db: Database.Database | null = null;\n\n'+custody},{old:method('getDb'),next:getDb},{old:method('closeDbForMaintenance'),next:close}];
 let patched=source,delta=0,patch='--- a/'+relative+'\n+++ b/'+relative+'\n';
 for(const r of replacements){
  const start=source.indexOf(r.old);if(start<0||source.indexOf(r.old,start+1)>=0)throw Error('Nonunique exact anchor');
  const line=source.slice(0,start).split('\n').length,oldLines=r.old.split('\n'),newLines=r.next.split('\n'),all=source.split('\n');
  const before=all.slice(line-4,line-1),after=all.slice(line-1+oldLines.length,line-1+oldLines.length+3);
  patch+=`@@ -${line-before.length},${before.length+oldLines.length+after.length} +${line+delta-before.length},${before.length+newLines.length+after.length} @@\n`+before.map(l=>' '+l+'\n').join('')+oldLines.map(l=>'-'+l+'\n').join('')+newLines.map(l=>'+'+l+'\n').join('')+after.map(l=>' '+l+'\n').join('');
  delta+=newLines.length-oldLines.length;patched=patched.replace(r.old,r.next);
 }
 const gate='const isRootRestoreMaintenance = process.env.INGENIUM_RESTORE_MAINTENANCE_MODE === "execute"\n';
 if(!source.includes(gate)||!patched.includes(gate)||!patched.includes('&& typeof process.getuid === "function" && process.getuid() === 0;'))throw Error('Restore maintenance gate changed');
 return {ts,path,source,patched,patch,custody,getDb,close,reset:method('resetDbForTest'),preimage:{path:relative,sha256:sha(source),postSha256:sha(patched),restorationGateUnchanged:true,sourceCommitObserved:'95161a99d216af6461b4ed240931d3a0fa47ad8f'}};
}
if(process.argv[2]==='--write'){
 const p=proposal(process.env.VEYRA_SOURCE_APP);writeFileSync(new URL('./bootstrap-custody.patch',import.meta.url),p.patch);writeFileSync(new URL('./preimages.json',import.meta.url),JSON.stringify(p.preimage,null,2)+'\n');console.log(JSON.stringify(p.preimage));
}
