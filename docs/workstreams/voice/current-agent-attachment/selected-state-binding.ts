/* Root target: services/ingenium-api/lib/selected-state-binding.ts */
import {currentOpenCodeRuntimeTarget} from './runtime-opencode-context.js';
import {selectedStateAdmission,selectedSessionMutation} from './selected-state-admission.mjs';
const owner=()=>{
 const target=currentOpenCodeRuntimeTarget();
 const identity=target?.selectionOwnerId??(!target?'installation-opencode':undefined);
 if(!identity)throw Object.assign(Error('SELECTION_FENCE_TARGET_OWNER_REQUIRED'),{code:'SELECTION_FENCE_TARGET_OWNER_REQUIRED',status:409});
 return identity;
};
export function withCurrentSessionAdmission<T>(sessionId:string,effect:()=>Promise<T>|T):Promise<T>{
 return selectedStateAdmission.run(owner(),sessionId,effect);
}
export function guardSelectionMutation<T>(path:string,options:{method?:string},effect:()=>Promise<T>):Promise<T>{
 const sessionId=selectedSessionMutation(path,options.method??'GET');
 return sessionId?selectedStateAdmission.write(owner(),sessionId,effect):effect();
}
