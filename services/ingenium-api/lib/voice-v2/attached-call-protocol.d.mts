export function assertAttachedPromptInboxAck(response:unknown,expected:{sessionId:string;messageId:string;text:string;delivery:'queue'|'steer'}):void;
export interface SelectedCallEvent {readonly eventId:string;readonly type:string;readonly sessionId:string;readonly assistantMessageId?:string;readonly agentSettlementProof:false}
export function parseSelectedCallEvent(block:string,sessionId:string,directory:string):SelectedCallEvent|null;
