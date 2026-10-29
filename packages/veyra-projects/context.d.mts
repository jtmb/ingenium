import type {OwnerScope,ProjectRef,ExecutionBinding} from "./contracts.js";
export function conversationWorkspace(input:{scope:OwnerScope;
  conversation:{id:string;scope:OwnerScope;projectId:string|null;bindingId:string};
  project:ProjectRef|null;binding:ExecutionBinding;
}):{conversationId:string;projectId:string|null;bindingId:string;ownerScope:OwnerScope;
  workspaceIdentity:string;hostId:string;environmentId:string;securityEpoch:number};
