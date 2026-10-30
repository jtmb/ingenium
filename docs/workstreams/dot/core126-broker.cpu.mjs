import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {stripTypeScriptTypes} from "node:module";
import {createCore126Broker} from "./core126-broker.proposal.mjs";
import {createCore126Handlers,createCore126ToolAuthorizer} from "./core126-http-broker.proposal.mjs";
import {createJobRunMcpClient} from "./job-run-mcp-client.proposal.ts";
const root=process.env.VEYRA_DOT_PROPOSAL_SOURCE_ROOT;if(!root)throw Error("Actual source root required");
const source=f=>readFileSync(`${root}/${f}`,"utf8");
const moduleUrl=s=>`data:text/javascript;base64,${Buffer.from(s).toString("base64")}`;
const policy=await import(moduleUrl(stripTypeScriptTypes(source("packages/ingenium-core/lib/tools/mcp-authorization-policy.ts"))));
const catalogSource=stripTypeScriptTypes(source("packages/ingenium-core/lib/tools/mcp-tool-catalog.ts")).replace('from "./mcp-authorization-policy.js"',`from "${moduleUrl(stripTypeScriptTypes(source("packages/ingenium-core/lib/tools/mcp-authorization-policy.ts")))}"`);
const catalog=await import(moduleUrl(catalogSource));
const runId="11111111-1111-4111-8111-111111111111",attemptId="22222222-2222-4222-8222-222222222222";
const credential={id:"c",kind:"job-run",audience:"job-run",runId,attemptId,servicePrincipalId:"original",projectId:"p",organizationId:"o",workspaceId:"w",scopes:["projects:read","memory:read"]};
function setup(){let current=true,enabled=true,lookups=0;
 const owner={assignment(id,c){if(!current||id!==runId||c.attemptId!==attemptId)throw Object.assign(Error("denied"),{status:403});return {};}};
 const toolStates={getAllTools:catalog.getCatalogMap,getToolState:()=>enabled};
 const authorizeTool=createCore126ToolAuthorizer({credentials:{},mcpAuthorizationPolicy:policy,authorization:{requireProjectPermission:()=>({allowed:current})},jobs:{isJobRunAuthorizationCurrent:()=>current},toolCatalog:{getTool:n=>catalog.getCatalogMap().get(n)}});
 const projects={getProjectById:id=>id==="p"?{id:"p",name:"owned",organization_id:"o",archived_at:null}:undefined,getProjectDetail:name=>{lookups++;assert.equal(name,"owned");return {id:"p",name};}};
 const broker=createCore126Broker({owner,authorizeTool,toolStates,projects});
 const handlers=createCore126Handlers({owner,managerGuard:{context(){throw Error("not a manager fixture");}},credentials:{inspectManagedJobCredential:t=>current&&t==="private"?credential:undefined},authorizeTool,dispatchExistingTool:broker.dispatch,listAuthorizedTools:broker.list});
 const request=(operation,method="GET",body)=>({path:`/runtime/job-runs/${runId}/${operation}`,method,headers:{authorization:"Bearer private","x-ingenium-audience":"job-run","x-ingenium-job-attempt":attemptId},body});
 return {broker,handlers,authorizeTool,request,projects,setCurrent:v=>current=v,setEnabled:v=>enabled=v,lookups:()=>lookups};
}
test("actual original policy/catalog/schema: only project_detail is eligible",()=>{const f=setup();assert.deepEqual(f.broker.list(credential).map(t=>t.name),["ingenium_project_detail"]);assert.equal(policy.explicitMcpAuthorizationPolicy("ingenium_memory_read","Memory").target,"private");assert.equal(policy.explicitMcpAuthorizationPolicy("ingenium_project_list","Projects").target,"installation");const s=source("services/ingenium-server/scripts/mcp-server.ts");assert.ok(s.includes('inputSchema: { name: z.string() }'));assert.ok(s.includes('projectTools.projectDetail(name)'));});
test("actual broker invokes existing Core project detail only for exact bound project",async()=>{const f=setup();const a=f.authorizeTool(credential,"ingenium_project_detail",{name:"owned"});const r=await f.broker.dispatch(a,{name:"owned"},credential);assert.equal(JSON.parse(r.content[0].text).id,"p");assert.equal(f.lookups(),1);});
for(const body of [{name:"other"},{name:"owned",projectId:"foreign"},{name:"owned",extra:true},{name:3},null])test(`closed arguments reject ${JSON.stringify(body)}`,async()=>{const f=setup(),a=f.authorizeTool(credential,"ingenium_project_detail",{});await assert.rejects(f.broker.dispatch(a,body,credential));assert.equal(f.lookups(),0);});
test("toggle and grant revocation deny list/call",async()=>{const f=setup(),a=f.authorizeTool(credential,"ingenium_project_detail",{});f.setEnabled(false);assert.deepEqual(f.broker.list(credential),[]);await assert.rejects(f.broker.dispatch(a,{name:"owned"},credential));f.setCurrent(false);assert.throws(()=>f.broker.list(credential));assert.equal(f.lookups(),0);});
test("forged prior decision cannot escape bound attempt",async()=>{const f=setup(),a=f.authorizeTool(credential,"ingenium_project_detail",{});await assert.rejects(f.broker.dispatch({...a,attemptId:"other"},{name:"owned"},credential));assert.equal(f.lookups(),0);});
test("HTTP list and dispatch use current original sidecar credential",async()=>{const f=setup();const list=await f.handlers.runtime(f.request("mcp-tools"));assert.equal(list.data.length,1);const call=await f.handlers.runtime(f.request("mcp/ingenium_project_detail","POST",{name:"owned"}));assert.equal(JSON.parse(call.data.content[0].text).name,"owned");f.setCurrent(false);await assert.rejects(f.handlers.runtime(f.request("mcp-tools")));});
for(const [key,value] of [["x-ingenium-audience","runtime"],["x-ingenium-job-attempt","wrong"],["cookie","s=x"],["origin","http://local"]])test(`HTTP rejects ${key}`,async()=>{const f=setup(),r=f.request("mcp-tools");r.headers[key]=value;await assert.rejects(f.handlers.runtime(r));assert.equal(f.lookups(),0);});
const environment={INGENIUM_MCP_AUDIENCE:"job-run",INGENIUM_MCP_CREDENTIAL_FILE:"/run/ingenium-runtime/capability",INGENIUM_JOB_RUN_ID:runId,INGENIUM_JOB_ATTEMPT_ID:attemptId,INGENIUM_API_URL:"http://api:4097/api/v1"};
function client(fetchImpl,extra={}){return createJobRunMcpClient({environment:{...environment,...extra},readCredential:()=>"private",fetchImpl});}
test("dedicated client emits exact audience/attempt and fixed original run path",async()=>{let seen;const c=client(async(url,init)=>{seen={url:String(url),init};return Response.json({data:[]});});assert.deepEqual(await c.listTools(),[]);assert.equal(seen.url,`http://api:4097/api/v1/runtime/job-runs/${runId}/mcp-tools`);assert.equal(seen.init.headers["X-Ingenium-Job-Attempt"],attemptId);assert.equal(seen.init.headers["X-Ingenium-Audience"],"job-run");assert.equal(seen.init.redirect,"error");});
test("dedicated client never retries ambiguous dispatch",async()=>{let calls=0;const c=client(async()=>{calls++;throw Error("network");});await assert.rejects(c.callTool("ingenium_project_detail",{name:"owned"}));assert.equal(calls,1);});
test("dedicated client rejects malformed/oversized responses",async()=>{for(const response of [Response.json({data:{tools:[]}}),new Response("x".repeat(1048577)),new Response("bad"),new Response("no",{status:403})]){await assert.rejects(client(async()=>response).listTools());}});
test("dedicated client rejects fallback identities and alternate files",()=>{for(const extra of [{INGENIUM_MCP_AUDIENCE:"runtime"},{INGENIUM_MCP_CREDENTIAL_FILE:"/tmp/token"},{INGENIUM_JOB_ATTEMPT_ID:""},{INGENIUM_API_URL:"http://u:p@api/api/v1"},{INGENIUM_API_URL:"http://api/api/v1?x=1"}])assert.throws(()=>client(async()=>Response.json({data:[]}),extra));});
test("launcher private branch precedes generic preflight and never provisions",()=>{const s=readFileSync(new URL("./mcp-launcher-job-run.proposal.ts",import.meta.url),"utf8");assert.ok(s.indexOf('if (process.env.INGENIUM_MCP_AUDIENCE === "job-run")')<s.indexOf('const preflight = preflightMcpLauncher(worktree)'));assert.ok(source("services/ingenium-api/lib/middleware/auth.ts").includes('audience !== "mcp" && audience !== "runtime" && audience !== "repository-sync"'));});

