import {mcpCredentials} from "ingenium-core";
import {createCore126WithdrawalHandler} from "./core126-http.mjs";
import type {Core126ImageOwner} from "../../../../packages/veyra-operations/core126-image-owner.mjs";
import type {Core126Handlers} from "./managed-job-contracts.mjs";
import {createActualCore126Owner} from "./core126-actual-factory.js";
let original:ReturnType<typeof createActualCore126Owner>|undefined;
/** Startup-only original owner; never instantiate per request or after in-place restore. */
export function installActualManagedJobOwner(imageOwner:Core126ImageOwner):void {
 if(original||!imageOwner||typeof imageOwner.withFreshOriginalJobRole!=="function"||typeof imageOwner.assertCurrentOriginalJobRole!=="function")throw Error("Managed JobRun original owner enrollment conflict");
 original=createActualCore126Owner({imageOwner});
}
export function actualManagedJobOwner():ReturnType<typeof createActualCore126Owner> {
 if(!original)throw Object.assign(Error("Qualified managed JobRun original owner unavailable"),{status:503});return original;
}
const originalWithdrawal=createCore126WithdrawalHandler({credentials:mcpCredentials});
export const actualManagedJobHandlers:Core126Handlers={
 internal:request=>actualManagedJobOwner().handlers.internal(request),
 runtime:async request=>{
  const narrowed=await originalWithdrawal(request);if(narrowed)return narrowed;
  return await actualManagedJobOwner().handlers.runtime(request);
 },
};
