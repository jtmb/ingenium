import type { MemoryScope } from './lifecycle.mjs';
export interface ExpectedMemoryBinding {readonly scopeHash:string;readonly bindingHash:string;readonly bindingEpoch:number;readonly contextConversationId:string}
export function expectedMemoryBinding(getHeader:(name:string)=>string|undefined):Readonly<ExpectedMemoryBinding>|null;
export function assertExpectedMemoryBinding(expected:Readonly<ExpectedMemoryBinding>|null,scope:MemoryScope,contextConversationId:string):void;
