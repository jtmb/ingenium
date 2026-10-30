/** Concrete same-browser-user custody using EXISTING provider_connections and encrypted user vault item.
 * No schema/table/credential DB or service-token fallback. All raw secrets stay inside this module/reader.
 */
import type {Request} from "express";
import {createHash} from "node:crypto";
import {getDb,execTransaction,checkpointAfterWrite,vault,authorization,HostedRefusal,type HostedGovernanceSqlDb as SqlDb} from "ingenium-core";
import {authenticateRequestWithoutActivity} from "./middleware/auth.js";
import {toAuthorizationPrincipal} from "./authorization-policy.js";
import {createPairedNativeReader,decodePreparation,redeemNativePreparation,verifyRedeemed,type Preparation,type Redeemed,type PairedNativeCredential} from "./paired-native-reader.js";
import type {OriginalNativeConnectionCustody} from "./native-hosted-connection-owner.js";
type Principal={type:"user";id:string;scopes:readonly string[];session:unknown};
type Row=Record<string,any>;
type Config={kind:"node-native-pairing-v1";enrollmentRequestId:string;installationId:string;projectId:string;phase:"redeeming"|"verifying"|"paired"|"unknown"|"disabled";preparationItemId:string;preparationVersion:number;credentialVersion:number;firstFailureCode?:string};
type VaultOwner=Pick<typeof vault,"isSealed"|"decryptItem"|"updateItem">;
export interface NativePairingBackend {
 db():SqlDb;transaction<T>(work:()=>T):T;checkpoint():void;vault:VaultOwner;
 principal(req:Request):Principal;
 project(principal:Principal,projectId:string,permission:"read"|"write"):boolean;
 owned(principal:Principal,row:Row,kind:"vault_item"|"provider_connection",permission:"read"|"write"):boolean;
 redeem(preparation:Preparation,actor:string,installation:string,projectId:string,retain:(receipt:Redeemed)=>void):Promise<PairedNativeCredential>;
 verify(credential:Redeemed):Promise<PairedNativeCredential>;
 reader:typeof createPairedNativeReader;
}
function fail(code:string,status=409):never{throw new HostedRefusal(code,status);}
const object=(v:unknown):v is Row=>!!v&&typeof v==="object"&&!Array.isArray(v);
const identifier=(v:unknown):v is string=>typeof v==="string"&&/^[A-Za-z0-9][A-Za-z0-9:_-]{0,255}$/.test(v);
const DELETED='{"mode":"deleted"}',KIND="node-native-pairing-v1";
function defaultPrincipal(req:Request):Principal{
 authenticateRequestWithoutActivity(req);
 const p=req.principal;if(p?.type!=="user"||!p.session)fail("BROWSER_SESSION_REQUIRED",401);return p as Principal;
}
const defaults:NativePairingBackend={
 db:()=>getDb() as unknown as SqlDb,transaction:work=>execTransaction(work,1,"immediate"),checkpoint:checkpointAfterWrite,vault,
 principal:defaultPrincipal,
 project:(p,id,permission)=>authorization.requireProjectPermission(toAuthorizationPrincipal(p as any),id,"vault",permission).allowed
  &&authorization.requireProjectPermission(toAuthorizationPrincipal(p as any),id,"skills","read").allowed,
 owned:(p,row,kind,permission)=>row.owner_kind==="user"&&row.owner_user_id===p.id&&authorization.requireOwnedResourcePermission(toAuthorizationPrincipal(p as any),{
  resourceType:kind,resourceId:row.id,organizationId:row.organization_id,ownerKind:"user",ownerUserId:p.id},permission).allowed,
 redeem:redeemNativePreparation,verify:verifyRedeemed,reader:createPairedNativeReader
};
function config(row:Row):Config{
 let c:unknown;try{c=JSON.parse(row.config_json);}catch{return fail("PAIRING_RECORD_UNAVAILABLE",503);}
 if(!object(c)||c.kind!==KIND||!identifier(c.enrollmentRequestId)||!identifier(c.installationId)||!identifier(c.projectId)||!identifier(c.preparationItemId)||
 !Number.isSafeInteger(c.preparationVersion)||!Number.isSafeInteger(c.credentialVersion)||!["redeeming","verifying","paired","unknown","disabled"].includes(c.phase))return fail("PAIRING_RECORD_UNAVAILABLE",503);
 return c as Config;
}
function rowId(actor:string,installation:string,requestId:string){return "native-pair:"+createHash("sha256").update(JSON.stringify([actor,installation,requestId])).digest("hex");}
function metadata(row:Row){const c=config(row);return {enrollmentRequestId:c.enrollmentRequestId,custodyId:row.id,state:c.phase,revision:row.revision,...(c.firstFailureCode?{firstFailureCode:c.firstFailureCode}:{})};}
export function createNodeNativePairingOwner(request:Request,overrides:Partial<NativePairingBackend>={}){
 const backend:NativePairingBackend={...defaults,...overrides};
 function subject(){
  const p=backend.principal(request),installation=backend.db().prepare("SELECT instance_id FROM veyra_installation_identity WHERE singleton=1").get() as Row|undefined;
  if(!installation||!identifier(installation.instance_id))fail("HOST_IDENTITY_UNAVAILABLE",503);
  return {p,installation:installation.instance_id as string};
 }
 function vaultItem(id:string,p:Principal,permission:"read"|"write"){
  const item=backend.db().prepare("SELECT id,project_id,organization_id,owner_kind,owner_user_id,type,version,access_policy FROM vault_items WHERE id=? AND access_policy<>?").get(id,DELETED) as Row|undefined;
  if(!item||item.type!=="native-pairing-credential"||!backend.owned(p,item,"vault_item",permission)||!backend.project(p,item.project_id,permission))fail("NOT_FOUND",404);
  return item;
 }
 function connection(enrollmentRequestId:string){
  const s=subject(),id=rowId(s.p.id,s.installation,enrollmentRequestId);
  const row=backend.db().prepare("SELECT * FROM provider_connections WHERE id=? AND owner_kind='user' AND owner_user_id=? AND provider_type='native'").get(id,s.p.id) as Row|undefined;
  if(!row||!backend.owned(s.p,row,"provider_connection","read"))fail("NOT_FOUND",404);
  const c=config(row);if(c.installationId!==s.installation||c.enrollmentRequestId!==enrollmentRequestId||!backend.project(s.p,c.projectId,"read"))fail("NOT_FOUND",404);
  return {row,c,...s};
 }
 function plaintext(item:Row,p:Principal):Row{
  if(backend.vault.isSealed())fail("VAULT_SEALED",503);
  const text=backend.vault.decryptItem(item.project_id,item.id,{type:"user",id:p.id});
  if(text===null)fail("PAIR_CREDENTIAL_UNAVAILABLE",503);
  let value:unknown;try{value=JSON.parse(text);}catch{return fail("PAIR_CREDENTIAL_UNAVAILABLE",503);}if(!object(value))fail("PAIR_CREDENTIAL_UNAVAILABLE",503);return value;
 }
 function change(row:Row,c:Config,enabled:number){
  const changed=backend.db().prepare("UPDATE provider_connections SET config_json=?,enabled=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND credential_item_id=?").run(JSON.stringify(c),enabled,new Date().toISOString(),row.id,row.revision,row.credential_item_id);
  if(Number(changed.changes)!==1)fail("PAIRING_CAS_CONFLICT");
 }
 function retain(enrollmentRequestId:string,secret:Row,phase:"verifying"|"paired",activate:boolean){
  backend.transaction(()=>{
   const {row,c}=connection(enrollmentRequestId),p=backend.principal(request);
   if(c.phase==="disabled"||c.phase==="paired")fail("PAIRING_CAS_CONFLICT");
   const item=vaultItem(row.credential_item_id,p,"write");
   if(item.project_id!==c.projectId||item.version!==c.credentialVersion||backend.vault.isSealed())fail("PAIR_CREDENTIAL_CHANGED",503);
   backend.vault.updateItem(item.project_id,item.id,JSON.stringify(secret),{type:"user",id:p.id});
   const current=vaultItem(item.id,p,"write");if(current.version!==item.version+1)fail("PAIR_RECEIPT_NOT_RETAINED",503);
   change(row,{...c,phase,credentialVersion:current.version},activate?1:0);
  });backend.checkpoint();
 }
 function uncertain(enrollmentRequestId:string,code:string){
  try{backend.transaction(()=>{const {row,c}=connection(enrollmentRequestId);if(c.phase==="paired"||c.phase==="disabled")return;change(row,{...c,phase:"unknown",firstFailureCode:c.firstFailureCode??code},0);});backend.checkpoint();}catch{/* Original claimed row remains durable; no clear/replay or secret fallback. */}
 }
 async function pair(input:unknown){
  if(!object(input)||Object.keys(input).sort().join(",")!=="enrollmentRequestId,hostedProjectId,preparationItemId"||!identifier(input.enrollmentRequestId)||!identifier(input.preparationItemId)||!identifier(input.hostedProjectId))fail("INVALID_PAIRING",422);
  const s=subject(),id=rowId(s.p.id,s.installation,input.enrollmentRequestId),old=backend.db().prepare("SELECT * FROM provider_connections WHERE id=?").get(id) as Row|undefined;
  if(old){const existing=connection(input.enrollmentRequestId);if(existing.c.preparationItemId!==input.preparationItemId||existing.c.projectId!==input.hostedProjectId)fail("PAIRING_REUSE_CONFLICT");return metadata(existing.row);}
  if(backend.vault.isSealed())fail("VAULT_SEALED",503);
  const item=vaultItem(input.preparationItemId,s.p,"write");if(item.project_id!==input.hostedProjectId)fail("PAIRING_PROJECT_CHANGED");
  const preparation=decodePreparation(plaintext(item,s.p),input.enrollmentRequestId);
  const c:Config={kind:KIND,enrollmentRequestId:input.enrollmentRequestId,installationId:s.installation,projectId:item.project_id,phase:"redeeming",preparationItemId:item.id,preparationVersion:item.version,credentialVersion:item.version};
  // Claim in the EXISTING connection owner BEFORE the one-use Native effect. Changed reuse never dispatches.
  backend.transaction(()=>{
   const p=backend.principal(request),current=vaultItem(item.id,p,"write");if(p.id!==s.p.id||current.version!==item.version||current.project_id!==item.project_id)fail("PAIRING_CAS_CONFLICT");
   backend.db().prepare("INSERT INTO provider_connections(id,provider_key,owner_kind,organization_id,owner_user_id,credential_item_id,display_name,provider_type,config_json,enabled,revision,created_by_actor_type,created_by_actor_id,created_at,updated_at) VALUES(?,?,'user',?,?,?,'Paired Native governance','native',?,0,0,'user',?,?,?)")
    .run(id,"native-pair:"+createHash("sha256").update(input.enrollmentRequestId).digest("hex"),item.organization_id,p.id,item.id,JSON.stringify(c),p.id,new Date().toISOString(),new Date().toISOString());
  });backend.checkpoint();
  try{
   const credential=await backend.redeem(preparation,s.p.id,s.installation,item.project_id,redeemed=>retain(input.enrollmentRequestId,redeemed,"verifying",false));
   const current=subject();if(current.p.id!==s.p.id||current.installation!==s.installation)fail("PAIRING_ACTOR_CHANGED",401);
   retain(input.enrollmentRequestId,{schemaVersion:1,stage:"paired",credential},"paired",true);
   return metadata(connection(input.enrollmentRequestId).row);
  }catch{uncertain(input.enrollmentRequestId,"NATIVE_PAIRING_UNCONFIRMED");return metadata(connection(input.enrollmentRequestId).row);}
 }
 async function recover(enrollmentRequestId:string){
  const {row,c,p}=connection(enrollmentRequestId);if(c.phase==="paired"||c.phase==="disabled")return metadata(row);
  const item=vaultItem(row.credential_item_id,p,"write");if(item.version!==c.credentialVersion)fail("PAIR_CREDENTIAL_CHANGED");
  const secret=plaintext(item,p);
  // A received cookie was retained before context verification. Recovery performs GET proof only.
  if(secret.schemaVersion!==1||secret.stage!=="redeemed")return metadata(row);
  if(secret.actorId!==p.id||secret.installationId!==c.installationId||secret.enrollmentRequestId!==enrollmentRequestId||secret.hostedProjectId!==c.projectId)fail("PAIRING_ACTOR_CHANGED",401);
  try{const credential=await backend.verify(secret as Redeemed);retain(enrollmentRequestId,{schemaVersion:1,stage:"paired",credential},"paired",true);}catch{uncertain(enrollmentRequestId,"NATIVE_PAIRING_UNCONFIRMED");}
  return metadata(connection(enrollmentRequestId).row);
 }
 const custody:OriginalNativeConnectionCustody={
  async withOriginal(actorId,installationId,enrollmentRequestId,work){
   const {row,c,p,installation}=connection(enrollmentRequestId);
   if(p.id!==actorId||installation!==installationId||c.phase!=="paired"||row.enabled!==1)fail("NATIVE_ATTESTATION_UNAVAILABLE",503);
   const item=vaultItem(row.credential_item_id,p,"read");if(item.project_id!==c.projectId||item.version!==c.credentialVersion)fail("PAIR_CREDENTIAL_CHANGED",503);
   const secret=plaintext(item,p);if(secret.schemaVersion!==1||secret.stage!=="paired"||!object(secret.credential)||!object(secret.credential.original))fail("PAIR_CREDENTIAL_UNAVAILABLE",503);
   const original=secret.credential.original;
   if(original.actorId!==p.id||original.installationId!==installation||original.enrollmentRequestId!==enrollmentRequestId||original.hostedProjectId!==c.projectId)fail("NATIVE_ATTESTATION_REFUSED",503);
   const version=item.version,revision=row.revision,reader=backend.reader(secret.credential as PairedNativeCredential);
   const assertCurrent=()=>{const fresh=connection(enrollmentRequestId),freshItem=vaultItem(item.id,fresh.p,"read");if(backend.vault.isSealed()||fresh.p.id!==p.id||fresh.installation!==installation||fresh.row.revision!==revision||freshItem.version!==version||fresh.row.enabled!==1||fresh.c.phase!=="paired")fail("PAIR_CREDENTIAL_CHANGED",503);};
   const result=await work({...reader,assertCurrent});assertCurrent();
   return result;
  }
 };
 return {pair,recover,status:(enrollmentRequestId:string)=>metadata(connection(enrollmentRequestId).row),custody};
}
