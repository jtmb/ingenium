import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const base='fbafc1cd0de7e8809218d9e19cca1552ae459e64';
const prior='34351ff2d3c7795709925b48fec81246432908ea';
const sha=value=>createHash('sha256').update(value).digest('hex');
export function buildProjectionProposal(integration,worker) {
 const read=(root,ref,path)=>execFileSync('git',['-C',root,'show',ref+':'+path],{encoding:'utf8',maxBuffer:4*1024*1024});
 const strictRepairs=JSON.parse(readFileSync(new URL('root-strict-repairs.json',import.meta.url),'utf8'));
 const repair=(path,text)=>{
   for(const [from,to] of strictRepairs[path]??[]) {
     if(text.split(from).length!==2)throw new Error('Exact strict repair anchor mismatch: '+path);
     text=text.replace(from,to);
   }
   return text;
 };
 const priorGenerator=read(worker,prior,'docs/workstreams/rust-api/hosted-governance/prepare-proposal.mjs');
 const appendMatch=priorGenerator.match(/"packages\/ingenium-core\/lib\/tools\/skills\.ts": ("(?:[^"\\]|\\.)*")/);
 if(!appendMatch)throw new Error('Prior absent-only helper recipe unavailable');
 const path='packages/ingenium-core/lib/tools/skills.ts',before=read(integration,base,path)+JSON.parse(appendMatch[1]);
 let after=before;
 const replace=(from,to)=>{if(after.split(from).length!==2)throw new Error('Projection preimage anchor mismatch: '+from.slice(0,100));after=after.replace(from,to);};
 replace('import { randomUUID } from "node:crypto";','import { randomUUID, createHash } from "node:crypto";');
 replace('/**\n * Validate a skill name',readFileSync(new URL('strict-scope.ts',import.meta.url),'utf8')+'\n/**\n * Validate a skill name');
 replace('if ((skill as any).archived_at) {\n    return;','if ((skill as any).archived_at) {\n    projectionRefused(skill,"ARCHIVED_PROJECTION");\n    return;');
 replace('logger.warn("skills", "Refusing to write skill with unsafe name", { name: skill.name });','projectionRefused(skill,"UNSAFE_SKILL_NAME");\n    logger.warn("skills", "Refusing to write skill with unsafe name", { name: skill.name });');
 replace('logger.warn("skills", "Refusing to write skill — unsafe directory (symlink/canonical escape)", { name: skill.name });','projectionRefused(skill,"UNSAFE_SKILL_DIRECTORY");\n    logger.warn("skills", "Refusing to write skill — unsafe directory (symlink/canonical escape)", { name: skill.name });');
 replace('if (!existsSync(dir)) mkdirSync(dir, { recursive: true });','if (!existsSync(dir)) projectionIo(skill,"mkdir","",()=>mkdirSync(dir, { recursive: true }));');
 replace('writeFileSync(resolve(dir, "SKILL.md"), frontmatter + "\\n" + body);','projectionIo(skill,"write","SKILL.md",()=>writeFileSync(resolve(dir,"SKILL.md"),frontmatter+"\\n"+body),createHash("sha256").update(frontmatter+"\\n"+body).digest("hex"));');
 replace('writeFileSync(resolve(dir, "metadata.json"), meta);','projectionIo(skill,"write","metadata.json",()=>writeFileSync(resolve(dir,"metadata.json"),meta),createHash("sha256").update(meta).digest("hex"));');
 replace('if (typeof content !== "string") continue; // defensively skip non-string values','if (typeof content !== "string") { projectionRefused(skill,"INVALID_REFERENCE_BODY"); continue; }');
 replace('logger.warn("skills", "Rejected unsafe file_tree path", {','projectionRefused(skill,"UNSAFE_REFERENCE_PATH");\n          logger.warn("skills", "Rejected unsafe file_tree path", {');
 replace('if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });','if (!existsSync(parentDir)) projectionIo(skill,"mkdir",relPath,()=>mkdirSync(parentDir, { recursive: true }));');
 replace('writeFileSync(safePath, content as string, "utf-8");','projectionIo(skill,"write",relPath,()=>writeFileSync(safePath,content as string,"utf-8"),createHash("sha256").update(content as string).digest("hex"));');
 replace('unlinkSync(safePath);','projectionIo(skill,"remove",relPath,()=>unlinkSync(safePath));\n            projectionRefused(skill,"POST_WRITE_PATH_ESCAPE");');
 replace('} catch { /* realpath may fail; safe to ignore */ }','} catch (error) { if(strictProjectionObserver) { if(error instanceof SkillProjectionFailure) throw error; projectionRefused(skill,"POST_WRITE_VALIDATION_FAILED"); } }');
 replace('} catch (e) {\n      logger.warn("skills", "Failed to parse file_tree JSON", { name: skill.name });','} catch (e) {\n      if(strictProjectionObserver) { if(e instanceof SkillProjectionFailure) throw e; projectionRefused(skill,"REFERENCE_PROJECTION_FAILED"); }\n      logger.warn("skills", "Failed to parse file_tree JSON", { name: skill.name });');
 replace('export function removeSkillMdOnly(name: string, projectId?: string): void {','export function removeSkillMdOnly(name: string, projectId?: string): void {\n  const projectionSkill = strictProjectionObserver && projectId ? getSkill(projectId,name) : undefined;\n  const witnessSkill = projectionSkill ?? {name,project_id:projectId};\n  if(strictProjectionObserver && !projectionSkill) projectionRefused(witnessSkill,"PROJECTION_SKILL_UNAVAILABLE");');
 replace('logger.warn("skills", "Refusing to remove SKILL.md with unsafe name", { name });','projectionRefused(witnessSkill,"UNSAFE_SKILL_NAME");\n    logger.warn("skills", "Refusing to remove SKILL.md with unsafe name", { name });');
 replace('logger.warn("skills", "Refusing to remove SKILL.md — unsafe directory (symlink/canonical escape)", { name });','projectionRefused(witnessSkill,"UNSAFE_SKILL_DIRECTORY");\n    logger.warn("skills", "Refusing to remove SKILL.md — unsafe directory (symlink/canonical escape)", { name });');
 replace('try { if (existsSync(filePath)) unlinkSync(filePath); } catch {}','try { projectionIo(witnessSkill,"remove","SKILL.md",()=>{\n    if(strictProjectionObserver) {\n      try { lstatSync(filePath); } catch(error) {\n        if(error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;\n        throw error;\n      }\n      unlinkSync(filePath);\n    } else if(existsSync(filePath))unlinkSync(filePath);\n  }); } catch(error) { if(strictProjectionObserver) throw error; }');
 const changes=[{path,before,after}];
 const enginePath='packages/ingenium-core/lib/tools/hosted-governance.ts';
 const engineBefore=read(worker,prior,'docs/workstreams/rust-api/hosted-governance/proposed/hosted-governance.ts');
 const engine=repair(enginePath,engineBefore);
 let engineAfter=engine
  .replace('execute(command: Row, binding: Row, actor: Actor):','projectionPlan?(original: Row): Row;\n  execute(command: Row, binding: Row, actor: Actor, operationId: string, projection: {plan:Row|null;events:Row[]}):')
  .replace('const now=new Date().toISOString();\n        const proposalSource=', 'const now=new Date().toISOString();\n        const projectionPlan=ports.projectionPlan?.(original)??null;\n        const proposalSource=')
  .replace('command_kind,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,\'executing\',?,?)','command_kind,projection_plan_json,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,\'executing\',?,?)')
  .replace('original.command.op,now,now);','original.command.op,projectionPlan?JSON.stringify(projectionPlan):null,now,now);')
  .replace('if(!admission.fresh) return admission.receipt!;','if(!admission.fresh) return admission.receipt!;\n      const projectionEvents: Row[]=[];')
  .replace('ports.execute(original.command,original.binding,actor!)','ports.execute(original.command,original.binding,actor!,original.id,{plan:admitted.projection_plan_json?JSON.parse(admitted.projection_plan_json):null,events:projectionEvents})')
  .replace("first_failure_code=COALESCE(first_failure_code,'CORE_EFFECT_INTERRUPTED') WHERE operation_id=?\").run(original.id)","first_failure_code=COALESCE(first_failure_code,'CORE_EFFECT_INTERRUPTED'),projection_witness_json=COALESCE(projection_witness_json,?) WHERE operation_id=?\").run(JSON.stringify(projectionEvents),original.id)");
 if(engineAfter===engine)throw new Error('Missing original engine execute anchor');
 changes.push({path:enginePath,before:engine,after:engineAfter,priorBefore:engineBefore});
 const ownerPath='packages/ingenium-core/lib/tools/hosted-governance-owner.ts';
 const owner=read(worker,prior,'docs/workstreams/rust-api/hosted-governance/proposed/hosted-governance-owner.ts');
 let ownerAfter=owner
  .replace('export type HostedGovernanceAuthentication', 'import { deriveHostedProjectionPlan, createHostedProjectionObserver } from "./hosted-projection-plan.js";\n\nexport type HostedGovernanceAuthentication')
  .replace('execute(command:Row,binding:Row,actor) {','projectionPlan:original=>deriveHostedProjectionPlan(getDb() as unknown as SqlDb,original),\n    execute(command:Row,binding:Row,actor,operationId,projection) {\n      if(!projection.plan||projection.plan.operationId!==operationId)throw new Error("Original projection plan required");\n      return skills.withStrictSkillProjection(createHostedProjectionObserver(projection.plan,projection.events),()=>{')
  .replace('default:throw new HostedRefusal("UNSUPPORTED_COMMAND",422);\n      }','default:throw new HostedRefusal("UNSUPPORTED_COMMAND",422);\n      }\n      });');
 if(ownerAfter===owner)throw new Error('Missing original owner execute anchor');
 changes.push({path:ownerPath,before:owner,after:ownerAfter});
 const ddlPath='packages/ingenium-core/data/migrations/125_native_hosted_governance.sql';
 const ddl=read(worker,prior,'docs/workstreams/rust-api/hosted-governance/proposed/125_native_hosted_governance.sql');
 const ddlAfter=ddl.replace('value_ref_json TEXT, error_code TEXT, error_status INTEGER, first_failure_code TEXT,','value_ref_json TEXT, error_code TEXT, error_status INTEGER, first_failure_code TEXT,\n projection_plan_json TEXT, projection_witness_json TEXT,')
  .replace('OR NEW.command_kind<>OLD.command_kind OR NEW.source_project_id IS NOT OLD.source_project_id','OR NEW.command_kind<>OLD.command_kind OR NEW.projection_plan_json IS NOT OLD.projection_plan_json OR NEW.source_project_id IS NOT OLD.source_project_id');
 changes.push({path:ddlPath,before:ddl,after:ddlAfter});
 changes.push({path:'packages/ingenium-core/lib/tools/hosted-projection-plan.ts',before:'',after:readFileSync(new URL('hosted-projection-plan.ts',import.meta.url),'utf8'),newFile:true});
 const priorManifest=JSON.parse(read(worker,prior,'docs/workstreams/rust-api/hosted-governance/preimages.json'));
 for(const change of changes.filter(c=>!c.newFile)) {
   if(priorManifest.changes.find(c=>c.path===change.path)?.proposedSha256!==sha(change.priorBefore??change.before))throw new Error('Prior proposal preimage drift: '+change.path);
 }
 const readPath='services/ingenium-api/lib/routes/native-customize-read.ts';
 const readBefore=read(worker,prior,'docs/workstreams/rust-api/hosted-governance/proposed/native-customize-read.ts');
 const readAfter=repair(readPath,readBefore);
 const preservedPreimages=[{path:readPath,preimageSha256:sha(readAfter),strictRepairsPreserved:2}];
 return {base,prior,changes,preservedPreimages};
}
export function writeProjectionProposal(integration,worker) {
 const proposal=buildProjectionProposal(integration,worker);
 const py="import json,sys,difflib\nfor c in json.load(sys.stdin):\n sys.stdout.writelines(difflib.unified_diff(c['before'].splitlines(True),c['after'].splitlines(True),fromfile='/dev/null' if c.get('newFile') else 'a/'+c['path'],tofile='b/'+c['path'],n=3))\n";
 const result=spawnSync('python3',['-c',py],{input:JSON.stringify(proposal.changes),encoding:'utf8',maxBuffer:4*1024*1024});
 if(result.status!==0)throw new Error('Projection patch render failed');
 writeFileSync(new URL('projection-owner.patch',import.meta.url),result.stdout);
 const manifest={base:proposal.base,priorProposalCommit:proposal.prior,preservedRootStrictRepairs:'root-strict-repairs.json',preservedPreimages:proposal.preservedPreimages,patchSha256:sha(result.stdout),changes:proposal.changes.map(c=>({path:c.path,expectedAbsent:!!c.newFile,preimageSha256:c.newFile?null:sha(c.before),proposedSha256:sha(c.after)}))};
 writeFileSync(new URL('preimages.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
 console.log(JSON.stringify(manifest));
}
if(process.argv[1]?.endsWith('/proposal.mjs'))writeProjectionProposal(process.argv[2],process.argv[3]);
