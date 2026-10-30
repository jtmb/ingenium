import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import {proposeVscodeRemoval} from './vscode-removal-proposal.mjs';
const root=process.env.VEYRA_REMOVAL_ROOT;
if(!root)throw Error('VEYRA_REMOVAL_ROOT must name read-only Root source');
export const proposed=proposeVscodeRemoval(root);
const item=name=>{const x=proposed.find(f=>f.path===name);assert.ok(x,name);return x;};
const after=name=>item(name).after?.toString('utf8').replaceAll('\r\n','\n');
const before=name=>item(name).before.toString('utf8').replaceAll('\r\n','\n');
const read=name=>fs.readFileSync(path.join(root,name),'utf8').replaceAll('\r\n','\n');
test('all final image targets lose code-server installation but retain required runtime tools',()=>{
 const s=after('Dockerfile');assert.doesNotMatch(s,/code-server|vscode|open-vsx/);
 for(const target of ['runtime-base','user-runtime','runtime-manager','runtime-gateway','control-plane','compatibility'])assert.ok(s.includes(' AS '+target));
 for(const value of ['OPENCODE_VERSION=2.0.11','ttyd.x86_64','cloudflared','supervisor nginx curl ca-certificates tzdata git acl libcap2-bin libssl3 openssl','cap_chown,cap_fowner=ep','FROM builder AS computer-use','COPY --from=computer-use'])assert.ok(s.includes(value),value);
 // No speculative apt purge: shared tools remain byte-identical.
 assert.equal(s.slice(s.indexOf('ARG OPENCODE_VERSION='),s.indexOf('RUN curl -fsSL -o /tmp/opencode.tar.gz')),before('Dockerfile').slice(before('Dockerfile').indexOf('ARG OPENCODE_VERSION='),before('Dockerfile').indexOf('RUN curl -fsSL -o /tmp/opencode.tar.gz')));
});
test('npm security overlay survives exactly; editor overlays and semver dependency disappear',()=>{
 const old=JSON.parse(before('config/vendor-security.json')),next=JSON.parse(after('config/vendor-security.json'));
 assert.equal(old.packages.length-next.packages.length,9);
 assert.deepEqual(next.packages,old.packages.filter(p=>p.target.startsWith('/usr/local/lib/node_modules/npm/')));
 assert.equal(next.packages[0].name,'undici');assert.equal(next.packages[0].version,'6.29.1');
 const installer=after('scripts/install-vendor-security.mjs');assert.doesNotMatch(installer,/code-server|vscode/);
 assert.ok(installer.includes("createRequire('/usr/local/lib/node_modules/npm/package.json')('semver')"));
 for(const guard of ['fs.realpathSync(target) !== target','original.version !== item.from','semver.major(item.from) !== semver.major(item.version)','semver.satisfies(dependency.version, range)'])assert.ok(installer.includes(guard));
 new vm.SourceTextModule(installer);
});
test('only editor supervisor programs retire; Web and terminal blocks survive byte-for-byte',()=>{
 for(const file of ['supervisord.conf','runtime-supervisord.conf']){
  const s=after(file);assert.doesNotMatch(s,/program:vscode|start-vscode|ingenium-vscode/);
  for(const name of ['opencode-web','ttyd-opencode']){
   const get=(x)=>x.slice(x.indexOf('[program:'+name+']')).split(/\n(?=\[)/)[0].trimEnd();
   assert.equal(get(s),get(before(file)));
  }
 }
});
test('entrypoints no longer inspect, chown, chmod, create or unlink historical editor state',()=>{
 const compatibility=after('scripts/docker-entrypoint.sh'),runtime=after('scripts/runtime-entrypoint.sh');
 assert.doesNotMatch(compatibility,/ingenium-vscode|VSCODE_|remove_verified_stale_socket|code-server-ipc/);
 assert.doesNotMatch(runtime,/vscode-data/);
 for(const x of ['ingenium-opencode:rwX','ingenium-ttyd:rwX','INGENIUM_DEPLOYMENT_MODE','secure_persistent_path private-credential','normalize-agent-profiles.sh'])assert.ok(compatibility.includes(x));
 const role=x=>x.slice(x.indexOf('case "${INGENIUM_RUNTIME_ROLE:-runtime}"'),x.indexOf('NODE_ENV=production'));
 assert.equal(role(runtime),role(before('scripts/runtime-entrypoint.sh')));
 assert.ok(runtime.includes('"/home/appuser/.local/state"\nchmod 0700'));
 assert.doesNotMatch(after('scripts/validate-process-isolation.sh'),/ingenium-vscode/);
});
test('Compose unmounts editor data without any data deletion or volume destruction command',()=>{
 const s=after('docker-compose.yml');assert.doesNotMatch(s,/vscode-data/);
 for(const x of ['ingenium-data:/app/.ingenium','opencode-config:/home/ingenium-opencode/.config','opencode-data:/home/ingenium-opencode/.local','127.0.0.1:3000:3000'])assert.ok(s.includes(x));
 const additions=proposed.flatMap(f=>f.after===null?[]:f.after.toString().split('\n').filter(l=>!f.before.toString().split('\n').includes(l)));
 assert.doesNotMatch(additions.join('\n'),/docker\s+volume|down\s+-v|rm\s+-rf|unlinkSync|userdel/);
});
test('retired alias explicitly denies every path and upgrade instead of dashboard fallback',()=>{
 const s=after('nginx/runtime-aliases-compatibility.conf');
 const old=before('nginx/runtime-aliases-compatibility.conf');
 const prefix=old.slice(0,old.lastIndexOf('server {\n'));
 assert.equal(s.slice(0,prefix.length),prefix);
 const tomb=s.slice(prefix.length);assert.ok(tomb.includes('server_name vscode.localhost;'));
 assert.ok(tomb.includes('include /app/nginx/runtime-alias-unavailable-location.conf;'));assert.doesNotMatch(tomb,/proxy_pass|proxy_set_header|upgrade/i);
 const deny=read('nginx/runtime-alias-unavailable-location.conf');assert.ok(deny.includes('location / {'));assert.ok(deny.includes('return 404'));assert.ok(deny.includes('Cache-Control "no-store"'));
 assert.doesNotMatch(after('nginx/gateway.conf'),/vscode|4100/);
 assert.ok(read('nginx/runtime-aliases-production.conf').includes('vscode.localhost;')); // Production already a common 404.
});
test('health removes editor readiness and keeps real API/Web/CLI/restore checks and retirement refusal',()=>{
 const s=after('scripts/healthcheck.sh');assert.doesNotMatch(s,/4100|require_vscode_gateway_csp|programs=.*vscode/);
 for(const x of ['require_restore_maintenance_safe','require_api_ok','require_ttyd_gateway_health','require_cli_root_ok','require_authenticated_http_ok','require_production_aliases_unavailable','"Retired editor" "vscode.localhost" "/" "404"','[ "$retired_upgrade" = "404" ]'])assert.ok(s.includes(x),x);
 assert.doesNotMatch(after('scripts/runtime-healthcheck.sh'),/4100/);
 for(const x of ['4098/api/info','4098/api/provider','4098/api/mcp','4099/'])assert.ok(after('scripts/runtime-healthcheck.sh').includes(x));
});
test('restore changes only the two program lists, preserving journal and historical backup handling',()=>{
 const file='services/ingenium-api/scripts/restore-maintenance.ts';
 assert.equal(after(file),before(file).replace('["ttyd-opencode", "vscode", "opencode-web", "ingenium-api"]','["ttyd-opencode", "opencode-web", "ingenium-api"]').replace('["ingenium-api", "opencode-web", "ttyd-opencode", "vscode"]','["ingenium-api", "opencode-web", "ttyd-opencode"]'));
 assert.ok(!proposed.some(f=>f.path.includes('migrations/')||f.path.endsWith('tools/backups.ts')));
});
test('four editor-only source deletions are exact named files, never persisted data',()=>{
 assert.deepEqual(proposed.filter(f=>f.after===null).map(f=>f.path),['scripts/start-vscode.sh','scripts/validate-vscode-theme-manifest.mjs','config/vscode-extensions/ingenium.system-theme-defaults/package.json','nginx/proxy-vscode.conf']);
});
test('packaging validators reject reintroduction without requiring editor artifact or listener',()=>{
 const gateway=after('scripts/validate-gateway-config.sh'),deployment=after('scripts/validate-deployment-config.sh');
 assert.doesNotMatch(gateway,/vscode_proxy_path|vscode_listener_block|vscode_servers=|require_literal[^\n]*(upstream vscode|4100|proxy-vscode|proxy_pass http:\/\/vscode)/);
 assert.ok(gateway.includes('reject_literal "$config_path" "upstream vscode {"'));
 assert.doesNotMatch(deployment,/\$vscode_(runner|theme|proxy)|require_literal[^\n]*(start-vscode|program:vscode|4100\/healthz|VS Code gateway)/);
 for(const x of ['reject_literal "$dockerfile" "code-server"','reject_literal "$dockerfile" "vscode"','reject_path "${repo_root}/scripts/start-vscode.sh"','reject_literal "$entrypoint" "ingenium-vscode"'])assert.ok(deployment.includes(x),x);
});
test('all proposed shell postimages parse without executing the scripts',()=>{
 for(const f of proposed.filter(f=>f.path.endsWith('.sh')&&f.after!==null)){
  const input=f.after.toString().replaceAll('\r\n','\n');
  if(process.platform==='win32')execFileSync('wsl',['-d','Ubuntu','-u','brajam','--','sh','-n'],{input,stdio:['pipe','pipe','pipe']});
  else execFileSync('sh',['-n'],{input,stdio:['pipe','pipe','pipe']});
 }
});
test('twenty explicitly scoped proposals leave all original source files unchanged',()=>{
 const docker=item('Dockerfile');assert.equal(fs.readFileSync(path.join(root,docker.path)).equals(docker.before),true);
 // Pure transformations, no source writer is imported or called.
 for(const f of proposed)assert.ok(fs.readFileSync(path.join(root,f.path)).equals(f.before),f.path);
 assert.equal(proposed.length,20);
});
