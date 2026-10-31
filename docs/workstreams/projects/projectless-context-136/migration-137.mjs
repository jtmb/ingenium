import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installEvolution,replaceExactly,addColumnsAndConstraints} from './migration-rebuild.mjs';
import {hasVerifiedContext136} from './migration-136.mjs';
const version=`schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version IN (1,2)),
 CHECK((schema_version=1 AND project_id IS NOT NULL) OR (schema_version=2 AND project_id IS NULL))`;
const names=['authorized_workspaces','runtime_instances','mcp_credentials','runtime_capability_bindings','runtime_launch_tickets','runtime_original_provisions','runtime_browser_launch_tickets','runtime_browser_sessions'];
const tables=names.map(name=>({name,evolve(sql){
 let ddl=replaceExactly(sql,'project_id TEXT NOT NULL','project_id TEXT');
 let extra=version;
 if(['runtime_instances','runtime_browser_launch_tickets','runtime_browser_sessions'].includes(name))extra+=',\nFOREIGN KEY(workspace_id) REFERENCES authorized_workspaces(id) ON DELETE RESTRICT';
 if(name.startsWith('runtime_browser_'))extra+=',\nFOREIGN KEY(runtime_id) REFERENCES runtime_instances(id) ON DELETE RESTRICT';
 if(name==='runtime_original_provisions')extra+=`,\nCHECK(schema_version=1 OR (schema_version=2 AND project_id IS NULL))`;
 return addColumnsAndConstraints(ddl,extra);
}}));
const change=(sql,from,to)=>replaceExactly(sql,from,to);
const edits={
 authorized_workspaces_scope_insert:sql=>change(sql,'WHEN NOT EXISTS (','WHEN NEW.project_id IS NOT NULL AND NOT EXISTS ('),
 runtime_instances_scope_insert:sql=>change(sql,'w.project_id = NEW.project_id','w.project_id IS NEW.project_id'),
 mcp_credentials_scope_insert:sql=>change(change(sql,'WHEN NOT EXISTS (','WHEN (NEW.project_id IS NOT NULL AND NOT EXISTS ('),') OR NOT EXISTS (',')) OR NOT EXISTS ('),
 runtime_capability_scope_insert:sql=>change(change(sql,'r.project_id = NEW.project_id','r.project_id IS NEW.project_id'),'c.project_id = NEW.project_id','c.project_id IS NEW.project_id'),
 runtime_launch_ticket_scope_insert:sql=>change(sql,'r.project_id = NEW.project_id','r.project_id IS NEW.project_id'),
 runtime_browser_ticket_scope_insert:sql=>change(sql,'r.project_id = NEW.project_id','r.project_id IS NEW.project_id'),
 runtime_browser_session_scope_insert:sql=>change(sql,'r.project_id = NEW.project_id','r.project_id IS NEW.project_id'),
 runtime_original_provisions_initial_only:sql=>change(change(sql,'r.project_id=NEW.project_id','r.project_id IS NEW.project_id'),'w.project_id=NEW.project_id','w.project_id IS NEW.project_id'),
};
export function workspace137Spec() {
 let tailSql=readFileSync(new URL('./137_workspace_execution.sql',import.meta.url),'utf8');
 for(const name of names)tailSql+=`\nCREATE TRIGGER v137_${name}_version_immutable BEFORE UPDATE ON ${name}
 WHEN NEW.schema_version IS NOT OLD.schema_version BEGIN SELECT RAISE(ABORT,'execution scope version immutable'); END;`;
 const recipeSha256=createHash('sha256').update(readFileSync(new URL(import.meta.url))).update(readFileSync(new URL('./migration-rebuild.mjs',import.meta.url))).update(tailSql).digest('hex');
 return {version:137,tables,triggerEdits:edits,tailSql,recipeSha256};
}
export function installWorkspaceExecution137(db) {
 if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='veyra_evolution_136'").get())throw Error('CONTEXT_136_REQUIRED_BEFORE_137');
 return installEvolution(db,workspace137Spec());
}

/** Full source-recipe and owned-object validation, never a marker-only exemption. */
export function verifiedWorkspace137Definitions(db) {
 if(!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='veyra_evolution_137'").get())return undefined;
 if(!hasVerifiedContext136(db))throw Error('VERIFIED_CONTEXT_136_REQUIRED');
 installEvolution(db,workspace137Spec());
 return JSON.parse(db.prepare('SELECT schema_json FROM veyra_evolution_137 WHERE version=137').get().schema_json);
}