test("original Core project detail and toggle functions execute against memory-only SQLite",async()=>{
 const db=new DatabaseSync(":memory:");
 try{
  db.exec(`CREATE TABLE projects(id TEXT,name TEXT,organization_id TEXT,archived_at TEXT);CREATE TABLE skills(project_id TEXT,name TEXT,description TEXT,created_at TEXT,enabled INTEGER);CREATE TABLE observations(project_id TEXT,status TEXT,observation_type TEXT,content TEXT,created_at TEXT);CREATE TABLE pipeline_events(project_id TEXT,event_type TEXT,title TEXT,created_at TEXT);CREATE TABLE mcp_tool_states(project_id TEXT,tool_name TEXT,enabled INTEGER);INSERT INTO projects VALUES('p','owned','o',NULL),('foreign','other','o',NULL);INSERT INTO skills VALUES('p','owned-skill','allowed','2026',1),('foreign','secret','denied','2026',1);`);
  const extract=(file,name)=>{const raw=source(file);const start=raw.indexOf(`export function ${name}(`);assert.ok(start>=0);const end=raw.indexOf("\n}",start)+2;return stripTypeScriptTypes(raw.slice(start,end)).replace("export ","");};
  const byId=new Function("getDb",`${extract("packages/ingenium-core/lib/tools/projects.ts","getProjectById")};return getProjectById;`)(()=>db);
  const detail=new Function("getDb",`${extract("packages/ingenium-core/lib/tools/projects.ts","getProjectDetail")};return getProjectDetail;`)(()=>db);
  const state=new Function("getDb","getAllTools",`${extract("packages/ingenium-core/lib/tools/mcp-tool-states.ts","getToolState")};return getToolState;`)(()=>db,catalog.getCatalogMap);
  const f=setup();const broker=createCore126Broker({owner:{assignment(){return {};}},authorizeTool:f.authorizeTool,toolStates:{getAllTools:catalog.getCatalogMap,getToolState:state},projects:{getProjectById:byId,getProjectDetail:detail}});
  const authorized=f.authorizeTool(credential,"ingenium_project_detail",{name:"owned"});const result=await broker.dispatch(authorized,{name:"owned"},credential);const parsed=JSON.parse(result.content[0].text);assert.equal(parsed.project.id,"p");assert.equal(parsed.recent_skills[0].name,"owned-skill");assert.ok(!result.content[0].text.includes('secret'));
  db.prepare("INSERT INTO mcp_tool_states VALUES(?,?,0)").run("p","ingenium_project_detail");assert.deepEqual(broker.list(credential),[]);await assert.rejects(broker.dispatch(authorized,{name:"owned"},credential));
 }finally{db.close();}
});

