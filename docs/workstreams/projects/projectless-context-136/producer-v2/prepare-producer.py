# SOURCE generator only: no shared apply, tests, DB/Docker, builds or downloads.
from pathlib import Path
import hashlib,json,difflib,re
P=Path(__file__).resolve().parent
C=Path('/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/prd-ui-fixes')
pins=[];patch=[]
def read(rel):
 raw=(C/rel).read_bytes();pins.append({'path':rel,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()});return raw.decode()
def one(s,a,b):
 if s.count(a)!=1:raise ValueError(('PREIMAGE_MISMATCH',a,s.count(a)))
 return s.replace(a,b)
def emit(rel,a,b):patch.extend(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='a/'+rel,tofile='b/'+rel))
rel='services/ingenium-api/scripts/runtime-manager.ts';old=read(rel)
new="import {workspaceDocker,workspaceDockerJson,joinWorkspaceAttach,requireRetainedWorkspaceAttach} from '../lib/projects-v2/workspace-manager-wire.mjs';\nimport {verifyWorkspaceArchive} from '../lib/projects-v2/workspace-v2-image.mjs';\nimport {parseStrictJobJson} from '../lib/dot-v2/job-bootstrap-frame.mjs';\nimport {buildWorkspaceRuntimeContainerSpecV2,type WorkspaceRuntimeProvisionRequestV2} from '../lib/runtime-manager-contract.js';\n"+old
new=one(new,'export function startRuntimeManager()', (P/'manager-fragment.ts').read_text()+'\nexport function startRuntimeManager()')
anchor='      if (request.method === "POST" && url.pathname === "/v1/runtimes") {'
route='''      // Separate exact v2 route under the SAME original protected manager token.
      if(request.headers.cookie===undefined&&request.headers.origin===undefined&&url.search===''){
        if(request.method==='POST'&&url.pathname==='/v2/workspace-runtimes'){
          const data=await provisionOriginalWorkspaceV2(await readJsonBody(request) as Record<string,unknown>,mappings);
          response.writeHead(200).end(JSON.stringify({data}));return;
        }
        const v2=/^\\/v2\\/workspace-runtimes\\/([a-f0-9-]+)\\/placement$/.exec(url.pathname);
        if(request.method==='GET'&&v2&&UUID.test(v2[1]!)){
          const data=await observeOriginalWorkspaceV2(v2[1]!);response.writeHead(200).end(JSON.stringify({data}));return;
        }
      }
'''
new=one(new,anchor,route+anchor);emit(rel,old,new)
rel='services/ingenium-api/lib/runtime-manager-client.ts';old=read(rel);emit(rel,old,old+'\n'+(P/'client-fragment.ts').read_text())
rel='services/ingenium-api/lib/dot-v2/core126-installed-image-owner.ts';old=read(rel)
new="import {workspaceV2ImageDefinition} from '../projects-v2/workspace-v2-image.mjs';\n"+old+'\n'+(P/'installed-image-fragment.ts').read_text();emit(rel,old,new)
rel='services/ingenium-api/lib/runtime-placement.ts';old=read(rel);new="import {withManagedWorkspaceV2Placement} from './projects-v2/workspace-v2-placement.mjs';\n"+old
new=one(new,'if(selection.projectId===null)throw new RequestExecutionError("PROJECTLESS_EXECUTION_OWNER_UNAVAILABLE",503);','if(selection.projectId===null)return withManagedWorkspaceV2Placement(request,selection,work);')
emit(rel,old,new)
rel='services/ingenium-api/lib/projects-v2/request-execution.ts';old=read(rel);new="import {resolveCurrentWorkspaceV2Execution} from './workspace-v2-placement.mjs';\n"+old
new=one(new,'  return resolver.resolveRequestExecution(request, selection);','  if(selection.projectId===null)return resolveCurrentWorkspaceV2Execution(request,selection);\n  return resolver.resolveRequestExecution(request, selection);')
# Engine/chat binding stays closed pending retained original engine producers.
emit(rel,old,new)
rel='services/ingenium-api/scripts/api-server.ts';old=read(rel)
new="import {workspaceV2McpIngress} from '../lib/projects-v2/workspace-v2-mcp.mjs';\nimport {workspaceV2PrivateIngress,provisionWorkspaceRuntimeFromRequestV2,refreshWorkspaceRuntimeFromRequestV2} from '../lib/projects-v2/workspace-v2-control.mjs';\n"+old
new=one(new,'app.use(authMiddleware);','app.use(workspaceV2PrivateIngress); // exact manager/bootstrap audiences only\napp.use(workspaceV2McpIngress);\napp.use(authMiddleware);')
route='''// Real session/CSRF/rate admission above; explicit canonical workspace owner
// authorization precedes the legacy Project route mapper for these exact routes.
app.post('/api/v1/runtimes/workspace-v2/provision',async(req,res)=>{
 try{if(req.originalUrl!==req.path)throw Error('exact path');res.status(202).json({data:await provisionWorkspaceRuntimeFromRequestV2(req,req.body)});}
 catch{res.status(503).json({error:{code:'WORKSPACE_V2_PROVISION_UNAVAILABLE'}});}
});
app.post('/api/v1/runtimes/workspace-v2/refresh',async(req,res)=>{
 try{if(req.originalUrl!==req.path)throw Error('exact path');res.status(200).json({data:await refreshWorkspaceRuntimeFromRequestV2(req,req.body)});}
 catch{res.status(503).json({error:{code:'WORKSPACE_V2_PLACEMENT_UNAVAILABLE'}});}
});
'''
new=one(new,'app.use(authorizationMiddleware);',route+'app.use(authorizationMiddleware);');emit(rel,old,new)
rel='scripts/runtime-entrypoint.sh';old=read(rel)
branch='''# Explicit v2 branch, without a Project default/sentinel/adoption.
case "${INGENIUM_EXECUTION_SCOPE:-project}" in
  workspace)
    if [ "${INGENIUM_PROJECT+x}" = x ] || [ "${INGENIUM_PROJECT_ID+x}" = x ] || [ "${INGENIUM_PROJECT_NAME+x}" = x ]; then
      echo "ERROR: ambiguous runtime scope"; exit 1
    fi
    exec node /app/services/ingenium-api/dist/scripts/runtime-workspace-bootstrap.mjs
    ;;
  project) ;;
  *) echo "ERROR: runtime scope unavailable"; exit 1 ;;
esac

'''
new=one(old,'for name in HOME XDG_CONFIG_HOME',branch+'for name in HOME XDG_CONFIG_HOME');emit(rel,old,new)
rel='scripts/start-runtime-opencode-web.sh';old=read(rel)
branch='''if [ "${INGENIUM_EXECUTION_SCOPE:-project}" = workspace ]; then
  for name in INGENIUM_API_URL INGENIUM_ORGANIZATION_ID INGENIUM_RUNTIME_ID INGENIUM_RUNTIME_OWNER_ID INGENIUM_WORKSPACE_ID INGENIUM_STORAGE_MAPPING_HASH; do
    eval "value=\\${$name:-}"; if [ -z "$value" ]; then echo "ERROR: workspace runtime identity incomplete"; exit 1; fi
  done
  if [ "${INGENIUM_PROJECT+x}" = x ] || [ "${INGENIUM_PROJECT_ID+x}" = x ]; then echo "ERROR: ambiguous workspace runtime"; exit 1; fi
  password_file="${OPENCODE_SERVER_PASSWORD_FILE:-/run/ingenium-runtime/opencode-server-password}"
  if [ ! -r "$password_file" ]; then echo "ERROR: runtime OpenCode secret unavailable"; exit 1; fi
  opencode_server_password="$(cat "$password_file")"
  exec env -i PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" PWD="/app" \\
    HOME="/home/appuser" XDG_CONFIG_HOME="/home/appuser/.config" XDG_DATA_HOME="/home/appuser/.local/share" XDG_STATE_HOME="/home/appuser/.local/state" \\
    OPENCODE_CONFIG_DIR="/home/appuser/.config/opencode/runtime" OPENCODE_CONFIG="/usr/local/share/ingenium/opencode-managed/opencode.json" OPENCODE_SERVER_PASSWORD="$opencode_server_password" \\
    INGENIUM_EXECUTION_SCOPE=workspace INGENIUM_API_URL="$INGENIUM_API_URL" INGENIUM_ORGANIZATION_ID="$INGENIUM_ORGANIZATION_ID" INGENIUM_RUNTIME_ID="$INGENIUM_RUNTIME_ID" \\
    INGENIUM_RUNTIME_OWNER_ID="$INGENIUM_RUNTIME_OWNER_ID" INGENIUM_WORKSPACE_ID="$INGENIUM_WORKSPACE_ID" INGENIUM_STORAGE_MAPPING_HASH="$INGENIUM_STORAGE_MAPPING_HASH" \\
    INGENIUM_WORKTREE=/workspace INGENIUM_MCP_AUDIENCE=runtime INGENIUM_MCP_CREDENTIAL_FILE=/run/ingenium-runtime/capability INGENIUM_RUNTIME_CREDENTIAL_FILE=/run/ingenium-runtime/capability \\
    opencode serve --port 4098 --hostname 0.0.0.0
fi

'''
new=one(old,'for name in INGENIUM_API_URL',branch+'for name in INGENIUM_API_URL');emit(rel,old,new)
rel='packages/ingenium-core/lib/tools/mcp-tool-catalog.ts';old=read(rel)
new=one(old,'projectScope: "per-project" | "global";', 'projectScope: "per-project" | "global" | "workspace";\n  workspaceRuntimeV2?: {protocol:2;enabled:boolean;inputSchema:Record<string,unknown>};')
anchor='import { explicitMcpAuthorizationPolicy } from "./mcp-authorization-policy.js";'
entry='''// Single canonical definition; legacy Project facet remains disabled by default.
MCP_TOOL_CATALOG.push({name:"ingenium_workspace_runtime_scope",category:"Runtime",
 description:"Read this credential-owned private workspace/runtime binding; canonical state is not fresh execution readiness.",
 projectScope:"workspace",defaultEnabled:false,apiEndpoints:["POST /api/v1/runtime/workspace-v2/mcp/call"],
 workspaceRuntimeV2:{protocol:2,enabled:true,inputSchema:{type:"object",properties:{},additionalProperties:false}}});

'''
new=one(new,anchor,entry+anchor);emit(rel,old,new)
rel='packages/ingenium-core/lib/tools/mcp-authorization-policy.ts';old=read(rel)
anchor='  const transportName = toolName.startsWith("ingenium_")'
policy='''  if(toolName==="ingenium_workspace_runtime_scope")return {action:"runtime.read",resource:"runtime",permission:"read",target:"private",scopes:["runtime:activity"],launcherBinding:"required"};
'''
new=one(old,anchor,policy+anchor);emit(rel,old,new)
rel='services/ingenium-server/scripts/mcp-server.ts';old=read(rel)
anchor='const C = (name: string) => `ingenium_${name}`;'
# Registration comes after server construction, found by its concrete registerTool prefix.
index=re.search(r'^server\.registerTool\(',old,re.MULTILINE).start()
registration='''// Canonical workspace-only tool is a negative, normally hidden legacy facet.
server.registerTool("workspace_runtime_scope", {description:"Requires the original workspace-runtime-v2 transport.",inputSchema:{}},
 wrapHandler(C("workspace_runtime_scope"),async()=>({isError:true,content:[{type:"text" as const,text:JSON.stringify({code:"WORKSPACE_RUNTIME_V2_REQUIRED"})}]})));

'''
new=old[:index]+registration+old[index:];emit(rel,old,new)
rel='packages/ingenium-extension/scripts/mcp-server.ts';old=read(rel)
new=one(old,'#!/usr/bin/env node\n','#!/usr/bin/env node\nexport async function bootstrapWorkspaceRuntimeV2(hints:import("./workspace-runtime-mcp-client.js").WorkspaceMcpHints){const original=await import("./workspace-runtime-mcp-transport.js");return original.bootstrapWorkspaceRuntimeV2(hints); }\n')
anchor='  const preflight = preflightMcpLauncher(worktree);'
branch='''  // Dedicated actual workspace facet before ANY generic Project preflight.
  if(process.env.INGENIUM_EXECUTION_SCOPE==="workspace"){
    try{const {runWorkspaceRuntimeMcpTransportV2}=await import("./workspace-runtime-mcp-transport.js");await runWorkspaceRuntimeMcpTransportV2();return 0;}
    catch{writeLauncherFailure("authentication","Workspace runtime MCP owner unavailable.");return 2;}
  }
'''
new=one(new,anchor,branch+anchor);emit(rel,old,new)
rel='packages/ingenium-extension/scripts/build-distributions.mjs';old=read(rel)
new=one(old,'"scripts/job-run-mcp-client.js", "scripts/job-run-mcp-transport.js",','"scripts/job-run-mcp-client.js", "scripts/job-run-mcp-transport.js", "scripts/workspace-runtime-mcp-client.js", "scripts/workspace-runtime-mcp-transport.js",')
emit(rel,old,new)
rel='services/ingenium-api/lib/runtime-opencode-context.ts';old=read(rel)
new="import {runtimeWorkspaceOpenCodeContextV2} from './projects-v2/workspace-v2-opencode.mjs';\n"+old
anchor='  const runtime = runtimes.getRuntimeInstance(id);'
new=one(new,anchor,'  if(runtimeWorkspaceOpenCodeContextV2(req,res,next,id))return; // actual v2 row + fresh scope only\n'+anchor);emit(rel,old,new)
rel='services/ingenium-api/lib/routes/runtimes.ts';old=read(rel)
new="import {validateWorkspaceGatewaySessionV2} from '../projects-v2/workspace-v2-gateway.mjs';\n"+old
anchor='runtimesRouter.post("/gateway/validate", (req, res) => {'
new=one(new,anchor,'runtimesRouter.post("/gateway/validate", async (req, res) => {')
a=new.index('runtimesRouter.post("/gateway/validate"');z=new.index('runtimesRouter.post("/gateway/activity"',a);part=new[a:z]
anchor='  const resolved = runtimes.resolveRuntimeBrowserSession({'
branch='''  // Secret-bearing v2 response is ONLY for the original private gateway principal.
  if(req.principal?.type==='runtime-service'&&req.principal.id==='runtime-gateway'&&req.principal.audience==='runtime-gateway'){
    try{const workspace=await validateWorkspaceGatewaySessionV2(parsed.data);if(workspace){res.set('Cache-Control','no-store');res.json({data:workspace});return;}}
    catch{res.status(503).json({error:{code:'WORKSPACE_V2_GATEWAY_UNAVAILABLE'}});return;}
  }
'''
part=one(part,anchor,branch+anchor);new=new[:a]+part+new[z:];emit(rel,old,new)
rel='services/ingenium-api/scripts/runtime-gateway.ts';old=read(rel);new=old
new=one(new,'type ValidatedSession = {','type ValidatedSession = {\n  workspaceV2AuthHeader?: string; // private Core response only; never browser headers')
new=one(new,'scope: RuntimeScope, websocket = false): IncomingHttpHeaders','scope: RuntimeScope, websocket = false, workspaceV2AuthHeader?:string): IncomingHttpHeaders')
new=one(new,'  result.host = scope.host;','  if(workspaceV2AuthHeader!==undefined){if(!/^Basic [A-Za-z0-9+/]+={0,2}$/.test(workspaceV2AuthHeader))throw Error("WORKSPACE_V2_AUTH_HEADER");if(scope.audience==="web")result.authorization=workspaceV2AuthHeader;}\n  result.host = scope.host;')
new=one(new,'async function backendReady(scope: RuntimeScope, backendName: string)', 'async function backendReady(scope: RuntimeScope, backendName: string,workspaceV2AuthHeader?:string)')
new=one(new,'headers: sanitizedHeaders({}, scope),','headers: sanitizedHeaders({}, scope,false,workspaceV2AuthHeader),')
new=one(new,'backendReady(scope, resolved.backendName)','backendReady(scope, resolved.backendName,resolved.workspaceV2AuthHeader)')
new=one(new,'headers: sanitizedHeaders(request.headers, scope),','headers: sanitizedHeaders(request.headers, scope,false,resolved.workspaceV2AuthHeader),')
new=one(new,'headers: sanitizedHeaders(request.headers, scope, true),','headers: sanitizedHeaders(request.headers, scope,true,resolved.workspaceV2AuthHeader),')
emit(rel,old,new)
rel='services/ingenium-api/lib/mcp-usefulness-collector.ts';old=read(rel);new=one(old,'projectScope: "per-project" | "global";','projectScope: "per-project" | "global" | "workspace";');emit(rel,old,new)
rel='scripts/start-ttyd.sh';old=read(rel)
anchor='for candidate in \\\n  /run/ingenium-secrets/ttyd/opencode-server-password \\\n  /run/ingenium-runtime/opencode-server-password; do'
new=one(old,anchor,'''if [ "${INGENIUM_EXECUTION_SCOPE:-project}" = workspace ]; then
  if [ ! -r /run/ingenium-runtime/opencode-server-password ]; then echo "ERROR: workspace OpenCode secret unavailable"; exit 1; fi
  opencode_server_password="$(cat /run/ingenium-runtime/opencode-server-password)"
else
'''+anchor)
new=one(new,'done\n\n# Keep the browser-facing terminal', 'done\nfi\n\n# Keep the browser-facing terminal');emit(rel,old,new)
rel='packages/ingenium-core/lib/index.ts';old=read(rel);new=old+'\nexport * as workspaceRuntimeCredentialsV2 from "./tools/workspace-runtime-credentials.mjs";\n';emit(rel,old,new)
(P/'producer.patch').write_text(''.join(patch))
for rel in ['packages/ingenium-extension/scripts/mcp-server.ts','packages/ingenium-core/lib/tools/mcp-credentials.ts','packages/veyra-operations/core126-image-contract.mjs','packages/veyra-operations/core126-image-owner.mjs','services/ingenium-api/lib/runtime-provisioner.ts','services/ingenium-api/lib/projects-v2/request-execution-owner.mjs']:read(rel)
for path in ['packages/ingenium-core/data/migrations/117_mcp_credential_receipts.sql','packages/ingenium-core/lib/tools/authentication.ts','services/ingenium-api/lib/opencode-client.ts','scripts/project-agent-profiles.mjs','runtime-supervisord.conf','packages/ingenium-extension/api-auth.ts','packages/ingenium-extension/extension-binding.ts','packages/ingenium-extension/project-resolver.ts']:read(path)
unique={}
for pin in pins:
 if pin['path'] in unique and unique[pin['path']]!=pin:raise ValueError(('SOURCE_CHANGED_DURING_READ',pin['path']))
 unique[pin['path']]=pin
pins=list(unique.values())
(P/'source-pins.json').write_text(json.dumps({'fixedSource':str(C),'files':pins,'prerequisiteCheckpoint':'22164b203c95746da43120b6dbf0d8209f9b7529'},separators=(',',':'))+'\n')
print(json.dumps({'patchBytes':(P/'producer.patch').stat().st_size,'pins':len(pins)}))
