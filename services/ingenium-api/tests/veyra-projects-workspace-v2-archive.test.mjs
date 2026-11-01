// AUTHORED UNRUN. Synthetic tar/data controls, never an image/producer qualification.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {verifyWorkspaceArchive,workspaceV2ImageDefinition} from '../lib/projects-v2/workspace-v2-image.mjs';
function fixture(){
 const body=Buffer.from('exact bootstrap fixture\n'),expected={path:'/app/scripts/runtime-entrypoint.sh',sha256:createHash('sha256').update(body).digest('hex'),bytes:body.length,uid:0,gid:0,mode:0o755,kind:'file'},header=Buffer.alloc(512);
 const field=(offset,length,text)=>header.write(text,offset,length,'ascii');
 const oct=(offset,length,n)=>field(offset,length,n.toString(8).padStart(length-1,'0')+'\0');
 field(0,100,'runtime-entrypoint.sh');oct(100,8,expected.mode);oct(108,8,0);oct(116,8,0);oct(124,12,body.length);oct(136,12,0);header.fill(32,148,156);header[156]=48;field(257,6,'ustar\0');field(263,2,'00');
 const checksum=header.reduce((a,b)=>a+b,0);field(148,8,checksum.toString(8).padStart(6,'0')+'\0 ');
 const bytes=Buffer.alloc(512+Math.ceil(body.length/512)*512+1024);header.copy(bytes);body.copy(bytes,512);return {bytes,expected};
}
function checksum(bytes){bytes.fill(32,148,156);const sum=bytes.subarray(0,512).reduce((a,b)=>a+b,0);bytes.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');}
test('strict actual archive consumer accepts exactly the expected raw file',()=>{const f=fixture();assert.deepEqual(verifyWorkspaceArchive(f.bytes,f.expected),{path:f.expected.path,sha256:f.expected.sha256,bytes:f.expected.bytes});});
for(const [name,mutate]of[
 ['content mismatch',f=>{f.bytes[512]^=1;}],['checksum fault',f=>{f.bytes[10]^=1;}],
 ['wrong owner',f=>{f.bytes.write('0000001\0',108,8);checksum(f.bytes);}],
 ['symlink',f=>{f.bytes[156]=50;checksum(f.bytes);}],['PAX extension',f=>{f.bytes[156]=120;checksum(f.bytes);}],
 ['foreign name',f=>{f.bytes.fill(0,0,100);f.bytes.write('../runtime-entrypoint.sh',0);checksum(f.bytes);}],
 ['writable artifact',f=>{f.bytes.write('0000777\0',100,8);checksum(f.bytes);}],
 ['non-ustar',f=>{f.bytes.fill(0,257,263);checksum(f.bytes);}],
 ['truncated',f=>{f.bytes=f.bytes.subarray(0,f.bytes.length-1);}],
 ['duplicate file',f=>{f.bytes=Buffer.concat([f.bytes.subarray(0,1024),f.bytes]);}],
 ['trailing nonzero data',f=>{f.bytes[f.bytes.length-1]=1;}],
])test(name+' refuses without producing a measurement',()=>{const f=fixture();mutate(f);assert.throws(()=>verifyWorkspaceArchive(f.bytes,f.expected));});
test('marker/DTO/current-label assertions cannot stand in for existing independent qualification',()=>{
 for(const value of [{},{qualified:true},{schemaVersion:2,projectId:null,workspaceRuntimeV2:{ready:true}},{schemaVersion:1,format:'core126-immutable-image-qualification',workspaceRuntimeV2:{schemaVersion:2}}])assert.throws(()=>workspaceV2ImageDefinition(value,{imageId:'sha256:'+'a'.repeat(64),validUntil:Date.now()+60000}));
});
