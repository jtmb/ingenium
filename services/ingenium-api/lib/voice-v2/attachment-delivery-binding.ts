import {getDb,checkpointAfterWrite} from "ingenium-core";
import {createAttachmentDeliveryOwner,type AttachmentInput,type AttachmentAck} from "./attachment-delivery-owner.mjs";
import {assertHostedVoiceAttachment,type HostedVoiceRequestContext} from "./request-context.js";
/** One metadata repository over Core's EXISTING connection. This starts no call,
 * queue, runtime, model or subscription and accepts no request-supplied ports. */
export function createActualAttachmentDeliveryOwner(){
 const owner=createAttachmentDeliveryOwner<HostedVoiceRequestContext>({db:()=>getDb(),assertContext:assertHostedVoiceAttachment});
 return Object.freeze({
  reserve(context:HostedVoiceRequestContext,input:AttachmentInput){const value=owner.reserve(context,input);if(value.fresh)checkpointAfterWrite();return value;},
  claim:(handle:object)=>owner.claim(handle),
  acknowledge(handle:object,ack:AttachmentAck){const value=owner.acknowledge(handle,ack);checkpointAfterWrite();return value;},
  unknown(handle:object){const value=owner.unknown(handle);checkpointAfterWrite();return value;},
  read:(context:HostedVoiceRequestContext,input:AttachmentInput)=>owner.read(context,input),
 });
}
