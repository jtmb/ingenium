import type {OwnerScope} from "../../../../packages/veyra-projects/contracts.js";
import type {DatabasePort} from "./catalog.mjs";
export interface LegacyDecision {
  legacyId:string;classification:"workspace"|"installation"|"imported_unassigned";
  evidenceRef:string;scope?:OwnerScope;permissionsVerified?:boolean;
}
export function inventoryLegacyReferences(db:DatabasePort):{
  table:string;column:string;declaredForeignKey:boolean;rows:number;
}[];
export function legacyDigest(db:DatabasePort,tableNames:string[]):{table:string;rows:number;sha256:string}[];
export function migrationInventoryHash(db:DatabasePort):string;
export function importLegacyCatalog(input:{db:DatabasePort;transaction:<T>(action:()=>T)=>T;
  checkpointAfterWrite:()=>void;instanceId:string;decisions:LegacyDecision[];approvedInventoryHash:string;
}):{projects:number;installation:number};
