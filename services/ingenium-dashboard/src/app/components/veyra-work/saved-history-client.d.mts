import type {SavedHistoryConversation,SavedHistoryPage}from '../../../../../../packages/veyra-projects/saved-history.mjs';
export type {SavedHistoryConversation,SavedHistoryMessage,SavedHistoryPage}from '../../../../../../packages/veyra-projects/saved-history.mjs';
export interface SavedHistoryList {data:SavedHistoryConversation[];pagination:{hasMore:boolean;afterCreatedAt:string;afterId:string}}
export interface SavedHistoryClient {list(options?:{workspaceId?:string|null;includeArchived?:boolean;afterCreatedAt?:string;afterId?:string}):Promise<SavedHistoryList>;get(id:string,options?:{afterSequence?:number;expectedRevision?:number}):Promise<SavedHistoryPage>}
export function createSavedHistoryClient(request:<T>(path:string,options?:RequestInit)=>Promise<T>,scope:{ownerUserId:string;organizationId:string}):SavedHistoryClient;
