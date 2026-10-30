/** Pure actual-schema controls only; no database, auth/session fixture or live server. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const app=process.env.CUSTOMIZE_ACCEPTANCE_APP_SOURCE??'/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/prd-ui-fixes';
const z=createRequire(import.meta.url)(app+'/node_modules/zod').z;
const source=fs.readFileSync(here+'/files/packages/ingenium-core/lib/tools/customize-catalog-owner.ts','utf8');
const start=source.indexOf('const id='),end=source.indexOf('export class CustomizeCatalogRefusal');assert.ok(start>0&&end>start);
const schema=Function('z',source.slice(start,end).replace('export const CatalogCommandSchema','const CatalogCommandSchema')+'\nreturn CatalogCommandSchema;')(z);
const id='10000000-0000-4000-8000-000000000001',operationId='10000000-0000-4000-8000-000000000002',sourceId='10000000-0000-4000-8000-000000000003',sourceSha256='a'.repeat(64);
test('actual publish schema requires reviewed source and explicit real scope selectors',()=>{
 const value={operationId,op:'publish',projectId:id,kind:'plugin',name:'sample',expectedRevision:0,sourceSha256,visibility:'personal'};assert.deepEqual(schema.parse(value),value);
 for(const altered of [{...value,projectId:''},{...value,sourceSha256:'ok'},{...value,visibility:'private'},{...value,expectedRevision:-1},{...value,expectedRevision:Number.MAX_SAFE_INTEGER+1}])assert.equal(schema.safeParse(altered).success,false);
});
test('actual connect schema cannot smuggle a principal, credential, proof flag or executable endpoint',()=>{
 const value={operationId,op:'connect',sourceId,expectedRevision:1,sourceSha256,projectId:id,targetName:'copy'};assert.deepEqual(schema.parse(value),value);
 for(const extra of [{actorId:id},{session:{id}},{credential:'secret'},{nativeProof:true},{endpoint:'https://unreviewed.invalid'}])assert.equal(schema.safeParse({...value,...extra}).success,false);
 for(const targetName of ['../escape','a/b','a\\b','', 'x'.repeat(65)])assert.equal(schema.safeParse({...value,targetName}).success,false);
});
test('plugin lifecycle requires an original operation ID and current target revision',()=>{
 for(const op of ['archive-plugin','restore-plugin','activate-plugin','deactivate-plugin']){
  const value={operationId,op,projectId:id,name:'plugin',expectedRevision:2};assert.deepEqual(schema.parse(value),value);
  const {operationId:ignored,...missing}=value;assert.equal(schema.safeParse(missing).success,false);
  assert.equal(schema.safeParse({...value,expectedRevision:0.5}).success,false);
 }
});test('source restore and edits keep a reviewed immutable predecessor contract',()=>{
 const restored={operationId,op:'restore-source',sourceId,expectedRevision:2};assert.deepEqual(schema.parse(restored),restored);
 const edit={operationId,op:'revise-plugin-source',sourceId,expectedRevision:2,sourceSha256,description:'Reviewed source',source:'export default async () => ({});\r\n'};assert.deepEqual(schema.parse(edit),edit);
 assert.equal(schema.safeParse({...edit,description:'unsafe\0description'}).success,false);
 assert.equal(schema.safeParse({...edit,credentialItemId:id}).success,false);
});
