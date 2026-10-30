import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createRequire} from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url)),app=process.env.CUSTOMIZE_ACCEPTANCE_APP_SOURCE??'/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/prd-ui-fixes';
const ts=createRequire(import.meta.url)(app+'/node_modules/typescript/lib/typescript.js');
const source=fs.readFileSync(here+'/files/packages/ingenium-core/lib/tools/plugin-config-text.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {editPluginConfiguration:edit,parsePluginConfiguration:parse}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const target='plugins/owned.ts';
test('unchanged enable is byte-identical and retains list order',()=>{
 const text='{"plugins":["plugins/first.ts","plugins/owned.ts","plugins/last.ts"], "model" : "unchanged"}\n';
 assert.equal(edit(text,target,true),text);
});
test('JSONC/BOM/CRLF and unknown properties survive exact plugin-only edits',()=>{
 const outside='"model" : {"provider":"original", "nested":[1,2,],}, // keep model bytes';
 const text='\uFEFF{\r\n // header stays\r\n '+outside+'\r\n "plugins": [ // list annotation\r\n "plugins/old.ts", /* exact annotation */\r\n ],\r\n "tail": "untouched",\r\n}\r\n';
 const result=edit(text,target,true);assert.ok(result.startsWith('\uFEFF{\r\n'));assert.ok(result.includes(outside));assert.ok(result.endsWith(' "tail": "untouched",\r\n}\r\n'));
 for(const comment of ['// header stays','// list annotation','/* exact annotation */'])assert.equal(result.split(comment).length-1,1);
 assert.deepEqual(parse(result).plugins,['plugins/old.ts',target]);assert.deepEqual(parse(result).model,parse(text).model);
});
test('legacy property migration handles first/middle/last and trailing commas',()=>{
 for(const text of ['{"plugin":["old"],"x":1}','{"x":1,"plugin":["old"],"y":2}','{"x":1,"plugin":["old"]}','{"plugin":["old"],}','{/*head*/"plugin":[/*retained*/"old"]//tail\n}']){
  const result=edit(text,target,true),object=parse(result);assert.deepEqual(object.plugins,['old',target]);assert.equal(Object.hasOwn(object,'plugin'),false);assert.equal(object.x,parse(text).x);assert.equal(object.y,parse(text).y);
  if(text.includes('/*retained*/'))assert.ok(result.includes('/*retained*/'));
 }
});
test('both lists merge without replacing unrelated options or dropping comments',()=>{
 const text='{"plugin":["old",/*legacy annotation*/["package",{"flag":true}]],"plugins":["old",/*modern annotation*/"new"],"other": { "bytes" : "same" }}';
 const result=edit(text,target,true);assert.deepEqual(parse(result).plugins,['old','new',['package',{flag:true}],target]);
 assert.ok(result.includes('"other": { "bytes" : "same" }'));assert.ok(result.includes('/*legacy annotation*/'));assert.ok(result.includes('/*modern annotation*/'));
});
test('removal preserves remaining semantics and reaches a stable no-op',()=>{
 const text='{"plugins":["one","plugins/owned.ts","two"],"x":3}',result=edit(text,target,false);assert.deepEqual(parse(result),{plugins:['one','two'],x:3});assert.equal(edit(result,target,false),result);
});
test('string literals containing comment markers, escapes and brackets are not comments',()=>{
 const text=JSON.stringify({literal:'//not a comment /*nor this*/ " } ] \\',plugins:['https://catalog.invalid/package']});
 const result=edit(text,target,true);assert.equal(parse(result).literal,parse(text).literal);assert.deepEqual(parse(result).plugins,['https://catalog.invalid/package',target]);
});
test('malformed, duplicate and nonobject configurations refuse before any edit',()=>{
 for(const text of ['null','[]','{"plugins":[],"plugins":[]}','{"x":1,"x":2}','{,}','{"plugins":[,]}','{"plugins":["x",,]}','{/*unclosed','{"plugins":["unclosed]}','{"plugins":"not-array"}'])assert.throws(()=>edit(text,target,true));
});
test('only a contained original plugin projection path is accepted',()=>{
 for(const rel of ['https://evil.invalid','/plugins/root.ts','plugins/../escape','plugins//empty','plugins/./dot','plugins/bad\0.ts'])assert.throws(()=>edit('{}',rel,true));
 assert.deepEqual(parse(edit('{}','.opencode/plugins/owned.ts',true)).plugins,['.opencode/plugins/owned.ts']);
});