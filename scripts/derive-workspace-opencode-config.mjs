/** Linux managed workspace profile. One canonical policy source; no duplicated
 * broker/permission/plugin policy and no change to the legacy Project profile. */
import {constants,openSync,closeSync,readFileSync,writeFileSync,fsyncSync,fstatSync,lstatSync,realpathSync} from 'node:fs';
import {fileURLToPath}from'node:url';import {resolve,dirname}from'node:path';
const deny=()=>{throw Error('Managed workspace configuration unavailable')};
const record=v=>v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null);
export function deriveWorkspaceOpenCodeConfig(original){
 if(!record(original)||original.$schema!=='https://opencode.ai/config.json'||!record(original.mcp)||!record(original.mcp.servers)||!record(original.mcp.servers.ingenium))return deny();
 const cfg=structuredClone(original),server=cfg.mcp.servers.ingenium;
 if(server.type!=='local'||server.disabled!==false||!Array.isArray(server.command)||server.command.length!==2||server.command[0]!=='node'||!['{env:PWD}/packages/ingenium-extension/dist/scripts/mcp-server.js','/app/packages/ingenium-extension/dist/scripts/mcp-server.js'].includes(server.command[1])||!record(server.environment)||Object.entries(server.environment).some(([key,value])=>['__proto__','constructor','prototype'].includes(key)||typeof value!=='string'))return deny();
 // Config sources may merge their environment dictionaries. A fixed Linux env
 // wrapper also removes inherited legacy selectors before the actual launcher.
 // It supplies no credential, identity assertion or Core database access.
 server.command=['/usr/bin/env','-u','INGENIUM_PROJECT','-u','INGENIUM_PROJECT_ID','-u','INGENIUM_PROJECT_NAME','-u','INGENIUM_CORE_DB_PATH','INGENIUM_EXECUTION_SCOPE=workspace',...server.command];
 for(const key of ['INGENIUM_PROJECT','INGENIUM_PROJECT_ID','INGENIUM_PROJECT_NAME','INGENIUM_CORE_DB_PATH'])delete server.environment[key];
 Object.assign(server.environment,{
  INGENIUM_EXECUTION_SCOPE:'workspace',INGENIUM_MCP_AUDIENCE:'runtime',INGENIUM_MCP_CREDENTIAL_FILE:'/run/ingenium-runtime/capability',INGENIUM_RUNTIME_CREDENTIAL_FILE:'/run/ingenium-runtime/capability',INGENIUM_WORKTREE:'/workspace',
  INGENIUM_RUNTIME_ID:'{env:INGENIUM_RUNTIME_ID}',INGENIUM_ORGANIZATION_ID:'{env:INGENIUM_ORGANIZATION_ID}',INGENIUM_RUNTIME_OWNER_ID:'{env:INGENIUM_RUNTIME_OWNER_ID}',INGENIUM_WORKSPACE_ID:'{env:INGENIUM_WORKSPACE_ID}',INGENIUM_STORAGE_MAPPING_HASH:'{env:INGENIUM_STORAGE_MAPPING_HASH}',
 });
 return cfg;
}
export function installManagedWorkspaceConfig(){
 if(process.platform!=='linux'||process.getuid?.()!==0)return deny();
 const source='/usr/local/share/ingenium/opencode-managed/opencode.json',target='/usr/local/share/ingenium/opencode-managed/opencode-workspace.json';
 const parent=dirname(source),directory=lstatSync(parent);if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==0||(directory.mode&0o022)!==0||realpathSync(parent)!==parent)return deny();
 let fd;try{
  fd=openSync(source,constants.O_RDONLY|constants.O_NOFOLLOW);const s=fstatSync(fd),named=lstatSync(source);
  if(!s.isFile()||s.uid!==0||s.gid!==0||s.nlink!==1||(s.mode&0o022)!==0||s.size<2||s.size>131072||named.isSymbolicLink()||named.dev!==s.dev||named.ino!==s.ino||realpathSync(source)!==source)return deny();
  const bytes=readFileSync(fd),after=fstatSync(fd),current=lstatSync(source);if(bytes.length!==s.size||[after,current].some(x=>['dev','ino','size','mtimeMs','ctimeMs'].some(k=>x[k]!==s[k])))return deny();
  const output=Buffer.from(JSON.stringify(deriveWorkspaceOpenCodeConfig(JSON.parse(bytes)),null,2)+'\n');
  const out=openSync(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o444);
  try{writeFileSync(out,output);fsyncSync(out);const t=fstatSync(out);if(!t.isFile()||t.uid!==0||t.gid!==0||t.nlink!==1||(t.mode&0o777)!==0o444)return deny();}finally{closeSync(out)}
 }finally{if(fd!==undefined)closeSync(fd)}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2)throw Error('No arbitrary configuration paths accepted');installManagedWorkspaceConfig();
}
