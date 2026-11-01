export interface SavedHistoryScope {instanceId:string;organizationId:string;ownerUserId:string}
export interface SavedHistoryConversation {version:1;kind:'saved-workspace-chat';id:string;scope:SavedHistoryScope;title:string;createdAt:string;revision:number;archived:boolean;source:{workspaceId:string;runtimeId:string;executionGeneration:string;engineSessionId:string;snapshotHash:string}}
export interface SavedHistoryMessage {id:string;sequence:number;role:'user'|'assistant';content:string;contentHash:string;createdAt:string;sourceMessageId:string}
export interface SavedHistoryPage {conversation:SavedHistoryConversation;messages:SavedHistoryMessage[];pagination:{hasMore:boolean;afterSequence:number};verifiedContentBytes:number;serializedMessageBytes:number}
