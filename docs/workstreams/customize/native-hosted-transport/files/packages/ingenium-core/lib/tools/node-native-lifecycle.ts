/** Lifecycle checks query existing owners; no new authority or terminal-state invention. */
import type {getDb} from "../db.js";
export function assertNativeGovernanceLifecycleClear(db:ReturnType<typeof getDb>,projectId?:string):void{
 const scope=projectId===undefined?"":" AND g.hosted_project_id=?";
 const args=projectId===undefined?[]:[projectId];
 const pending=db.prepare("SELECT EXISTS(SELECT 1 FROM native_hosted_governance_effects e JOIN native_hosted_governance_grants g ON g.id=e.grant_id WHERE e.state='executing'"+scope+") AS held").get(...args) as {held:number}|undefined;
 const grants=db.prepare("SELECT EXISTS(SELECT 1 FROM native_hosted_governance_grants g WHERE g.revoked_at IS NULL"+scope+") AS held").get(...args) as {held:number}|undefined;
 const connectionScope=projectId===undefined?"":" AND json_extract(config_json,'$.projectId')=?";
 // Unknown/malformed phase retains custody; missing table/owner throws, never falls back.
 const connections=db.prepare("SELECT EXISTS(SELECT 1 FROM provider_connections WHERE provider_type='native' AND json_extract(config_json,'$.kind')='node-native-pairing-v1' AND COALESCE(json_extract(config_json,'$.phase'),'unknown')<>'retired'"+connectionScope+") AS held").get(...args) as {held:number}|undefined;
 if(pending?.held||grants?.held||connections?.held)throw new Error("NATIVE_GOVERNANCE_CUSTODY_REQUIRES_RECONCILIATION");
}