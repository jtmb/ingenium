import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {buildVoiceProposal} from './prepare-proposal.mjs';
const changes=buildVoiceProposal(process.argv[2]);
const patch=readFileSync(new URL('core-voice-owner.patch',import.meta.url),'utf8');
const manifest=JSON.parse(readFileSync(new URL('preimages.json',import.meta.url),'utf8'));
const digest=value=>createHash('sha256').update(value).digest('hex');
assert.equal(digest(patch),manifest.patchSha256);
const lines=patch.match(/[^\n]*\n|[^\n]+$/g)??[];let at=0;
for(const change of changes) {
 assert.equal(lines[at++],`--- ${change.newFile?'/dev/null':'a/'+change.path}\n`);assert.equal(lines[at++],`+++ b/${change.path}\n`);
 const original=change.before.match(/[^\n]*\n|[^\n]+$/g)??[],output=[];let cursor=0;
 while(at<lines.length&&!lines[at].startsWith('--- ')) {
  const header=lines[at++].match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);assert.ok(header);
  const oldCount=header[2]===undefined?1:Number(header[2]),newCount=header[4]===undefined?1:Number(header[4]);
  const start=Number(header[1])-(oldCount===0?0:1);assert.ok(start>=cursor);output.push(...original.slice(cursor,start));cursor=start;
  let oldSeen=0,newSeen=0;
  while(at<lines.length&&!lines[at].startsWith('@@ ')&&!lines[at].startsWith('--- ')) {
   const line=lines[at++],mark=line[0],text=line.slice(1);assert.ok([' ','-','+'].includes(mark));
   if(mark!=='+'){assert.equal(text,original[cursor++]);oldSeen++;}if(mark!=='-'){output.push(text);newSeen++;}
  }
  assert.equal(oldSeen,oldCount);assert.equal(newSeen,newCount);
 }
 output.push(...original.slice(cursor));assert.equal(output.join(''),change.after);
 const receipt=manifest.changes.find(c=>c.path===change.path);assert.ok(receipt);
 assert.equal(receipt.preimageSha256,change.newFile?null:digest(change.before));assert.equal(receipt.proposedSha256,digest(change.after));
}
assert.equal(at,lines.length);assert.equal(changes.length,manifest.changes.length);
console.log(JSON.stringify({checkedFiles:changes.length,exactInMemoryApply:true,patchSha256:manifest.patchSha256}));
