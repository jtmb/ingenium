import { describe, expect, it } from "vitest";
import { isManagedRuntimeObservation, observeManagedRuntime, qualifyManagedRuntimePlacement } from "../lib/runtime-placement-contract.js";
import type { ManagedContainerFacts } from "../lib/runtime-placement-contract.js";
import type { PlacementRequest } from "../lib/projects-v2/request-execution-owner.mjs";
const runtimeId="11111111-1111-4111-8111-111111111111", now=1_000_000, installation="e".repeat(32);
function fixture() {
  const expected:PlacementRequest={organizationId:"org",ownerUserId:"owner",projectId:"project",workspaceId:"workspace",bindingHash:"a".repeat(64),bindingEpoch:4,runtimeId,runtimeRevision:3,backendName:`ingenium-runtime-${runtimeId.replaceAll("-","")}`,backendContainerId:"b".repeat(64),now};
  const container:ManagedContainerFacts={Id:expected.backendContainerId,Name:"/"+expected.backendName,State:{Status:"running",Health:{Status:"healthy"}},Config:{Labels:{"com.ingenium.managed":"runtime-manager","com.ingenium.runtime.id":runtimeId,"com.ingenium.runtime.organization":"org","com.ingenium.runtime.owner":"owner","com.ingenium.runtime.project":"project","com.ingenium.runtime.workspace":"workspace","com.ingenium.runtime.storage":expected.bindingHash,"com.ingenium.runtime.security-epoch":"4","com.ingenium.runtime.revision":"3","org.opencontainers.image.revision":"c".repeat(40)}}};
  return {expected,container,observation:observeManagedRuntime(container,"actual-daemon-owner",now)};
}
describe("original manager placement owner facts",()=>{
  it("admits exact current owner evidence without publishing the raw daemon identity",()=>{
    const {expected,observation}=fixture(),placement=qualifyManagedRuntimePlacement(expected,observation,installation);
    expect(placement).toMatchObject({runtimeId,workspaceId:expected.workspaceId,environmentId:`managed-runtime-v1:${installation}`});
    expect(placement?.hostId).toMatch(/^docker-daemon:[a-f0-9]{64}$/u);expect(JSON.stringify(observation)).not.toContain("actual-daemon-owner");
    expect(Object.isFrozen(observation)).toBe(true);expect(Object.isFrozen(placement)).toBe(true);
  });
  it("preserves host/environment identity over replacement runtime containers in the same installation",()=>{
    const {expected,container,observation}=fixture(),nextId="22222222-2222-4222-8222-222222222222";
    container.Id="d".repeat(64);container.Name=`/ingenium-runtime-${nextId.replaceAll("-","")}`;container.Config!.Labels!["com.ingenium.runtime.id"]=nextId;
    const replacement=observeManagedRuntime(container,"actual-daemon-owner",now+1);
    const current=qualifyManagedRuntimePlacement(expected,observation,installation)!;
    const next=qualifyManagedRuntimePlacement({...expected,runtimeId:nextId,backendName:container.Name.slice(1),backendContainerId:container.Id,now:now+1},replacement,installation)!;
    expect(next.hostId).toBe(current.hostId);expect(next.environmentId).toBe(current.environmentId);expect(next.runtimeId).not.toBe(current.runtimeId);
  });
  it("separates another real daemon or installation",()=>{
    const {expected,container,observation}=fixture(),original=qualifyManagedRuntimePlacement(expected,observation,installation)!;
    const foreign=observeManagedRuntime(container,"different-daemon-owner",now);
    expect(qualifyManagedRuntimePlacement(expected,foreign,installation)?.hostId).not.toBe(original.hostId);
    expect(qualifyManagedRuntimePlacement(expected,observation,"f".repeat(32))?.environmentId).not.toBe(original.environmentId);
  });
  it("rejects absent daemon identity and nonmanaged or malformed runtime facts",()=>{
    for(const change of [(c:ManagedContainerFacts)=>{c.Config!.Labels!["com.ingenium.managed"]="other";},(c:ManagedContainerFacts)=>{c.Id="not-a-container";},(c:ManagedContainerFacts)=>{c.Config!.Labels!["com.ingenium.runtime.id"]="-".repeat(36);c.Name="/ingenium-runtime-";}]) {
      const {container}=fixture();change(container);expect(()=>observeManagedRuntime(container,"actual-daemon-owner",now)).toThrow();
    }
    expect(()=>observeManagedRuntime(fixture().container,undefined,now)).toThrow();
  });
  it("does not turn running without positive health into available placement",()=>{
    for(const [state,health] of [["running","starting"],["exited","healthy"],["running","unhealthy"]]){
      const {container}=fixture();container.State={Status:state,Health:{Status:health}};expect(()=>observeManagedRuntime(container,"daemon",now)).toThrow();
    }
  });
  it("refuses malformed or unsafe epoch/revision/clock evidence",()=>{
    for(const value of ["-1","01","1.5","9007199254740992"]){const {container}=fixture();container.Config!.Labels!["com.ingenium.runtime.security-epoch"]=value;expect(()=>observeManagedRuntime(container,"daemon",now)).toThrow();}
    expect(()=>observeManagedRuntime(fixture().container,"daemon",Number.MAX_SAFE_INTEGER)).toThrow();
  });
  it("requires every original scope, epoch, revision and container identity to match",()=>{
    const {expected,observation}=fixture();
    for(const field of ["organizationId","ownerUserId","projectId","workspaceId","bindingHash","bindingEpoch","runtimeId","runtimeRevision","backendName","backendContainerId"] as const){
      const value=expected[field],changed={...expected,[field]:typeof value==="number"?value+1:value+"x"};
      expect(qualifyManagedRuntimePlacement(changed,observation,installation),field).toBeNull();
    }
  });
  it("refuses future, expired, widened-duration and malformed protocol observations",()=>{
    const {expected,observation}=fixture();
    expect(qualifyManagedRuntimePlacement({...expected,now:now-1},observation,installation)).toBeNull();
    expect(qualifyManagedRuntimePlacement({...expected,now:now+5_000},observation,installation)).toBeNull();
    expect(isManagedRuntimeObservation({...observation,expiresAt:now+30_000})).toBe(false);
    expect(isManagedRuntimeObservation({...observation,schemaVersion:2})).toBe(false);
    expect(isManagedRuntimeObservation({...observation,credential:"must-not-appear"})).toBe(false);
    expect(qualifyManagedRuntimePlacement(expected,observation,"display-label")).toBeNull();
  });
  it("snapshots owner metadata instead of retaining mutable labels",()=>{
    const {container,observation}=fixture();container.Config!.Labels!["com.ingenium.runtime.owner"]="changed";
    expect(observation.ownerUserId).toBe("owner");expect(observation.runtimeId).toBe(runtimeId);
  });
});