import {parseUniqueRawJson} from './raw-assistant-wire.mjs';
const fail=code=>{throw Object.assign(Error(code),{code});};
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys,optional=[])=>object(v)&&keys.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>[...keys,...optional].includes(k));
const id=v=>typeof v==='string'&&v.length>0&&v.length<=128&&!/[\u0000-\u001f\u007f]/u.test(v);
/** Pure pinned2.0.11 admission ACK validation. No execution/retirement proof. */
export function assertAttachedPromptInboxAck(response,{sessionId,messageId,text,delivery}){
 const ack=response?.data;
 if(!exact(response,['data'])||!exact(ack,['id','sessionID','time','type','payload','delivery'])||ack.type!=='user'||ack.id!==messageId||ack.sessionID!==sessionId||ack.delivery!==delivery
  ||!['queue','steer'].includes(delivery)||!exact(ack.time,['created'])||!Number.isSafeInteger(ack.time.created)||ack.time.created<0
  ||!exact(ack.payload,['text'],['files','agents','skills','metadata'])||ack.payload.text!==text
  ||['files','agents','skills'].some(k=>ack.payload[k]!==undefined&&(!Array.isArray(ack.payload[k])||ack.payload[k].length))
  ||ack.payload.metadata!==undefined&&(!object(ack.payload.metadata)||Object.keys(ack.payload.metadata).length))fail('CALL_MESSAGE_DELIVERY_UNKNOWN');
}
/** Pure DATA event projection. Pinned feed frames contain one JSON event, no
 * SSE id line, no server-side session query/replay. Never trust event text as a
 * source/plan: only use returned actual messageId to trigger a fresh raw read.
 */
export function parseSelectedCallEvent(block,sessionId,directory){
 if(typeof block!=='string'||Buffer.byteLength(block)>262144)fail('CALL_EVENT_BOUND');
 const lines=block.split('\n');if(lines.some(line=>line&&!line.startsWith(':')&&!line.startsWith('data:')))fail('CALL_EVENT_FRAMING');
 const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /u,'')).join('\n');if(!data)return null;
 const event=parseUniqueRawJson(Buffer.from(data));
 if(!object(event)||!id(event.type)||!object(event.data))fail('CALL_EVENT_PROTOCOL');
 if(event.type==='server.connected')return null;
 if(!event.type.startsWith('session.')||event.data.sessionID!==sessionId)return null;
 if(event.location!==undefined&&(!exact(event.location,['directory'])||event.location.directory!==directory))return null;
 if(!id(event.id)||!event.id.startsWith('evt_'))fail('CALL_EVENT_PROTOCOL');
 let assistantMessageId;
 if(event.type==='session.text.ended'){
  if(!exact(event.data,['sessionID','assistantMessageID','ordinal','text'],['state'])||!id(event.data.assistantMessageID)||!event.data.assistantMessageID.startsWith('msg_')
   ||!Number.isSafeInteger(event.data.ordinal)||event.data.ordinal<0||typeof event.data.text!=='string'||[...event.data.text].length>32000)fail('CALL_EVENT_PROTOCOL');
  assistantMessageId=event.data.assistantMessageID;
 }
 return Object.freeze({eventId:event.id,type:event.type,sessionId,...(assistantMessageId?{assistantMessageId}:{}),agentSettlementProof:false});
}
