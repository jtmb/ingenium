import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {planTextSpeech,sourceDigest,ORIGINAL_SEGMENTER_MODULE_URL} from '../../../../packages/veyra-voice/segments.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
export const ATTACHED_SPEECH_POLICY_ID='verbatim-assistant-text-v1';
// Root explicitly approved this fixed policy. It intentionally preserves the
// assistant's text, NOT credential redaction. No configured/caller callback.
function fixedVerbatimProjection(original){
 if(typeof original!=='string'||!original.length||[...original].length>32000||Buffer.byteLength(original)>128000
  ||Buffer.from(original).toString()!==original||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(original))throw Error('CALL_POLICY_TEXT_INVALID');
 return original.replaceAll('\r','\n');
}
export const ATTACHED_SPEECH_POLICY_SHA256=sha(Buffer.concat([Buffer.from(ATTACHED_SPEECH_POLICY_ID+'\0'+fixedVerbatimProjection.toString()+'\0'),readFileSync(new URL(import.meta.url))]));
export const ATTACHED_SPEECH_SEGMENTER_SHA256=sha(Buffer.concat([Buffer.from(planTextSpeech.toString()+'\0'+sourceDigest.toString()+'\0'),readFileSync(new URL(ORIGINAL_SEGMENTER_MODULE_URL))]));
/** Pure DATA projection. Only private call owner can turn actual read bytes into
 * an original plan. Exports accept no policy/redactor/segmenter/proof callbacks.
 */
export async function deriveAttachedVerbatimPlan(original){
 const projected=fixedVerbatimProjection(original),plan=await planTextSpeech(projected);
 if(plan.segments.length>512)throw Error('CALL_POLICY_SEGMENT_LIMIT');
 return Object.freeze({policyId:ATTACHED_SPEECH_POLICY_ID,policyImplementationSha256:ATTACHED_SPEECH_POLICY_SHA256,
  segmenterImplementationSha256:ATTACHED_SPEECH_SEGMENTER_SHA256,rawTextSha256:sha(Buffer.from(original)),rawBytes:Buffer.byteLength(original),
  projectedSha256:plan.sourceDigest,projectedBytes:plan.sourceBytes,segments:plan.segments});
}
