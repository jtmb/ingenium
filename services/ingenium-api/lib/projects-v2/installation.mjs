import {requireValue,scopeKey} from "../../../../packages/veyra-projects/domain.mjs";

const preferenceKeys=new Set(["chat_defaults","chat_selection","archive_retention_days"]);
export class InstallationPreferencesBridge {
  constructor({db,authorize,readPreference,writePreference}) {
    Object.assign(this,{db,authorize,readPreference,writePreference});
  }
  legacyOwner(scope,action,key) {
    scopeKey(scope);
    requireValue(preferenceKeys.has(key),"PREFERENCE_NOT_EXPOSED",403);
    requireValue(this.authorize(scope,action,key) === true,"FORBIDDEN",403);
    const row=this.db.prepare("SELECT legacy_project_id FROM veyra_installation_legacy_refs WHERE instance_id=?")
      .get(scope.instanceId);
    requireValue(row,"INSTALLATION_MAPPING_REQUIRED",409);
    return row.legacy_project_id;
  }
  get(scope,key) {
    const legacyProjectId=this.legacyOwner(scope,"installation:preferences:read",key);
    // Existing settings owner returns the exact stored value. No model/default substitution.
    return this.readPreference(legacyProjectId,key);
  }
  set(scope,key,intent) {
    const legacyProjectId=this.legacyOwner(scope,"installation:preferences:write",key);
    requireValue(typeof this.writePreference==="function","PREFERENCE_WRITE_UNAVAILABLE",501);
    requireValue(intent && typeof intent.operationId==="string" &&
      Number.isSafeInteger(intent.expectedRevision) && intent.expectedRevision>=0,"VALIDATION_ERROR");
    // The installation settings owner retains CAS, exact-original admission and provider validation.
    return this.writePreference({legacyProjectId,key,intent});
  }
}
