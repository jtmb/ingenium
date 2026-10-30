import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
const here=new URL('./',import.meta.url),manifest=JSON.parse(readFileSync(new URL('inputs.json',here)));
const write=process.argv.includes('--write-fixtures'),receipt=process.argv[process.argv.indexOf('--receipt')+1];
assert.ok(process.argv.includes('--receipt'));
const approved='/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/coordination/projects';
assert.equal(realpathSync(path.dirname(receipt)),approved);assert.equal(path.basename(receipt),'native-web-parity.json');
const sources=new Map();
for(const item of manifest.upstream){
 const response=await fetch(item.url);assert.equal(response.status,200);
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,item.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,'pinned source drift: '+item.path);
 sources.set(item.path,bytes.toString('utf8'));
}
const mimeSource=sources.get('packages/core/src/mime.ts').replace('export * as Mime from "./mime.js"','');
const {detect}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(mimeSource)).toString('base64'));
const prompt=sources.get('packages/core/src/session/prompt.ts');
const selectExpression=prompt.match(/const content =([\s\S]+?)\n  const normalized =/)?.[1];
assert.ok(selectExpression);
const select=new Function('resolved','mime','return ('+selectExpression.trim()+')');
const positiveSource=prompt.slice(prompt.indexOf('function positiveInt('));
const {positiveInt}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(positiveSource+'\nexport {positiveInt};')).toString('base64'));
const projection=sources.get('packages/core/src/session/runner/to-llm-message.ts');
const prelude=projection.slice(projection.indexOf('const imageMimes'),projection.indexOf('const decodeToolInput'));
const actualProjection=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes('import {fileURLToPath} from "node:url";const Message={text:text=>({type:"text",text})};\n'+prelude+'\nexport {attachmentContent,userAttachmentContent};')).toString('base64'));
let cases=[];
const check=(name,fn)=>{fn();cases.push({name,passed:true});};
const samples=[
 ['empty',[],'text/plain'],['ASCII',Buffer.from('plain'),'text/plain'],['PNG',Buffer.from('89504e470d0a1a0a','hex'),'image/png'],
 ['JPEG',[255,216,255],'image/jpeg'],['GIF',Buffer.from('GIF8'),'image/gif'],['BMP',Buffer.from('BM'),'image/bmp'],['PDF',Buffer.from('%PDF-'),'application/pdf'],
 ['WebP',Buffer.from('RIFF0000WEBP'),'image/webp'],['AVIF',Buffer.from('0000ftypavif'),'image/avif'],['AVIS',Buffer.from('0000ftypavis'),'image/avif'],
 ['NUL',[65,0,66],'application/octet-stream'],['invalid UTF8',[255],'application/octet-stream'],['incomplete accepted UTF8',[0xe2,0x82],'text/plain'],
 ['invalid prefix plus incomplete',[255,0xe2],'application/octet-stream'],['thirty percent controls',[1,2,3,65,65,65,65,65,65,65],'text/plain'],
 ['over thirty percent controls',[1,2,3,4,65,65,65,65,65,65],'application/octet-stream'],['CRLF tabs',[9,10,11,12,13],'text/plain'],
 ['UTF8 astral',Buffer.from('😀'),'text/plain'],['UTF8 overlong',[0xc0,0x80],'application/octet-stream'],['UTF8 surrogate',[0xed,0xa0,0x80],'application/octet-stream'],
 ['truncated PNG',[137,80,78,71],'application/octet-stream'],['short RIFF',Buffer.from('RIFF'),'text/plain'],['partial UTF8 after NUL',[0,0xe2],'application/octet-stream']
];
const mime=samples.map(([name,input,expected])=>{const bytes=Buffer.from(input);check('pinned MIME '+name,()=>assert.equal(detect(bytes),expected));return {name,base64:bytes.toString('base64'),mime:expected};});
const selectionInputs=[
 ['CRLF inclusive source lines',Buffer.from('a\r\nb\r\nc\n'),'text/plain',2,3],
 ['trailing empty',Buffer.from('a\nb\n'),'text/plain',3,undefined],
 ['end without start ignored',Buffer.from('a\nb'),'text/plain',undefined,1],
 ['end before start empty',Buffer.from('a\nb'),'text/plain',2,1],
 ['incomplete UTF8 selected replacement',Buffer.from([0xe2,0x82]),'text/plain',1,1],
 ['incomplete without range exact',Buffer.from([0xe2,0x82]),'text/plain',undefined,undefined],
 ['image range ignored',Buffer.from('GIF8'),'image/gif',2,3],
 ['zero start becomes absent',Buffer.from('a\nb'),'text/plain',0,1],
 ['zero end becomes absent',Buffer.from('a\nb'),'text/plain',1,0],
 ['huge start empty',Buffer.from('a\nb'),'text/plain',9007199254740991,undefined]
];
const selection=selectionInputs.map(([name,bytes,mime,start,end])=>{const value=Buffer.from(select({bytes,start:start===undefined?undefined:positiveInt(String(start)),end:end===undefined?undefined:positiveInt(String(end))},mime));check('pinned selection '+name,()=>{assert.ok(value.length<=bytes.length+3);if(mime!=='text/plain'||start===undefined)assert.deepEqual(value,bytes);});return {name,base64:bytes.toString('base64'),mime,start:start??null,end:end??null,selectedBase64:value.toString('base64')};});
const file={data:Buffer.from('a.txt\nsub/').toString('base64'),name:'folder',source:{type:'uri',uri:'file:///private/folder'},mime:'application/x-directory'};
check('real directory projection differs from inline text relabel',()=>{
 const before=actualProjection.attachmentContent(file),after=actualProjection.attachmentContent({...file,mime:detect(Buffer.from(file.data,'base64')),source:{type:'inline'}});
 assert.match(before[0].text,/Attached directory: \/private\/folder/);assert.match(after[0].text,/Attached file: folder/);assert.notDeepEqual(before,after);
});
check('real media source URI header is lost by raw inline transformation',()=>{
 const input={...file,data:Buffer.from([255,216,255]).toString('base64'),mime:'image/jpeg',name:'a.jpg',source:{type:'uri',uri:'file:///private/a.jpg'}};
 assert.equal(actualProjection.attachmentContent(input).length,2);assert.equal(actualProjection.attachmentContent({...input,source:{type:'inline'}}).length,1);
});
check('real inline-image mention dedup differs from URI sources',()=>{
 const input={...file,mime:'image/png',mention:{start:0,end:1,text:'@x'},source:{type:'inline'}};
 assert.equal(actualProjection.userAttachmentContent([input,input]).length,1);
 assert.equal(actualProjection.userAttachmentContent([{...input,source:{type:'uri',uri:'file:///private/x'}},{...input,source:{type:'uri',uri:'file:///private/x'}}]).length,4);
});
check('raw BMP/AVIF/octetstream are ignored by pinned provider projector',()=>{for(const mime of ['image/bmp','image/avif','application/octet-stream'])assert.deepEqual(actualProjection.attachmentContent({...file,mime}),[]);});
const mib=1024n*1024n,sourceBytes=20n*mib,base64=4n*((sourceBytes+2n)/3n),aggregate=64n*mib;
check('single 20MiB base64 exceeds both existing wire and WSL caps',()=>{assert.equal(base64,27962028n);assert.ok(base64>16n*mib);assert.ok(base64>24n*mib);assert.ok(base64<32n*mib);});
check('full distinct success ack plus source and effective wire exceed 64MiB',()=>assert.ok(sourceBytes+2n*base64>aggregate));
check('upstream has no file-array batch guard and materializes concurrency8',()=>{assert.match(prompt,/concurrency: 8/);assert.match(sources.get('packages/schema/src/prompt-input.ts'),/files: Schema.Array\(FileAttachment\).pipe\(optional\)/);assert.match(sources.get('packages/protocol/src/groups/session.ts'),/success: Schema.Struct\(\{ data: SessionInbox.User \}\)/);});
const fixtures={pinnedCommit:'9eb6902aaf3c35ce985b67c605a775992249066b',mime,selection};
const fixtureURL=new URL('sources/crates/adapters/src/opencode/attachments/web-file-compat-fixtures.json',here);
if(write)writeFileSync(fixtureURL,JSON.stringify(fixtures,null,2)+'\n');else assert.deepEqual(JSON.parse(readFileSync(fixtureURL)),fixtures);
const result={passed:cases.length,failed:0,cases,fixtureSha256:createHash('sha256').update(readFileSync(fixtureURL)).digest('hex'),evidenceClass:'direct exact-SHA pinned pure MIME/selection/provider projection; static schema resource facts; no engine/backend/Rust build',resource:{single20MiBSource:Number(sourceBytes),base64Bytes:Number(base64),threeDistinctBlobLowerBound:Number(sourceBytes+2n*base64),aggregate:Number(aggregate),ackReservationRequired:true},cleanup:{generatedBulkBytes:0,fixtureDirectoriesCreated:[],removedPaths:[],removedBytes:0,retained:'Canonical golden/source/patch/test and this in-place receipt for Root application/review',windowsRecoveredBytes:0}};
writeFileSync(receipt,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.passed,failed:0,resource:result.resource}));
