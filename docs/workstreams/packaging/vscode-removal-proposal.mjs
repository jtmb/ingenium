// Source proposal only. Never applies files or removes installed data.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function proposeVscodeRemoval(root) {
  const files = [];
  function edit(file, transform) {
    const before = fs.readFileSync(path.join(root, file));
    const raw = before.toString('utf8');
    if (!Buffer.from(raw).equals(before)) throw Error('Non-UTF8 input: '+file);
    // Preserve preexisting line endings and EOF; only this explicit file is transformed.
    const crlf = raw.includes('\r\n');
    if (crlf && raw.replaceAll('\r\n','').includes('\n')) throw Error('Mixed input EOL: '+file);
    const afterText = transform(raw.replaceAll('\r\n','\n'));
    const after = afterText === null ? null : Buffer.from(crlf ? afterText.replaceAll('\n','\r\n') : afterText);
    if (after?.equals(before)) throw Error('Unchanged proposal: '+file);
    files.push({path:file,before,after,beforeSha256:sha256(before),afterSha256:after===null?null:sha256(after)});
  }
  function once(s, needle, replacement) {
    if (!s.includes(needle) || s.indexOf(needle)!==s.lastIndexOf(needle)) throw Error('Anchor missing/nonunique: '+needle.slice(0,100));
    return s.replace(needle,replacement);
  }
  function span(s,start,end,replacement='') {
    const a=s.indexOf(start), b=s.indexOf(end,a+start.length);
    if(a<0||b<0||s.indexOf(start,a+1)>=0)throw Error('Bounded span anchor drift: '+start);
    return s.slice(0,a)+replacement+s.slice(b);
  }
  const noEditor = '# The bundled editor was retired; preserve legacy data outside the new package.\n';
  edit('Dockerfile', s=>{
    s=span(s,'RUN curl -fsSL -o /tmp/code-server.tar.gz ', '# Upstream vendor bundles');
    s=span(s,'COPY --chown=root:root --chmod=0444 config/vscode-extensions/', 'RUN curl -fsSL -o /tmp/ttyd.x86_64 ');
    s=once(s,'    groupadd --system --gid 1107 ingenium-vscode && useradd --system --uid 1107 --gid 1107 --home-dir /home/ingenium-vscode --shell /usr/sbin/nologin ingenium-vscode && \\\n','');
    s=once(s,'    install -d -o ingenium-vscode -g ingenium-vscode -m 0700 /home/ingenium-vscode && \\\n','');
    s=once(s,'    setcap cap_chown,cap_fowner=ep /usr/local/libexec/ingenium-restore-node && \\\n    runuser -u appuser -- test -r /usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json','    setcap cap_chown,cap_fowner=ep /usr/local/libexec/ingenium-restore-node');
    s=once(s,' scripts/start-vscode.sh','');
    s=once(s,' nginx/proxy-vscode.conf','');
    s=span(s,'# Docker initializes an empty named volume from this appuser-owned path. Keep\n# code-server state', '# Compose overlays',noEditor);
    return s;
  });
  edit('config/vendor-security.json',s=>{
    const m=JSON.parse(s),retained=m.packages.filter(p=>p.target.startsWith('/usr/local/lib/node_modules/npm/node_modules/'));
    if(m.packages.length!==10||retained.length!==1||retained[0].name!=='undici'||retained[0].version!=='6.29.1')throw Error('Vendor inventory drift');
    m.description='Exact compatible npm security overlay; preserves original major APIs and application locks.';
    m.packages=retained;return JSON.stringify(m,null,2)+'\n';
  });
  edit('scripts/install-vendor-security.mjs',s=>{
    s=once(s,"const roots = ['/usr/local/lib/code-server/node_modules/', '/usr/local/lib/code-server/lib/vscode/node_modules/', '/usr/local/lib/node_modules/npm/node_modules/'];","const roots = ['/usr/local/lib/node_modules/npm/node_modules/'];");
    s=once(s,"createRequire('/usr/local/lib/code-server/package.json')('semver')","createRequire('/usr/local/lib/node_modules/npm/package.json')('semver')");
    return once(s,'// Validate every old identity first: body-parser contains the nested content-type target.','// Validate every original identity before changing the image-only npm overlay.');
  });
  for(const file of ['supervisord.conf','runtime-supervisord.conf']) edit(file,s=>{
    const start=s.indexOf('[program:vscode]\n');if(start<0)throw Error('Missing editor supervisor block');
    const end=s.indexOf('\n[',start+1);return s.slice(0,start)+(end<0?'':s.slice(end+1));
  });
  edit('scripts/runtime-entrypoint.sh',s=>{
    s=once(s,'  "/home/appuser/.local/state" \\\n  "/home/appuser/vscode-data/user-data" \\\n  "/home/appuser/vscode-data/extensions"','  "/home/appuser/.local/state"');
    return once(s,' "/home/appuser/vscode-data"','');
  });
  edit('scripts/runtime-healthcheck.sh',s=>once(s,'curl --fail --silent --max-time 3 --output /dev/null http://127.0.0.1:4100/healthz\n',''));
  edit('scripts/docker-entrypoint.sh',s=>{
    s=span(s,'remove_verified_stale_socket() {\n','DEPLOYMENT_MODE=',noEditor+'\n');
    s=once(s,'VSCODE_UID="$(id -u ingenium-vscode)"\nVSCODE_GID="$(id -g ingenium-vscode)"\n','');
    s=once(s,' "$VSCODE_UID:$VSCODE_GID"','');
    s=span(s,'secure_persistent_path directory /home/ingenium-vscode/vscode-data ', 'secure_persistent_path', '');
    // Remaining four editor-only calls are a contiguous block, before unrelated state setup.
    const lines=s.split('\n');
    const editorLines=lines.filter(l=>l.includes('/home/ingenium-vscode/vscode-data'));
    if(editorLines.length!==4)throw Error('Legacy editor state call count drift');
    s=lines.filter(l=>!l.includes('/home/ingenium-vscode/vscode-data')).join('\n');
    const occurrences=s.split('ingenium-vscode').length-1;if(occurrences!==5)throw Error('Workspace ACL identity count drift: '+occurrences);
    s=s.replaceAll(',u:ingenium-vscode:--x','').replaceAll(',u:ingenium-vscode:rwX','').replaceAll(',d:u:ingenium-vscode:rwX','').replaceAll(' ingenium-vscode','');
    return s;
  });
  edit('scripts/validate-process-isolation.sh',s=>{
    if(s.split(' ingenium-vscode').length-1!==6)throw Error('Process-isolation identity count drift');
    return s.replaceAll(' ingenium-vscode','');
  });
  edit('docker-compose.yml',s=>{
    s=once(s,'      # code-server is an administrator-grade, auth-none local profile with a\n      # full terminal. It is unsupported for LAN, remote, shared, or untrusted users.\n      - vscode-data:/home/ingenium-vscode/vscode-data\n','');
    return once(s,'  vscode-data:\n','');
  });
  edit('nginx/gateway.conf',s=>{
    s=once(s,'consume OpenCode or VS Code capacity.','consume OpenCode capacity.');
    s=span(s,"    # Keep code-server's workbench load",'    # The generated positive policy');
    s=span(s,'    # Only WebSocket upgrade requests need an Origin gate. Normal workbench','    # CSP cannot express an IPv6 literal');
    s=once(s,'    limit_req_zone $vscode_request_limit_key zone=vscode_request:10m rate=30r/s;\n','');
    return span(s,'    upstream vscode {\n','    # Windows-to-WSL');
  });
  edit('nginx/runtime-aliases-compatibility.conf',s=>{
    const start='server {\n    listen 3000;\n    listen [::]:3000;\n    server_name vscode.localhost;\n';
    const a=s.indexOf(start);if(a<0||s.indexOf(start,a+1)>=0)throw Error('Editor alias drift');
    // Keep an explicit tombstone so this retired host cannot fall through to dashboard.
    return s.slice(0,a)+start+'    include /app/nginx/runtime-alias-unavailable-location.conf;\n}\n';
  });
  edit('scripts/healthcheck.sh',s=>{
    s=once(s,'# and OpenCode/code-server listeners, and ttyd through its only supported health identity.','# and OpenCode listeners, and ttyd through its only supported health identity.');
    s=span(s,'require_vscode_gateway_csp() {\n','require_cli_root_ok() {\n');
    s=once(s,' ttyd-opencode vscode"',' ttyd-opencode"');
    for(const line of ['  require_http_ok "VS Code" "http://127.0.0.1:4100/healthz"\n','  require_gateway_status "VS Code gateway root" "vscode.localhost" "/" "302"\n','  require_gateway_status "VS Code gateway workbench" "vscode.localhost" "/?folder=/workspace" "200"\n','  require_vscode_gateway_csp\n'])s=once(s,line,'');
    return s+'\n# Retired editor host refuses both HTTP and upgrades in either deployment profile.\nrequire_gateway_status "Retired editor" "vscode.localhost" "/" "404"\nretired_upgrade="$(curl --silent --max-time 5 --output /dev/null --write-out \'%{http_code}\' --header "Host: vscode.localhost" --header "Connection: Upgrade" --header "Upgrade: websocket" http://127.0.0.1:3000/ || true)"\n[ "$retired_upgrade" = "404" ] || { echo "ERROR: retired editor host forwarded an upgrade"; exit 1; }\n';
  });
  edit('services/ingenium-api/scripts/restore-maintenance.ts',s=>{
    s=once(s,'["ttyd-opencode", "vscode", "opencode-web", "ingenium-api"]','["ttyd-opencode", "opencode-web", "ingenium-api"]');
    return once(s,'["ingenium-api", "opencode-web", "ttyd-opencode", "vscode"]','["ingenium-api", "opencode-web", "ttyd-opencode"]');
  });
  for(const file of ['scripts/start-vscode.sh','scripts/validate-vscode-theme-manifest.mjs','config/vscode-extensions/ingenium.system-theme-defaults/package.json','nginx/proxy-vscode.conf'])edit(file,()=>null);
  edit('scripts/validate-gateway-config.sh',s=>{
    s=span(s,'if [ ! -f "$vscode_proxy_path" ]; then\n','for path in ');
    s=span(s,'# Keep the VS Code root on the same dual-stack listener pair', 'require_literal "$opencode_proxy_path"');
    s=span(s,'vscode_servers="', 'require_literal "$production_aliases_path"',
      'reject_literal "$compatibility_aliases_path" "proxy_pass http://vscode;"\nrequire_literal "$compatibility_aliases_path" "server_name vscode.localhost;"\nrequire_literal "$compatibility_aliases_path" "include /app/nginx/runtime-alias-unavailable-location.conf;"\nreject_literal "$config_path" "server 127.0.0.1:4100;"\nreject_literal "$config_path" "upstream vscode {"\n\n');
    const removeExact = ['require_literal "$config_path" "default                              1;"','require_literal "$config_path" "~^0:"','require_literal "$config_path" "~^/(?:_static/|static/|stable/) \\"\\";"'];
    // Drop only obsolete editor positive checks; keep explicit denial and shared guards.
    s=s.split('\n').filter(l=>!l.startsWith('vscode_proxy_path=')&&!l.includes('$vscode_proxy_path')&&
      !(l.startsWith('require_literal')&&(l.includes('$vscode_')||l.includes('vscode_request')||l.includes('vscode_reject')||l.includes('vscode_upgrade')||l.includes('proxy_pass http://vscode;')||l.includes('proxy-vscode.conf')||l.includes('proxy_set_header Host \\"vscode.')||l.includes('server 127.0.0.1:4100;')||l.includes('upstream vscode {')||l.includes('1:http://vscode.')))&&
      !removeExact.includes(l)&&!l.includes('~^/(?:_static/|static/|stable/)')).join('\n');
    return s;
  });
  edit('scripts/validate-deployment-config.sh',s=>{
    s=span(s,'require_literal "$dockerfile" "https://github.com/coder/code-server/', 'require_literal "$dockerfile" "scripts/generate-dashboard-safe-read-policy.mjs"',
      'reject_literal "$dockerfile" "code-server"\nreject_literal "$dockerfile" "vscode"\nreject_literal "$dockerfile" "open-vsx.org"\n');
    s=span(s,`require_literal "$vscode_runner" 'compatibility:ingenium-vscode)`, 'require_literal "${repo_root}/scripts/run-init-project.sh"');
    s=s.replaceAll(' start-vscode.sh','').replaceAll(' ttyd-opencode vscode"',' ttyd-opencode"');
    s=s.split('\n').filter(l=>!/^vscode_(runner|theme_manifest|theme_validator|proxy)=/.test(l)&&
      !l.startsWith('require_literal "$supervisor_config" "[program:vscode]"')&&
      !l.startsWith('require_literal "$supervisor_config" "command=/app/scripts/start-vscode.sh"')&&
      !l.includes('require_literal "$compose_file" "vscode-data:')&&
      !(l.startsWith('require_literal "${repo_root}/scripts/healthcheck.sh"')&&(l.includes('4100/healthz')||l.includes('VS Code gateway')||l.includes("frame-ancestors 'self'")))&&
      !l.startsWith('node "$vscode_theme_validator"')).join('\n');
    for(const ref of [' "$vscode_runner"',' "$vscode_theme_manifest"',' "$vscode_theme_validator"',' "$vscode_proxy"'])s=s.replaceAll(ref,'');
    s+='\n# The retired editor is absent from new images and active startup/exposure.\nreject_literal "$supervisor_config" "[program:vscode]"\nreject_literal "$runtime_supervisor_config" "[program:vscode]"\nreject_literal "$compose_file" "vscode-data:"\nreject_literal "$entrypoint" "ingenium-vscode"\nreject_literal "$runtime_entrypoint" "vscode-data"\nreject_path "${repo_root}/scripts/start-vscode.sh"\nreject_path "${repo_root}/nginx/proxy-vscode.conf"\n';
    // Keep success output after the new negative checks.
    s=once(s,'echo "Deployment static validation passed"\n','');
    return s+'\necho "Deployment static validation passed"\n';
  });
  return files;
}
