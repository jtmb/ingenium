import test from "node:test";
import assert from "node:assert/strict";
import {NativeProjectCatalogAdapter} from "../lib/projects-v2/native-catalog.mjs";
import {conversationWorkspace} from "../../../packages/veyra-projects/context.mjs";
const scope={instanceId:"install",organizationId:"org",ownerUserId:"alice"};
const project={id:"native-project",name:"Alpha",environment:{kind:"wsl",distro:"Ubuntu",user:"alice"},
  primary_root:"/home/alice/alpha",roots:["/home/alice/alpha"],revision:7,archived:false,pinned:true};
function fixture() {
  let captured;
  const owner={async getProject(){return {instanceId:"native-a",project};},
    async updateProject(request){captured=request;return {instanceId:"native-a",project:{...project,revision:8,name:request.request.name}};}};
  const adapter=new NativeProjectCatalogAdapter({owner,instanceId:"native-a",
    authorize:async(s)=>s.ownerUserId==="alice",
    resolveRoot:async(s,{directory})=>({id:"root",canonicalRootId:"inode-a",hostId:"pc",
      environmentId:"wsl:Ubuntu:alice",directory})});
  return {adapter,owner,get captured(){return captured;}};
}
test("native adapter preserves native IDs/revisions and delegates writes without copying a catalog",async()=>{
  const f=fixture();const mapped=await f.adapter.get(scope,project.id);
  assert.equal(mapped.id,project.id);assert.equal(mapped.revision,7);
  assert.equal(mapped.source.instanceId,"native-a");assert.equal(mapped.roots[0].displayPath,project.primary_root);
  const updated=await f.adapter.update(scope,project.id,7,{label:"renamed"});
  assert.equal(updated.revision,8);assert.equal(f.captured.request.expected_revision,7);
  assert.equal(f.captured.expectedInstanceId,"native-a");
  await assert.rejects(()=>f.adapter.get({...scope,ownerUserId:"bob"},project.id),e=>e.code==="FORBIDDEN");
});
test("native restart identity and unresolved root cannot fall back to an app catalog",async()=>{
  const f=fixture();f.owner.getProject=async()=>({instanceId:"native-b",project});
  await assert.rejects(()=>f.adapter.get(scope,project.id),e=>e.code==="NATIVE_INSTANCE_CHANGED");
  const g=fixture();g.adapter.resolveRoot=async()=>null;
  await assert.rejects(()=>g.adapter.get(scope,project.id),e=>e.code==="ROOT_UNRESOLVED");
});
test("conversation projectless context remains explicit and bound to original workspace",()=>{
  const binding={version:1,id:"b",workspaceIdentity:"ws",hostId:"pc",environmentId:"native",securityEpoch:4,
    canonicalRootId:"inode",workspaceBindingId:"mapped",directory:"C:/work",shellId:"pwsh",
    ownerInstanceId:"service",ownerRevision:1,mappingHash:"b".repeat(64),kind:"windows"};
  const conversation={id:"chat",scope,projectId:null,bindingId:"b"};
  assert.equal(conversationWorkspace({scope,conversation,project:null,binding}).projectId,null);
  assert.throws(()=>conversationWorkspace({scope,conversation:{...conversation,projectId:undefined},
    project:null,binding}),e=>e.code==="PROJECT_SELECTION_REQUIRED");
  assert.throws(()=>conversationWorkspace({scope,conversation,project:null,binding:{...binding,id:"other"}}),
    e=>e.code==="CONVERSATION_BINDING_MISMATCH");
});
