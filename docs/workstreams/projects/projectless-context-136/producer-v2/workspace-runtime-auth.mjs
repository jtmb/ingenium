/** Pure v2 domain-separated derivation, NOT an authorization owner.
 * Production callers supply only original credential custody and actual bound Core/birth facts. */
import {createHmac} from 'node:crypto';
export function deriveWorkspaceRuntimeOpenCodePasswordV2(token,s){
 const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),text=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f]/.test(v);
 if(typeof token!=='string'||!/^ing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}$/.test(token)||!s||s.projectId!==null||!['runtimeId','workspaceId','organizationId','ownerUserId','credentialId','requestId'].every(k=>text(s[k]))||!hex(s.bindingHash)||!hex(s.executionGeneration)||!Number.isSafeInteger(s.bindingEpoch)||s.bindingEpoch<0)throw Error('WORKSPACE_V2_AUTH_BINDING_UNAVAILABLE');
 const bytes=Buffer.from(token.slice(17),'base64url');if(bytes.length!==32)throw Error('WORKSPACE_V2_AUTH_CREDENTIAL');const userEpoch=bytes.readBigUInt64BE(0).toString();bytes.fill(0);
 const context=JSON.stringify([2,'workspace',null,s.organizationId,s.ownerUserId,userEpoch,s.workspaceId,s.runtimeId,s.credentialId,s.bindingHash,s.bindingEpoch,s.executionGeneration,s.requestId]);
 return createHmac('sha256',token).update('veyra/workspace-runtime-v2/opencode-basic-auth/v1\0').update(context,'utf8').digest('base64url');
}
