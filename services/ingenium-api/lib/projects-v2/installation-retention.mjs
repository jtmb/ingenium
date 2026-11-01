import {createHash} from 'node:crypto';
import {InstallationPreferencesBridge} from './installation.mjs';
import {requireValue,scopeKey} from '../../../../packages/veyra-projects/domain.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key='archive_retention_days';

/** Adopt only the authoritative existing installation owner; never copy settings,
 * credentials, workspaces or user data. Called by the original bootstrap writer. */
export function bindInstallationSettingsOwner({db,transaction,checkpointAfterWrite},legacyProjectId){
 const changed=transaction(()=>{
  const identity=db.prepare('SELECT instance_id FROM veyra_installation_identity WHERE singleton=1').get();
  requireValue(identity&&/^[a-f0-9]{32}$/.test(identity.instance_id),'INSTALLATION_IDENTITY_UNAVAILABLE',503);
  const row=db.prepare('SELECT legacy_project_id,revision FROM veyra_installation_legacy_refs WHERE instance_id=?').get(identity.instance_id);
  if(row){requireValue(row.legacy_project_id===legacyProjectId&&Number.isSafeInteger(row.revision)&&row.revision>0&&db.prepare('SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL').get(legacyProjectId),'INSTALLATION_OWNER_CONFLICT',409);return false}
  // Initial adoption still requires the original unambiguous legacy global owner.
  // Existing mappings never follow a later workspace flag or rewrite their revision.
  const globals=db.prepare('SELECT id FROM projects WHERE is_global=1 AND archived_at IS NULL').all();
  requireValue(globals.length===1&&globals[0].id===legacyProjectId,'INSTALLATION_OWNER_CONFLICT',409);
  db.prepare('INSERT INTO veyra_installation_legacy_refs(instance_id,legacy_project_id) VALUES(?,?)').run(identity.instance_id,legacyProjectId);
  return true;
 });
 if(changed)checkpointAfterWrite();
 return changed;
}

/** Existing Core settings and single writer remain authoritative. The mapping
 * revision plus exact value hash also detects writes from compatibility routes. */
export class InstallationRetentionOwner {
 constructor(ports){Object.assign(this,ports)}
 bridge(scope){return new InstallationPreferencesBridge({db:this.db,authorize:this.authorize,readPreference:this.readPreference,
  writePreference:request=>this.commit(scope,request)})}
 reference(scope){
  scopeKey(scope);
  const row=this.db.prepare(`SELECT r.legacy_project_id,r.revision,p.organization_id FROM veyra_installation_legacy_refs r
   JOIN veyra_installation_identity i ON i.instance_id=r.instance_id AND i.singleton=1
   JOIN projects p ON p.id=r.legacy_project_id AND p.archived_at IS NULL WHERE r.instance_id=?`).get(scope.instanceId);
  requireValue(row&&row.organization_id===scope.organizationId&&Number.isSafeInteger(row.revision)&&row.revision>0,'INSTALLATION_MAPPING_REQUIRED',503);
  return row;
 }
 snapshot(scope,bridge){
  const ref=this.reference(scope),value=bridge.get(scope,key);
  requireValue(value===undefined||typeof value==='string','INSTALLATION_VALUE_INVALID',503);
  return {key,value:value??null,revision:ref.revision,valueHash:digest([scope.instanceId,ref.legacy_project_id,key,ref.revision,value===undefined?null:value])};
 }
 read(scope){return this.transaction(()=>this.snapshot(scope,this.bridge(scope)))}
 write(scope,intent){return this.bridge(scope).set(scope,key,intent)}
 commit(scope,{legacyProjectId,intent}){
  requireValue(intent&&Object.keys(intent).every(k=>['operationId','expectedRevision','expectedValueHash','value'].includes(k))&&
   /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intent.operationId)&&
   Number.isSafeInteger(intent.expectedRevision)&&intent.expectedRevision>0&&/^[0-9a-f]{64}$/.test(intent.expectedValueHash)&&
   typeof intent.value==='string'&&/^[1-9][0-9]{0,2}$/.test(intent.value)&&Number(intent.value)<=365,'INVALID_INSTALLATION_PREFERENCE',422);
  const operationScope=JSON.stringify(['installation-retention-v1',scopeKey(scope)]),requestHash=digest([key,intent.expectedRevision,intent.expectedValueHash,intent.value]);
  let changed=false;
  const result=this.transaction(()=>{
   const bridge=this.bridge(scope);requireValue(bridge.legacyOwner(scope,'installation:preferences:write',key)===legacyProjectId,'INSTALLATION_OWNER_CONFLICT',409);
   const ref=this.reference(scope);requireValue(ref.legacy_project_id===legacyProjectId,'INSTALLATION_OWNER_CONFLICT',409);
   const previous=this.db.prepare('SELECT request_hash,state,result_json FROM veyra_project_operations WHERE scope_key=? AND operation_id=?').get(operationScope,intent.operationId);
   if(previous){
    requireValue(previous.request_hash===requestHash,'INSTALLATION_OPERATION_CONFLICT',409);
    requireValue(previous.state==='succeeded','INSTALLATION_OPERATION_UNRESOLVED',409);
    const receipt=JSON.parse(previous.result_json);requireValue(Number.isSafeInteger(receipt.revision)&&receipt.revision>0,'INSTALLATION_OPERATION_UNRESOLVED',409);
    return {data:this.snapshot(scope,bridge),receipt:{operationId:intent.operationId,replayed:true,appliedRevision:receipt.revision}};
   }
   const before=this.snapshot(scope,bridge);
   requireValue(before.revision===intent.expectedRevision&&before.valueHash===intent.expectedValueHash,'INSTALLATION_PREFERENCE_CHANGED',409);
   requireValue(ref.revision<Number.MAX_SAFE_INTEGER,'INSTALLATION_REVISION_EXHAUSTED',409);
   this.writePreference(legacyProjectId,key,intent.value);
   requireValue(this.readPreference(legacyProjectId,key)===intent.value,'INSTALLATION_WRITE_UNVERIFIED',503);
   requireValue(bridge.legacyOwner(scope,'installation:preferences:write',key)===legacyProjectId,'FORBIDDEN',403);
   requireValue(Number(this.db.prepare('UPDATE veyra_installation_legacy_refs SET revision=revision+1 WHERE instance_id=? AND legacy_project_id=? AND revision=?').run(scope.instanceId,legacyProjectId,ref.revision).changes)===1,'INSTALLATION_PREFERENCE_CHANGED',409);
   const data=this.snapshot(scope,bridge);
   this.db.prepare("INSERT INTO veyra_project_operations(scope_key,operation_id,request_hash,state,result_json) VALUES(?,?,?,'succeeded',?)").run(operationScope,intent.operationId,requestHash,JSON.stringify(data));
   changed=true;return {data,receipt:{operationId:intent.operationId,replayed:false,appliedRevision:data.revision}};
  });
  if(changed)this.checkpointAfterWrite();
  return result;
 }
}