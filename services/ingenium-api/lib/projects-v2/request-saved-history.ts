/** Original browser/private-data owner. Saved metadata never grants execution. */
import type {Request}from'express';
import {getDb,authorization}from'ingenium-core';
import {revalidateRequestIdentity}from'../request-identity.js';
import {toAuthorizationPrincipal}from'../authorization-policy.js';
import {listSavedWorkspaceHistory,readSavedWorkspaceHistory,type SavedHistoryScope}from'./saved-history-store.mjs';
function fail(code:string,status:number):never{throw Object.assign(Error(code),{code,status})}
function current(request:Request,organizationId:string){
 const identity=revalidateRequestIdentity(request);
 if(identity?.principal.type!=='user'||!identity.principal.session)fail('SAVED_HISTORY_BROWSER_SESSION_REQUIRED',401);
 const principal=toAuthorizationPrincipal(identity.principal),db=getDb(process.env.INGENIUM_CORE_DB_PATH);
 if(!db.prepare("SELECT 1 FROM organizations WHERE id=? AND status='active'").get(organizationId))fail('SAVED_HISTORY_UNAVAILABLE',404);
 if(!authorization.requireOrganizationPermission(principal,organizationId,'context','read').allowed)fail('SAVED_HISTORY_UNAVAILABLE',404);
 const row=db.prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get()as{instance_id:string}|undefined;
 if(!row||!/^[a-f0-9]{32}$/.test(row.instance_id))fail('SAVED_HISTORY_INSTALLATION_UNAVAILABLE',503);
 const scope:SavedHistoryScope=Object.freeze({instanceId:row.instance_id,organizationId,ownerUserId:identity.principal.id});
 return {db,scope,key:JSON.stringify([scope,identity.principal.session.id,identity.principal.session.security_epoch])};
}
function read<T>(request:Request,organizationId:string,operation:(db:ReturnType<typeof getDb>,scope:SavedHistoryScope)=>T):T{
 const first=current(request,organizationId);
 const snapshot=()=>{const before=current(request,organizationId);if(before.db!==first.db||before.key!==first.key)fail('SAVED_HISTORY_IDENTITY_CHANGED',409);const result=operation(first.db,before.scope);if(current(request,organizationId).key!==before.key)fail('SAVED_HISTORY_IDENTITY_CHANGED',409);return result};
 // Join the existing original snapshot or establish a read transaction on the
 // same handle. This reader adds no mutation, engine request, writer or await.
 return first.db.inTransaction?snapshot():first.db.transaction(snapshot).deferred();
}
export function listRequestSavedHistory(request:Request,organizationId:string,options:{workspaceId?:string|null;afterCreatedAt?:string;afterId?:string;limit?:number;includeArchived?:boolean}={}){return read(request,organizationId,(db,scope)=>listSavedWorkspaceHistory(db,scope,options))}
export function readRequestSavedHistory(request:Request,organizationId:string,id:string,options:{expectedRevision?:number;afterSequence?:number;limit?:number}={}){return read(request,organizationId,(db,scope)=>readSavedWorkspaceHistory(db,scope,id,options))}
