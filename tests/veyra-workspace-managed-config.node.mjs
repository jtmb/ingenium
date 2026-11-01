import test from 'node:test';import assert from 'node:assert/strict';import fs from'node:fs';import{spawnSync}from'node:child_process';import{deriveWorkspaceOpenCodeConfig,installManagedWorkspaceConfig}from'../scripts/derive-workspace-opencode-config.mjs';
const original=JSON.parse(fs.readFileSync(new URL('../config/opencode-managed/opencode.json',import.meta.url)));
test('derivation preserves every original policy field and only replaces the workspace MCP environment/command',()=>{
 const before=structuredClone(original),actual=deriveWorkspaceOpenCodeConfig(original),rest=structuredClone(actual);rest.mcp.servers.ingenium=structuredClone(original.mcp.servers.ingenium);assert.deepEqual(rest,original);assert.deepEqual(original,before);assert.deepEqual(actual.agents,original.agents);assert.deepEqual(actual.plugins,original.plugins);
 assert.deepEqual(actual.mcp.servers.ingenium.command.slice(-2),original.mcp.servers.ingenium.command);assert.equal(actual.mcp.servers.ingenium.environment.INGENIUM_EXECUTION_SCOPE,'workspace');assert.equal(actual.mcp.servers.ingenium.environment.INGENIUM_RUNTIME_CREDENTIAL_FILE,'/run/ingenium-runtime/capability');
 for(const key of ['INGENIUM_PROJECT','INGENIUM_PROJECT_ID','INGENIUM_PROJECT_NAME','INGENIUM_CORE_DB_PATH'])assert.equal(Object.hasOwn(actual.mcp.servers.ingenium.environment,key),false);
});
test('actual Linux env wrapper removes inherited and merged selectors before its Node child',()=>{
 const cfg=deriveWorkspaceOpenCodeConfig(original),command=cfg.mcp.servers.ingenium.command,prefix=command.slice(1,-2),source="console.log(JSON.stringify({scope:process.env.INGENIUM_EXECUTION_SCOPE,keys:['INGENIUM_PROJECT','INGENIUM_PROJECT_ID','INGENIUM_PROJECT_NAME','INGENIUM_CORE_DB_PATH'].filter(k=>Object.hasOwn(process.env,k))}))";
 const result=spawnSync(command[0],[...prefix,process.execPath,'-e',source],{env:{PATH:process.env.PATH,NODE_OPTIONS:'',INGENIUM_PROJECT:'legacy-project',INGENIUM_PROJECT_ID:'legacy-id',INGENIUM_PROJECT_NAME:'legacy-name',INGENIUM_CORE_DB_PATH:'/not-opened'},encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),{scope:'workspace',keys:[]});
});
test('a missing/disabled/custom-command MCP server or prototype-style env entry cannot derive a profile',()=>{
 for(const change of [c=>delete c.mcp,c=>c.mcp.servers.ingenium.disabled=true,c=>c.mcp.servers.ingenium.command=['untrusted-command'],c=>c.mcp.servers.ingenium.environment=JSON.parse('{"__proto__":"untrusted"}')]){const cfg=structuredClone(original);change(cfg);assert.throws(()=>deriveWorkspaceOpenCodeConfig(cfg))}
});
test('operator installation refuses a non-root caller before accessing protected deployment paths',()=>{if(process.getuid?.()!==0)assert.throws(()=>installManagedWorkspaceConfig());else assert.ok(true,'Actual root image install belongs to the immutable-image qualification stage')});
