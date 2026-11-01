import test from 'node:test';import assert from 'node:assert/strict';
import {createPublishedCatalogPageReader} from '../src/app/components/customize-v2/published-catalog-reader.mjs';
import {installationLabel} from '../src/app/components/customize-v2/catalog.mjs';
const project='00000000-0000-4000-8000-000000000001',source='00000000-0000-4000-8000-000000000002',org='00000000-0000-4000-8000-000000000003',resource='00000000-0000-4000-8000-000000000004';
const binding={actorUserId:'owner',projectId:project,apiProject:'authorized-project',visibility:'public'};
function row(change={}){return {id:source,kind:'plugin',name:'qualified-plugin',description:'Real published source',visibility:'public',revision:1,sourceSha256:'a'.repeat(64),organizationId:org,connectNeedsProject:true,projectId:project,installed:false,enabled:false,archived:false,resourceId:null,targetName:null,resourceRevision:null,installedSourceSha256:null,connectionState:'available',actions:['connect'],...change};}
const page=(rows=[row()],extra={})=>({data:{projectId:project,kind:'plugin',visibility:'public',data:rows,next:null,...extra}});
test('uses only the actual session-owned endpoint and exact selected project; empty scope remains empty',async()=>{
 const calls=[],request=async path=>{calls.push(path);return page([])};assert.deepEqual(await createPublishedCatalogPageReader(request,binding)('plugin'),[]);const url=new URL(calls[0],'https://qualification.invalid');assert.equal(url.pathname,'/customize/catalog');assert.equal(url.searchParams.get('projectId'),project);assert.equal(url.searchParams.get('visibility'),'public');assert.equal(url.searchParams.has('ownerUserId'),false);
});
test('preserves exact installed IDs and disabled/archived states from the canonical projection',async()=>{
 const installed=row({installed:true,enabled:false,resourceId:resource,targetName:'connected-name',resourceRevision:3,installedSourceSha256:'a'.repeat(64),connectionState:'disabled',actions:['review']});const [entry]=await createPublishedCatalogPageReader(async()=>page([installed]),binding)('plugin');assert.equal(entry.installed,true);assert.equal(entry.apiProject,'authorized-project');assert.equal(entry.catalog.resourceId,resource);assert.equal(installationLabel(entry),'Installed · disabled');
});
test('a pending skill proposal is not labelled installed',async()=>{
 const pending=row({kind:'skill',connectionState:'proposal-review-required',actions:['review']});const [entry]=await createPublishedCatalogPageReader(async()=>page([pending],{kind:'skill'}),binding)('skill');assert.equal(entry.installed,false);assert.equal(installationLabel(entry),'Proposal review required');assert.equal(entry.apiProject,undefined);
});
for(const [name,change]of [['target',{projectId:'foreign'}],['scope',{visibility:'personal'}],['kind',{kind:'skill'}]])test('refuses a changed '+name+' without fallback',async()=>{
 let calls=0;await assert.rejects(createPublishedCatalogPageReader(async()=>{calls++;return page(undefined,change)},binding)('plugin'));assert.equal(calls,1);
});
for(const [name,change]of [['unbacked installed',{installed:true}],['enabled available',{enabled:true}],['wrong resource id',{installed:true,enabled:true,resourceId:'invented',targetName:'name',resourceRevision:1,installedSourceSha256:'a'.repeat(64),connectionState:'installed'}],['bad source hash',{sourceSha256:'not-a-hash'}],['scope confusion',{visibility:'personal'}],['extra action',{actions:['execute']}],['invented project',{projectId:'foreign'}]])test('refuses '+name+' rather than displaying a false installation',async()=>{
 await assert.rejects(createPublishedCatalogPageReader(async()=>page([row(change)]),binding)('plugin'));
});
test('rejects a repeated source or non-advancing cursor',async()=>{
 const read=createPublishedCatalogPageReader(async()=>page([row()],{next:source}),binding);await assert.rejects(read('plugin'));
});
test('does not fall back after the actual source endpoint denies access',async()=>{
 let calls=0;await assert.rejects(createPublishedCatalogPageReader(async()=>{calls++;throw Error('403')},binding)('plugin'));assert.equal(calls,1);
});
