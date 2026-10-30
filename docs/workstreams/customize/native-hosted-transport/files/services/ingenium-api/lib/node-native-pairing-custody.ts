/** Concrete same-browser-user custody using EXISTING provider_connections and encrypted user vault item.
 * No schema/table/credential DB or service-token fallback. All raw secrets stay inside this module/reader.
 */
import type {Request} from "express";
import {createHash} from "node:crypto";
import {getDb,execTransaction,checkpointAfterWrite,vault,authorization,HostedRefusal,type HostedGovernanceSqlDb as SqlDb} from "ingenium-core";
import {authenticateRequestWithoutActivity} from "./middleware/auth.js";
import {toAuthorizationPrincipal} from "./authorization-policy.js";
import {createPairedNativeReader,decodePreparation,redeemNativePreparation,verifyRedeemed,type Preparation,type Redeemed,type PairedNativeCredential} from "./paired-native-reader.js";
import {retirementProof} from "./paired-native-proof.js";
import type {OriginalNativeConnectionCustody} from "./native-hosted-connection-owner.js";
type Principal={type:"user";id:string;scopes:readonly string[];session:unknown};
type Row=Record<string,any>;
type Config={kind:"node-native-pairing-v1";enrollmentRequestId:string;installationId:string;projectId:string;phase:"redeeming"|"verifying"|"paired"|"unknown"|"disabled"|"quiescing"|"retired";preparationItemId:string;preparationVersion:number;credentialVersion:number;retirement?:{grantId:string;grantRevision:number;proofSha256:string;physicalErasure:false};firstFailureCode?:string};
type VaultOwner=Pick<typeof vault,"isSealed"|"decryptItem"|"updateItem"|"deleteItem">;
export interface NativePairingBackend {
 db():SqlDb;transaction<T>(work:()=>T):T;checkpoint():void;vault:VaultOwner;
 principal(req:Request):Principal;
 project(principal:Principal,projectId:string,permission:"read"|"write"):boolean;
 retirementProject(principal:Principal,projectId:string):boolean;
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
 retirementProject:(p,id)=>!!getDb().prepare("SELECT 1 FROM projects project JOIN organization_memberships member ON member.organization_id=project.organization_id WHERE project.id=? AND member.user_id=? AND member.status='active'").get(id,p.id),
 owned:(p,row,kind,permission)=>row.owner_kind==="user"&&row.owner_user_id===p.id&&authorization.requireOwnedResourcePermission(toAuthorizationPrincipal(p as any),{
  resourceType:kind,resourceId:row.id,organizationId:row.organization_id,ownerKind:"user",ownerUserId:p.id},permission).allowed,
 redeem:redeemNativePreparation,verify:verifyRedeemed,reader:createPairedNativeReader
};
function config(row:Row):Config{
 let c:unknown;try{c=JSON.parse(row.config_json);}catch{return fail("PAIRING_RECORD_UNAVAILABLE",503);}
 if(!object(c)||c.kind!==KIND||!identifier(c.enrollmentRequestId)||!identifier(c.installationId)||!identifier(c.projectId)||!identifier(c.preparationItemId)||
 !Number.isSafeInteger(c.preparationVersion)||!Number.isSafeInteger(c.credentialVersion)||!["redeeming","verifying","paired","unknown","disabled","quiescing","retired"].includes(c.phase))return fail("PAIRING_RECORD_UNAVAILABLE",503);
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
 function vaultItem(id:string,p:Principal,permission:"read"|"write",retirement=false){
  const item=backend.db().prepare("SELECT id,project_id,organization_id,owner_kind,owner_user_id,type,version,access_policy FROM vault_items WHERE id=? AND access_policy<>?").get(id,DELETED) as Row|undefined;
  if(!item||item.type!=="native-pairing-credential"||!backend.owned(p,item,"vault_item",permission)||!(retirement?backend.retirementProject(p,item.project_id):backend.project(p,item.project_id,permission)))fail("NOT_FOUND",404);
  return item;
 }
 function connection(enrollmentRequestId:string,retirement=false){
  const s=subject(),id=rowId(s.p.id,s.installation,enrollmentRequestId);
  const row=backend.db().prepare("SELECT * FROM provider_connections WHERE id=? AND owner_kind='user' AND owner_user_id=? AND provider_type='native'").get(id,s.p.id) as Row|undefined;
  if(!row||!backend.owned(s.p,row,"provider_connection","read"))fail("NOT_FOUND",404);
  const c=config(row);if(c.installationId!==s.installation||c.enrollmentRequestId!==enrollmentRequestId||!(retirement?backend.retirementProject(s.p,c.projectId):backend.project(s.p,c.projectId,"read")))fail("NOT_FOUND",404);
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
   if(["disabled","paired","quiescing","retired"].includes(c.phase))fail("PAIRING_CAS_CONFLICT");
   const item=vaultItem(row.credential_item_id,p,"write");
   if(item.project_id!==c.projectId||item.version!==c.credentialVersion||backend.vault.isSealed())fail("PAIR_CREDENTIAL_CHANGED",503);
   backend.vault.updateItem(item.project_id,item.id,JSON.stringify(secret),{type:"user",id:p.id});
   const current=vaultItem(item.id,p,"write");if(current.version!==item.version+1)fail("PAIR_RECEIPT_NOT_RETAINED",503);
   change(row,{...c,phase,credentialVersion:current.version},activate?1:0);
  });backend.checkpoint();
 }
 function uncertain(enrollmentRequestId:string,code:string){
  try{backend.transaction(()=>{const {row,c}=connection(enrollmentRequestId);if(["paired","disabled","quiescing","retired"].includes(c.phase))return;change(row,{...c,phase:"unknown",firstFailureCode:c.firstFailureCode??code},0);});backend.checkpoint();}catch{/* Original claimed row remains durable; no clear/replay or secret fallback. */}
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
  const {row,c,p}=connection(enrollmentRequestId);if(["paired","disabled","quiescing","retired"].includes(c.phase))return metadata(row);
  const item=vaultItem(row.credential_item_id,p,"write");if(item.version!==c.credentialVersion)fail("PAIR_CREDENTIAL_CHANGED");
  const secret=plaintext(item,p);
  // A received cookie was retained before context verification. Recovery performs GET proof only.
  if(secret.schemaVersion!==1||secret.stage!=="redeemed")return metadata(row);
  if(secret.actorId!==p.id||secret.installationId!==c.installationId||secret.enrollmentRequestId!==enrollmentRequestId||secret.hostedProjectId!==c.projectId)fail("PAIRING_ACTOR_CHANGED",401);
  try{const credential=await backend.verify(secret as Redeemed);retain(enrollmentRequestId,{schemaVersion:1,stage:"paired",credential},"paired",true);}catch{uncertain(enrollmentRequestId,"NATIVE_PAIRING_UNCONFIRMED");}
  return metadata(connection(enrollmentRequestId).row);
 }
 function lifecycleRevision(value:unknown):number{
  if(!object(value)||Object.keys(value).join(",")!=="expectedRevision"||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0)fail("INVALID_PAIRING_LIFECYCLE",422);return value.expectedRevision;
 }
 function pendingEffects(id:string,p:Principal,installation:string,projectId:string):number{
  const row=backend.db().prepare("SELECT count(*) AS count FROM native_hosted_governance_effects e JOIN native_hosted_governance_grants g ON g.id=e.grant_id WHERE g.enrollment_request_id=? AND g.owner_user_id=? AND g.installation_id=? AND g.hosted_project_id=? AND e.state='executing'").get(id,p.id,installation,projectId) as Row;
  const scoped=backend.db().prepare("SELECT count(*) AS count FROM customize_commands command JOIN customize_native_consents consent ON consent.id=command.native_consent_id WHERE consent.enrollment_request_id=? AND consent.owner_user_id=? AND consent.installation_id=? AND consent.hosted_project_id=? AND command.result_json IS NULL").get(id,p.id,installation,projectId) as Row;
  return Number(row.count)+Number(scoped.count);
 }
 function writable(row:Row,c:Config,p:Principal){
  if(!backend.owned(p,row,"provider_connection","write")||!backend.retirementProject(p,c.projectId))fail("NOT_FOUND",404);
 }
 function quiesce(id:string,input:unknown){
  const revision=lifecycleRevision(input);
  backend.transaction(()=>{
   const {row,c,p}=connection(id,true);writable(row,c,p);
   if(row.revision!==revision)fail("PAIRING_CAS_CONFLICT");
   if(c.phase==="retired"||c.phase==="quiescing")return;
   change(row,{...c,phase:"quiescing"},0);
  });backend.checkpoint();
  const {row,c,p,installation}=connection(id,true);
  return {...metadata(row),pendingEffects:pendingEffects(id,p,installation,c.projectId),physicalErasure:false};
 }
 async function retire(id:string,input:unknown){
  const revision=lifecycleRevision(input),before=connection(id,true);writable(before.row,before.c,before.p);
  if(before.row.revision!==revision)fail("PAIRING_CAS_CONFLICT");
  if(before.c.phase==="retired")return {...metadata(before.row),physicalErasure:false};
  if(before.c.phase!=="quiescing"||before.row.enabled!==0)fail("PAIRING_NOT_QUIESCED");
  if(pendingEffects(id,before.p,before.installation,before.c.projectId)!==0)fail("HOSTED_EFFECTS_UNRESOLVED");
  const item=vaultItem(before.row.credential_item_id,before.p,"write",true),secret=plaintext(item,before.p);
  if(item.version!==before.c.credentialVersion||secret.stage!=="paired"||!object(secret.credential))fail("PAIR_RETIREMENT_PROOF_UNAVAILABLE",503);
  const credential=secret.credential as PairedNativeCredential;
  if(credential.original.actorId!==before.p.id||credential.original.installationId!==before.installation||credential.original.enrollmentRequestId!==id||credential.original.hostedProjectId!==before.c.projectId)fail("NATIVE_ATTESTATION_REFUSED",503);
  const proof=await backend.reader(credential).readRetirement();
  retirementProof(proof,credential.original);
  backend.transaction(()=>{
   const current=connection(id,true);writable(current.row,current.c,current.p);
   const actual=vaultItem(item.id,current.p,"write",true);
   if(current.row.revision!==revision||current.c.phase!=="quiescing"||current.p.id!==before.p.id||current.installation!==before.installation||actual.version!==item.version)fail("PAIRING_CAS_CONFLICT");
   if(pendingEffects(id,current.p,current.installation,current.c.projectId)!==0)fail("HOSTED_EFFECTS_UNRESOLVED");
   const grants=backend.db().prepare("SELECT * FROM native_hosted_governance_grants WHERE enrollment_request_id=?").all(id) as Row[];
   for(const g of grants)if(g.owner_user_id!==current.p.id||g.installation_id!==current.installation||g.hosted_project_id!==current.c.projectId||g.native_library_id!==credential.original.nativeOwner.library_id||g.native_service_instance_id!==credential.original.nativeOwner.service_instance_id||g.native_project_id!==(credential.original.nativeOwner.project?.id??null)||g.native_project_revision!==(credential.original.nativeOwner.project?.revision??null))fail("NATIVE_ATTESTATION_REFUSED",503);
   backend.db().prepare("UPDATE native_hosted_governance_grants SET revoked_at=COALESCE(revoked_at,?) WHERE enrollment_request_id=? AND owner_user_id=? AND installation_id=?").run(new Date().toISOString(),id,current.p.id,current.installation);
   backend.db().prepare("UPDATE customize_native_consents SET revoked_at=?,revision=revision+1 WHERE enrollment_request_id=? AND owner_user_id=? AND installation_id=? AND revoked_at IS NULL").run(new Date().toISOString(),id,current.p.id,current.installation);
   // Existing audited vault SOFT deletion. Ciphertext/originals are preserved; no physical-erasure claim.
   backend.vault.deleteItem(actual.project_id,actual.id,{type:"user",id:current.p.id});
   const deleted=backend.db().prepare("SELECT access_policy FROM vault_items WHERE id=?").get(actual.id) as Row;
   if(deleted.access_policy!==DELETED)fail("PAIR_RETIREMENT_NOT_RETAINED",503);
   change(current.row,{...current.c,phase:"retired",retirement:{grantId:credential.original.grantId,grantRevision:(proof as Row).grant.revision,proofSha256:createHash("sha256").update(JSON.stringify(proof)).digest("hex"),physicalErasure:false}},0);
   backend.db().prepare("UPDATE provider_connections SET credential_item_id=NULL WHERE id=?").run(current.row.id);
  });backend.checkpoint();
  return {...metadata(connection(id,true).row),physicalErasure:false};
 }
 const custody:OriginalNativeConnectionCustody={
  async withOriginal(actorId,installationId,enrollmentRequestId,work){
   const {row,c,p,installation}=connection(enrollmentRequestId);
   const recovery=request.method==="GET"&&/^\/operations(?:\/[^/]+)?$/.test(request.path),quiesced=c.phase==="quiescing";
   if(p.id!==actorId||installation!==installationId||!(c.phase==="paired"&&row.enabled===1||quiesced&&row.enabled===0&&recovery))fail("NATIVE_ATTESTATION_UNAVAILABLE",503);
   const item=vaultItem(row.credential_item_id,p,"read");if(item.project_id!==c.projectId||item.version!==c.credentialVersion)fail("PAIR_CREDENTIAL_CHANGED",503);
   const secret=plaintext(item,p);if(secret.schemaVersion!==1||secret.stage!=="paired"||!object(secret.credential)||!object(secret.credential.original))fail("PAIR_CREDENTIAL_UNAVAILABLE",503);
   const original=secret.credential.original;
   if(original.actorId!==p.id||original.installationId!==installation||original.enrollmentRequestId!==enrollmentRequestId||original.hostedProjectId!==c.projectId)fail("NATIVE_ATTESTATION_REFUSED",503);
   const version=item.version,revision=row.revision,reader=backend.reader(secret.credential as PairedNativeCredential);
   const assertCurrent=()=>{const fresh=connection(enrollmentRequestId),freshItem=vaultItem(item.id,fresh.p,"read");if(backend.vault.isSealed()||fresh.p.id!==p.id||fresh.installation!==installation||fresh.row.revision!==revision||freshItem.version!==version||fresh.row.enabled!==row.enabled||fresh.c.phase!==c.phase)fail("PAIR_CREDENTIAL_CHANGED",503);};
   const result=await work({...reader,assertCurrent});assertCurrent();
   return result;
  }
 };
 return {pair,recover,quiesce,retire,status:(enrollmentRequestId:string)=>{const {row,c,p,installation}=connection(enrollmentRequestId,true);return {...metadata(row),pendingEffects:pendingEffects(enrollmentRequestId,p,installation,c.projectId),physicalErasure:false};},custody};
}
