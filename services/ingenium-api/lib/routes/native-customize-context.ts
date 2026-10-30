import type { Request } from "express";
import { authorization, getDb, type HostedGovernanceAuthentication, HostedRefusal, type HostedGovernanceRow as Row, type VerifiedNativeGovernanceContext as VerifiedNative } from "ingenium-core";
import { authMiddleware } from "../middleware/auth.js";
import { csrfMiddleware } from "../middleware/csrf.js";
import { AppError } from "../middleware/errors.js";
import { toAuthorizationPrincipal } from "../authorization-policy.js";
import { readHostedGovernance } from "./native-customize-read.js";

export interface VerifiedNativeContextOwner {
  /** Root must implement against the actual enrolled Native connection/library/catalog owner, tied to current actor and request ID. */
  enrollment(request:Request,requestId:string,actorId:string):VerifiedNative;
  current(request:Request,grant:Row,recovery:boolean,actorId:string):void;
}

/** No configuration/pairing/auth URL or identity is inferred by this factory. */
export function createNativeCustomizeContextOwner(native?:VerifiedNativeContextOwner) {
  return (req:Request):HostedGovernanceAuthentication=>{
    const current=()=>{
      // Reuse exact cookie precedence/session security_epoch/expiry/revocation logic and current CSRF/origin policy.
      try {
        authMiddleware(req,{} as any,()=>{});
        csrfMiddleware(req,{} as any,()=>{});
      } catch(error) {
        if(error instanceof AppError && ["UNAUTHORIZED","INVALID_TOKEN","CSRF_REJECTED","API_AUTH_NOT_CONFIGURED"].includes(error.code)) {
          throw new HostedRefusal(error.code,error.statusCode);
        }
        throw error;
      }
      const p=req.principal;
      if(p?.type!=="user" || !p.session) throw new HostedRefusal("BROWSER_SESSION_REQUIRED",401);
      return p;
    };
    const allow=(projectId:string,permission:"read"|"write"|"admin")=>{
      const p=current();
      return authorization.requireProjectPermission(toAuthorizationPrincipal(p),projectId,"skills",permission).allowed;
    };
    return {
      actor:()=>{
        const p=current();
        return {id:p.id,sessionId:p.session!.id,securityEpoch:p.session!.security_epoch};
      },
      allow,
      systemAllowed:projectId=>{
        const p=current();
        return authorization.requireInstallationPermission(toAuthorizationPrincipal(p),"skills","admin").allowed
          && !!getDb().prepare("SELECT 1 FROM projects WHERE id=? AND is_global=1 AND archived_at IS NULL").get(projectId);
      },
      verifyEnrollment:requestId=>{
        const p=current();
        if(!native) throw new HostedRefusal("NATIVE_ATTESTATION_UNAVAILABLE",503);
        return native.enrollment(req,requestId,p.id);
      },
      verifyNativeOwner:(grant,recovery)=>{
        const p=current();
        if(!native) throw new HostedRefusal("NATIVE_ATTESTATION_UNAVAILABLE",503);
        native.current(req,grant,recovery,p.id);
      },
      read:(command,binding)=>readHostedGovernance(command,binding,current,allow),
    };
  };
}
