/** Lifecycle checks query existing owners; no new authority or terminal-state invention. */
import type {getDb} from "../db.js";
export function assertNativeGovernanceLifecycleClear(db:ReturnType<typeof getDb>,projectId?:string,allowedCustomOriginals:readonly string[]=[]):void{
 const customizeScope=projectId===undefined?"":" AND project_id=?";
 if(db.prepare("SELECT 1 FROM customize_commands WHERE result_json IS NULL"+customizeScope+(allowedCustomOriginals.length?" AND id NOT IN ("+allowedCustomOriginals.map(()=>"?").join(",")+")":"")+" LIMIT 1").get(...(projectId===undefined?[]:[projectId]),...allowedCustomOriginals))throw new Error("CUSTOMIZE_ORIGINAL_REQUIRES_RECONCILIATION");
 const scope=projectId===undefined?"":" AND g.hosted_project_id=?";
 const args=projectId===undefined?[]:[projectId];
 const pending=db.prepare("SELECT EXISTS(SELECT 1 FROM native_hosted_governance_effects e JOIN native_hosted_governance_grants g ON g.id=e.grant_id WHERE e.state='executing'"+scope+") AS held").get(...args) as {held:number}|undefined;
 const grants=db.prepare("SELECT EXISTS(SELECT 1 FROM native_hosted_governance_grants g WHERE g.revoked_at IS NULL"+scope+") AS held").get(...args) as {held:number}|undefined;
 const connectionScope=projectId===undefined?"":" AND json_extract(config_json,'$.projectId')=?";
 // Unknown/malformed phase retains custody; missing table/owner throws, never falls back.
 const connections=db.prepare("SELECT EXISTS(SELECT 1 FROM provider_connections WHERE provider_type='native' AND json_extract(config_json,'$.kind')='node-native-pairing-v1' AND COALESCE(json_extract(config_json,'$.phase'),'unknown')<>'retired'"+connectionScope+") AS held").get(...args) as {held:number}|undefined;
 if(pending?.held||grants?.held||connections?.held)throw new Error("NATIVE_GOVERNANCE_CUSTODY_REQUIRES_RECONCILIATION");
}
/** Restore receipt access under a persisted fence; never clear/execute the unknown effect. */
export function assertNativeGovernanceRecoveryRestore(db:ReturnType<typeof getDb>,projectId:string):void{
 const unfenced=db.prepare("SELECT EXISTS(SELECT 1 FROM provider_connections WHERE provider_type='native' AND json_extract(config_json,'$.kind')='node-native-pairing-v1' AND json_extract(config_json,'$.projectId')=? AND (enabled<>0 OR COALESCE(json_extract(config_json,'$.phase'),'unknown') NOT IN ('quiescing','retired'))) AS held").get(projectId) as {held:number}|undefined;
 const grants=db.prepare("SELECT EXISTS(SELECT 1 FROM native_hosted_governance_grants g WHERE g.hosted_project_id=? AND g.revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM provider_connections p WHERE p.owner_kind='user' AND p.owner_user_id=g.owner_user_id AND p.provider_type='native' AND p.enabled=0 AND json_extract(p.config_json,'$.kind')='node-native-pairing-v1' AND json_extract(p.config_json,'$.phase')='quiescing' AND json_extract(p.config_json,'$.enrollmentRequestId')=g.enrollment_request_id AND json_extract(p.config_json,'$.installationId')=g.installation_id AND json_extract(p.config_json,'$.projectId')=g.hosted_project_id)) AS held").get(projectId) as {held:number}|undefined;
 if(unfenced?.held||grants?.held)throw new Error("NATIVE_GOVERNANCE_RESTORE_REQUIRES_QUIESCENCE");
}