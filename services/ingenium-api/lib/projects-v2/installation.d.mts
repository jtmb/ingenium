import type {OwnerScope} from "../../../../packages/veyra-projects/contracts.js";
import type {DatabasePort} from "./catalog.mjs";
export interface PreferenceIntent {operationId:string;expectedRevision:number;expectedValueHash?:string;value:unknown;}
export class InstallationPreferencesBridge {
  constructor(dependencies:{db:DatabasePort;
    authorize:(scope:OwnerScope,action:string,key:string)=>boolean;
    readPreference:(legacyProjectId:string,key:string)=>unknown;
    writePreference?:(request:{legacyProjectId:string;key:string;intent:PreferenceIntent})=>unknown;
  });
  get(scope:OwnerScope,key:"chat_defaults"|"chat_selection"|"archive_retention_days"):unknown;
  set(scope:OwnerScope,key:"chat_defaults"|"chat_selection"|"archive_retention_days",intent:PreferenceIntent):unknown;
}
