import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const app=process.argv[2]??'/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/prd-ui-fixes';
const hash=s=>createHash('sha256').update(s).digest('hex');
const existing=fs.existsSync(here+'/scoped-source-manifest.json')?JSON.parse(fs.readFileSync(here+'/scoped-source-manifest.json','utf8')):undefined;
const rows=[];
function proposal(rel,change){const pre=fs.readFileSync(app+'/'+rel,'utf8').replace(/\r\n/g,'\n');const old=existing?.sources.find(v=>v.path===rel);if(old&&hash(pre)!==old.preimageSha256)throw Error('Actual preimage drift '+rel);const post=change(pre);const out=here+'/files/'+rel;fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,post);rows.push({path:rel,preimageSha256:hash(pre),postimageSha256:hash(post)});}
proposal('packages/ingenium-core/lib/tools/plugins.ts',pre=>{
 let s=pre;
 const edit=(a,b,count=1)=>{if(s.split(a).length-1!==count)throw Error('Exact preimage count '+a.slice(0,70));s=s.split(a).join(b);};
 edit('getPluginsBase, getConfigPath, isGlobal','getPluginsBase, getPluginConfigPath, isGlobal');edit('getConfigPath(projectId)','getPluginConfigPath(projectId)',2);
 edit('import { z } from "zod";','import { z } from "zod";\nimport {assertPluginCommandClear,validateProjectionPath,archive as archivePlugin} from "./plugin-lifecycle.js";');
 edit('if (!/^[a-zA-Z0-9_\\-./]+$/.test(filePath)) {','if (!/^[a-zA-Z0-9_\\-./]+$/.test(filePath) || filePath.split("/").some(p => !p || p === "." || p === "..")) {');
 edit('  return filePath;','  validateProjectionPath(resolved);\n  return filePath;');
 edit('    const config = JSON.parse(readFileSync(configPath, "utf-8"));','    validateProjectionPath(configPath);\n    if (!existsSync(configPath)) { mkdirSync(dirname(configPath), {recursive:true}); writeFileSync(configPath, "{}\\n", {flag:"wx"}); }\n    const config = JSON.parse(readFileSync(configPath, "utf-8"));',2);
 edit('  } catch { /* config may not exist yet — skip silently */ }','  } catch (error) { throw error; }');
 edit('  } catch { /* config may not exist — skip silently */ }','  } catch (error) { if (existsSync(getPluginConfigPath(projectId))) throw error; }');
 edit('SELECT * FROM plugins WHERE project_id = ?','SELECT * FROM plugins WHERE project_id = ? AND archived_at IS NULL',6);
 edit('WHERE project_id = ? AND name = ? RETURNING *','WHERE project_id = ? AND name = ? AND archived_at IS NULL RETURNING *');
 edit('WHERE project_id = ? AND name = ?")','WHERE project_id = ? AND name = ? AND archived_at IS NULL")',2);
 edit('  sourceContent?: string\n): Plugin {','  sourceContent?: string,\n  initiallyEnabled = true\n): Plugin {');
 edit('VALUES (?, ?, ?, ?, 1, ?, ?, ?)','VALUES (?, ?, ?, ?, ?, ?, ?, ?)');edit(').run(id, projectId, name, filePath, content, now, now);',').run(id, projectId, name, filePath, initiallyEnabled ? 1 : 0, content, now, now);');
 edit('    ensurePluginDir(projectId);\n    if (content) {','    if (initiallyEnabled) ensurePluginDir(projectId);\n    if (initiallyEnabled && content) {');
 edit('    validatePluginPath(filePath, projectId);','    validatePluginPath(filePath, projectId);\n    if (db.prepare("SELECT 1 FROM plugins WHERE project_id=? AND (name=? OR file_path=?)").get(projectId,name,filePath)) throw new Error("Plugin target already exists; restore or edit its original row");');
 edit('const content = sourceContent || (() => {','const content = sourceContent !== undefined ? sourceContent : (() => {');
 edit('      if (updates.source_content !== undefined) {','      if (!existing.enabled) { checkpointAfterWrite(); return db.prepare("SELECT * FROM plugins WHERE id = ?").get(existing.id) as Plugin; }\n      if (updates.source_content !== undefined) {');
 const start=s.indexOf('export function deletePlugin('),end=s.indexOf('\n/**',start);if(start<0||end<0)throw Error('Delete boundary');s=s.slice(0,start)+'export function deletePlugin(projectId: string, name: string): boolean {\n  return Boolean(archivePlugin(projectId,name));\n}\n'+s.slice(end);
 for(const fn of ['updatePluginDescription','enablePlugin','disablePlugin','createPlugin','updatePlugin']){const at=s.indexOf('export function '+fn+'('),body=s.indexOf('): ',at),brace=s.indexOf('{',body);if(at<0||body<0||brace<0)throw Error('Writer signature '+fn);s=s.slice(0,brace+1)+'\n  assertPluginCommandClear(projectId);'+s.slice(brace+1);}
 return s;
});
proposal('packages/ingenium-core/lib/tools/paths.ts',pre=>{
 const before='export function getPluginsBase(projectId?: string): string {\n  const base = resolveProjectBase(projectId);';if(!pre.includes(before))throw Error('Paths preimage');
 return pre.replace(before,'export function getPluginsBase(projectId?: string): string {\n  if (projectId) {\n    const project = getDb().prepare("SELECT path,is_global FROM projects WHERE id=? AND archived_at IS NULL").get(projectId) as {path:string;is_global:number}|undefined;\n    if (!project) throw new Error("Active project required for plugin storage");\n    if (!project.is_global) return resolve(project.path,".opencode","plugins");\n  }\n  const base = resolveProjectBase(projectId);')+'\n/** Plugin config follows its registered workspace, independent of installation settings. */\nexport function getPluginConfigPath(projectId?:string):string {\n if(projectId){const project=getDb().prepare("SELECT path,is_global FROM projects WHERE id=? AND archived_at IS NULL").get(projectId) as {path:string;is_global:number}|undefined;\n if(!project)throw new Error("Active project required for plugin configuration");if(!project.is_global)return resolve(project.path,"opencode.json");}\n return getConfigPath(projectId);\n}\n';
});
proposal('packages/ingenium-core/lib/index.ts',pre=>{
 if(pre.includes('customize-catalog-owner'))throw Error('Catalog export already exists');return pre+'\nexport * as customizeCatalog from "./tools/customize-catalog-owner.js";\n';
});
proposal('services/ingenium-api/scripts/api-server.ts',pre=>{
 const at='app.use("/api/v1/customize", createHostedCustomizeRouter());';if(!pre.includes(at)||pre.includes('createScopedCustomizeRouter'))throw Error('Server hook preimage');return 'import {createScopedCustomizeRouter} from "../lib/routes/customize-scoped.js";\n'+pre.replace(at,'app.use("/api/v1/customize",createScopedCustomizeRouter());\n'+at);
});
proposal('services/ingenium-api/lib/authorization-policy.ts',pre=>{
 const at='  if (req.method === "GET" && /^\\/api\\/v1\\/customize\\/?$/i.test(req.path)) {';
 if(!pre.includes(at)||pre.includes('customize.scoped.'))throw Error('Policy hook preimage');
 return pre.replace(at,'  const scopedCustomize=req.method==="GET"&&/^\\/api\\/v1\\/customize\\/(?:sources(?:\\/[^/]+)?|project-source|archived-plugins|installations|commands\\/[^/]+)\\/?$/i.test(req.path)\n    ||req.method==="POST"&&/^\\/api\\/v1\\/customize\\/commands\\/?$/i.test(req.path);\n  if(scopedCustomize)return {action:"customize.scoped."+(req.method==="GET"?"read":"command"),resource:"plugins",permission:"read",target:"private",browserSessionOnly:true,sensitive:req.method!=="GET"};\n'+at);
});
proposal('packages/ingenium-core/lib/tools/node-native-lifecycle.ts',pre=>{
 const at='export function assertNativeGovernanceLifecycleClear(db:ReturnType<typeof getDb>,projectId?:string):void{';if(!pre.includes(at)||pre.includes('CUSTOMIZE_ORIGINAL_REQUIRES_RECONCILIATION'))throw Error('Lifecycle hook preimage');
 return pre.replace(at,at+'\n const customizeScope=projectId===undefined?"":" AND project_id=?";\n if(db.prepare("SELECT 1 FROM customize_commands WHERE result_json IS NULL"+customizeScope+" LIMIT 1").get(...(projectId===undefined?[]:[projectId])))throw new Error("CUSTOMIZE_ORIGINAL_REQUIRES_RECONCILIATION");');
});
for(const rel of ['packages/ingenium-core/data/migrations/133_customize_scoped_catalog.sql','packages/ingenium-core/lib/tools/plugin-lifecycle.ts','packages/ingenium-core/lib/tools/customize-catalog-owner.ts','services/ingenium-api/lib/routes/customize-scoped.ts']){const text=fs.readFileSync(here+'/files/'+rel,'utf8');rows.push({path:rel,newFile:true,postimageSha256:hash(text)});}
fs.writeFileSync(here+'/scoped-source-manifest.json',JSON.stringify({schemaVersion:1,status:'Source proposal only; Root application and acceptance pending',sources:rows},null,2)+'\n');console.log(JSON.stringify(rows));