test("typed Express ingress consumes exact private namespace without creating a principal",async()=>{
 const raw=stripTypeScriptTypes(readFileSync(new URL("./core126-ingress.proposal.ts",import.meta.url),"utf8")).replace("export function","function");const create=new Function(`${raw};return createCore126Ingress;`)();
 let entered=0,next=0,status=200,json;
 const route=create({internal:async()=>{entered++;return {data:{safe:true}};},runtime:async()=>null});
 const res={status(v){status=v;return this;},json(v){json=v;return this;}};
 const request={path:`/api/v1/internal/managed-job-runs/${runId}/admission`,method:"GET",headers:{},query:{action:"inspect"}};
 route(request,res,()=>next++);await new Promise(r=>setImmediate(r));assert.equal(entered,1);assert.equal(next,0);assert.equal(request.principal,undefined);assert.deepEqual(json,{data:{safe:true}});
 route({...request,path:"/api/v1/projects"},res,()=>next++);assert.equal(next,1);
 route({...request,path:`/api/v1/runtime/job-runs/${runId}/unsupported`},res,()=>next++);await new Promise(r=>setImmediate(r));assert.equal(status,404);assert.equal(next,1);
 route({...request,headers:{cookie:"s=x"}},res,()=>next++);assert.equal(status,404);assert.equal(entered,1);
});
test("dedicated SDK source delegates fresh tools/list and tools/call without generic startup",async()=>{
 const raw=stripTypeScriptTypes(readFileSync(new URL("./job-run-mcp-transport.proposal.ts",import.meta.url),"utf8")).replace(/^import .*;$/gm,"").replace("export async function","async function");
 let lists=0,calls=0,connected=0;const handlers=new Map();const client={async listTools(){lists++;return [];},async callTool(name,args){calls++;assert.equal(name,"ingenium_project_detail");assert.deepEqual(args,{name:"owned"});return {content:[]};}};
 class Server{setRequestHandler(schema,fn){handlers.set(schema,fn);}async connect(){connected++;}async close(){}}
 const localProcess={once(){}};const run=new Function("Server","StdioServerTransport","ListToolsRequestSchema","CallToolRequestSchema","createJobRunMcpClient","process",`${raw};return runJobRunMcpTransport;`)(Server,class{},"list","call",()=>client,localProcess);
 await run();assert.equal(lists,1);assert.equal(connected,1);await handlers.get("list")();await handlers.get("list")();assert.equal(lists,3);await handlers.get("call")({params:{name:"ingenium_project_detail",arguments:{name:"owned"}}});assert.equal(calls,1);
});
