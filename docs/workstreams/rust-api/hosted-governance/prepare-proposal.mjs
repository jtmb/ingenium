import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=process.argv[2],base='fbafc1cd0de7e8809218d9e19cca1552ae459e64';
if(!root?.startsWith('/'))throw new Error('Explicit existing Linux integration checkout required');
const edits={
  "packages/ingenium-core/lib/db.ts": [
    [
      "export function execTransaction<T>(fn: () => T, retries = WRITE_MAX_RETRIES): T {",
      "export function execTransaction<T>(fn: () => T, retries = WRITE_MAX_RETRIES, mode: \"deferred\" | \"immediate\" = \"deferred\"): T {"
    ],
    [
      "  for (let attempt = 0; attempt < retries; attempt++) {",
      "  const attempts = db!.inTransaction ? 1 : retries;\n  for (let attempt = 0; attempt < attempts; attempt++) {"
    ],
    [
      "      const result = db!.transaction(fn)();",
      "      const transaction = db!.transaction(fn);\n      const result = mode === \"immediate\" ? transaction.immediate() : transaction();"
    ],
    [
      "        attempt < retries - 1 &&",
      "        attempt < attempts - 1 &&"
    ]
  ],
  "services/ingenium-api/lib/authorization-policy.ts": [
    [
      "export type PolicyTarget = \"installation\"",
      "export type PolicyTarget = \"native-governance\" | \"installation\""
    ],
    [
      "  const route = `${req.method} ${req.path}`;",
      "  const route = `${req.method} ${req.path}`;\n  const nativeGovernance = req.method === \"GET\"\n    && /^\\/api\\/v1\\/native-customize\\/(identity|enrollments\\/[^/]+|operations(?:\\/[^/]+)?)$/.test(req.path)\n    || req.method === \"POST\" && /^\\/api\\/v1\\/native-customize\\/(enrollments|read|effects)$/.test(req.path);\n  if (nativeGovernance) return { action: \"native-governance.\" + (req.method === \"GET\" ? \"read\" : \"request\"),\n    resource: \"skills\", permission: \"read\", target: \"native-governance\", browserSessionOnly: true, sensitive: req.method === \"POST\" };"
    ],
    [
      "  if (policy.target === \"gateway-private\") {",
      "  if (policy.target === \"native-governance\") {\n    // Authentication-only admission; the closed Core owner reauthorizes mapped project/command atomically.\n    audit(req.principal, policy, \"success\");\n    return next();\n  }\n  if (policy.target === \"gateway-private\") {"
    ]
  ],
  "services/ingenium-api/scripts/api-server.ts": [
    [
      "import { authMiddleware } from \"../lib/middleware/auth.js\";",
      "import { authMiddleware } from \"../lib/middleware/auth.js\";\nimport { createNativeCustomizeRouter } from \"../lib/routes/native-customize.js\";\nimport { createNativeCustomizeContextOwner } from \"../lib/routes/native-customize-context.js\";"
    ],
    [
      "app.use(\"/api/v1/skills\", skillsRouter);",
      "app.use(\"/api/v1/skills\", skillsRouter);\n// Root injects the actual verified Native context. Undefined means enrollment/effects fail closed.\napp.use(\"/api/v1/native-customize\", createNativeCustomizeRouter({ context: createNativeCustomizeContextOwner() }));"
    ]
  ],
  "packages/veyra-customize/hosted-governance/contracts.ts": [
    [
      "op: \"approve\" | \"reject\" | \"rollback\"",
      "op: \"submit\" | \"approve\" | \"reject\" | \"rollback\""
    ],
    [
      "reviewed: {status:string;updatedAt:string;targetSkillId:string|null;sourceProjectId:string|null;sourceName:string|null;expectedRevision:number|null;expectedSourceRevision:number|null}",
      "reviewed: {status:string;updatedAt:string;targetSkillId:string|null;sourceProjectId:string|null;sourceName:string|null;expectedRevision:number|null;expectedSourceRevision:number|null;proposalHash:string;currentTarget:{id:string;revision:number}|null;currentSource:{id:string;projectId:string;name:string;revision:number}|null}"
    ],
    [
      "currentSkill?: {content: string; revision: number} | null; sourceSkill?: {projectId:string; content: string; revision: number; name: string} | null",
      "reviewed?: {status:string;updatedAt:string;targetSkillId:string|null;sourceProjectId:string|null;sourceName:string|null;expectedRevision:number|null;expectedSourceRevision:number|null;proposalHash:string;currentTarget:{id:string;revision:number}|null;currentSource:{id:string;projectId:string;name:string;revision:number}|null};\n  currentSkill?: {id:string;projectId:string;name:string;content: string; revision: number} | null; sourceSkill?: {id:string;projectId:string; content: string; revision: number; name: string} | null"
    ]
  ],
  "packages/veyra-customize/hosted-governance/client.ts": [
    [
      "const writes = new Set([\"create\",\"save\",\"archive\",\"restore\",\"enable\",\"disable\",\"approve\",\"reject\",\"rollback\",\"synthesis-run\"]);",
      "const writes = new Set([\"create\",\"save\",\"archive\",\"restore\",\"enable\",\"disable\",\"submit\",\"approve\",\"reject\",\"rollback\",\"synthesis-run\"]);"
    ],
    [
      "enable:[\"op\",\"name\",\"target\"],disable:[\"op\",\"name\",\"target\"],approve:",
      "enable:[\"op\",\"name\",\"target\"],disable:[\"op\",\"name\",\"target\"],submit:[\"op\",\"id\",\"reviewed\",\"reviewer\",\"reason\"],approve:"
    ],
    [
      "[\"status\",\"updatedAt\",\"targetSkillId\",\"sourceProjectId\",\"sourceName\",\"expectedRevision\",\"expectedSourceRevision\"]",
      "[\"status\",\"updatedAt\",\"targetSkillId\",\"sourceProjectId\",\"sourceName\",\"expectedRevision\",\"expectedSourceRevision\",\"proposalHash\",\"currentTarget\",\"currentSource\"]"
    ],
    [
      "    case \"approve\": case \"reject\": case \"rollback\":",
      "    case \"submit\": case \"approve\": case \"reject\": case \"rollback\":"
    ]
  ]
};
const appends={
  "packages/ingenium-core/lib/tools/skills.ts": "\n/** Absent-only insert in the existing outer transaction; never legacy UPSERT. */\nexport function createSkillAbsentInCurrentTransaction(\n  projectId: string, name: string, description: string, content: string,\n): Skill {\n  const database = getDb();\n  if (!database.inTransaction) throw new Error(\"Hosted skill creation requires the existing outer Core transaction\");\n  assertSafeName(name);\n  if (!database.prepare(\"SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL\").get(projectId)) {\n    throw new Error(\"Hosted target project is unavailable\");\n  }\n  const now = new Date().toISOString(), id = randomUUID();\n  database.prepare(\n    \"INSERT INTO skills(id,project_id,name,description,content,revision,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)\",\n  ).run(id,projectId,name,description,content,now,now);\n  const stored = getSkillById(id);\n  if (!stored) throw new Error(\"Hosted skill insert could not be read\");\n  writeSkillToDisk(stored);\n  return stored;\n}\n",
  "packages/ingenium-core/lib/index.ts": "\nexport { createHostedGovernance, HostedRefusal, proposalReviewHash } from \"./tools/hosted-governance.js\";\nexport type { Row as HostedGovernanceRow, VerifiedNative as VerifiedNativeGovernanceContext } from \"./tools/hosted-governance.js\";\nexport { createHostedGovernanceOwner } from \"./tools/hosted-governance-owner.js\";\nexport type { HostedGovernanceAuthentication } from \"./tools/hosted-governance-owner.js\";\n"
};
const newFiles={
  "packages/ingenium-core/lib/tools/hosted-governance.ts": "proposed/hosted-governance.ts",
  "packages/ingenium-core/lib/tools/hosted-governance-owner.ts": "proposed/hosted-governance-owner.ts",
  "services/ingenium-api/lib/routes/native-customize.ts": "proposed/native-customize.ts",
  "services/ingenium-api/lib/routes/native-customize-context.ts": "proposed/native-customize-context.ts",
  "services/ingenium-api/lib/routes/native-customize-read.ts": "proposed/native-customize-read.ts",
  "services/ingenium-api/lib/routes/native-customize-wire.ts": "wire-v1.ts",
  "packages/ingenium-core/data/migrations/125_native_hosted_governance.sql": "proposed/125_native_hosted_governance.sql"
};
edits['packages/veyra-customize/hosted-governance/client.ts'].push([
 '  const q = new URLSearchParams({project:b.apiProject}), esc=encodeURIComponent;',
 `  if("reviewed" in c) {
    const r=c.reviewed;
    const snapshot=(v:unknown,source=false)=>v===null||obj(v)&&Object.keys(v).length===(source?4:2)
      &&exactSubset(v,source?["id","revision","projectId","name"]:["id","revision"])
      &&text(v.id)&&int(v.revision)&&(!source||text(v.projectId)&&text(v.name));
    if(!obj(r)||typeof r.proposalHash!=="string"||!/^[0-9a-f]{64}$/.test(r.proposalHash)
      ||!snapshot(r.currentTarget)||!snapshot(r.currentSource,true))throw new Error("Exact reviewed proposal snapshots are required.");
  }
  const q = new URLSearchParams({project:b.apiProject}), esc=encodeURIComponent;`
]);
const read=path=>execFileSync('git',['-C',root,'show',base+':'+path],{encoding:'utf8',maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
const changes=[];
for(const [path,plan]of Object.entries(edits)){
 const before=read(path);let after=before;
 for(const [from,to]of plan){if(after.split(from).length!==2)throw new Error('Exact anchor mismatch: '+path);after=after.replace(from,to);}
 changes.push({path,before,after});
}
for(const [path,append]of Object.entries(appends)){const before=read(path);changes.push({path,before,after:before+append});}
for(const [path,source]of Object.entries(newFiles)){
 let exists=true;try{read(path);}catch{exists=false;}if(exists)throw new Error('Expected new target absent: '+path);
 changes.push({path,before:'',after:readFileSync(new URL(source,import.meta.url),'utf8'),newFile:true});
}
const python="import json,sys,difflib\nfor c in json.load(sys.stdin):\n sys.stdout.writelines(difflib.unified_diff(c['before'].splitlines(True),c['after'].splitlines(True),fromfile='/dev/null' if c.get('newFile') else 'a/'+c['path'],tofile='b/'+c['path'],n=3))\n";
const result=spawnSync('python3',['-c',python],{input:JSON.stringify(changes),encoding:'utf8',maxBuffer:4*1024*1024});
if(result.status!==0)throw new Error('Patch rendering failed');
writeFileSync(new URL('canonical-owner.patch',import.meta.url),result.stdout);
const digest=value=>createHash('sha256').update(value).digest('hex');
const manifest={schemaVersion:1,baseCommit:base,scope:'PROPOSAL ONLY; Root installs SQL125 and private wiring after exact preimage checks',
 changes:changes.map(c=>({path:c.path,expectedAbsent:!!c.newFile,preimageSha256:c.newFile?null:digest(c.before),proposedSha256:digest(c.after)})),
 patchSha256:digest(result.stdout)};
writeFileSync(new URL('preimages.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({base,files:changes.length,patchSha256:manifest.patchSha256}));
