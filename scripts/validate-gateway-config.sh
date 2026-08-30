#!/bin/sh
# Non-secret static validation hook. Run inside the built image or container.
set -eu

config_path="${1:-/app/nginx/gateway.conf}"
config_dir="$(dirname "$config_path")"
repo_root="$(CDPATH= cd -- "$config_dir/.." && pwd)"
opencode_proxy_path="${config_dir}/proxy-opencode.conf"
dashboard_proxy_path="${config_dir}/proxy-dashboard.conf"
oauth_callback_proxy_path="${config_dir}/proxy-oauth-callback.conf"
vscode_proxy_path="${config_dir}/proxy-vscode.conf"
compatibility_aliases_path="${config_dir}/runtime-aliases-compatibility.conf"
production_aliases_path="${config_dir}/runtime-aliases-production.conf"
unavailable_alias_path="${config_dir}/runtime-alias-unavailable-location.conf"
dashboard_safe_read_map_path="${config_dir}/dashboard-safe-reads-map.conf"
dashboard_safe_read_generator="${repo_root}/scripts/generate-dashboard-safe-read-policy.mjs"
dashboard_safe_read_policy="${repo_root}/services/ingenium-api/config/dashboard-safe-reads.json"
if [ ! -f "$dashboard_safe_read_policy" ]; then
  dashboard_safe_read_policy="${repo_root}/services/ingenium-api/dist/config/dashboard-safe-reads.json"
fi

require_literal() {
  path="$1"
  literal="$2"
  if ! grep -F -q -- "$literal" "$path"; then
    echo "ERROR: required gateway hardening directive is missing from $path: $literal"
    exit 1
  fi
}

reject_literal() {
  path="$1"
  literal="$2"
  if grep -F -q -- "$literal" "$path"; then
    echo "ERROR: unsafe gateway directive found in $path: $literal"
    exit 1
  fi
}

if [ ! -f "$config_path" ]; then
  echo "ERROR: Nginx gateway configuration was not found: $config_path"
  exit 1
fi
if [ ! -f "$opencode_proxy_path" ]; then
  echo "ERROR: OpenCode proxy hardening configuration was not found: $opencode_proxy_path"
  exit 1
fi
if [ ! -f "$dashboard_proxy_path" ]; then
  echo "ERROR: dashboard proxy hardening configuration was not found: $dashboard_proxy_path"
  exit 1
fi
if [ ! -f "$oauth_callback_proxy_path" ]; then
  echo "ERROR: OAuth callback proxy hardening configuration was not found: $oauth_callback_proxy_path"
  exit 1
fi
if [ ! -f "$vscode_proxy_path" ]; then
  echo "ERROR: VS Code proxy hardening configuration was not found: $vscode_proxy_path"
  exit 1
fi
for path in "$dashboard_safe_read_map_path" "$dashboard_safe_read_generator" "$dashboard_safe_read_policy"; do
  if [ ! -f "$path" ]; then
    echo "ERROR: Dashboard safe-read policy artifact was not found: $path"
    exit 1
  fi
done
for path in "$compatibility_aliases_path" "$production_aliases_path" "$unavailable_alias_path"; do
  if [ ! -f "$path" ]; then
    echo "ERROR: runtime alias profile configuration was not found: $path"
    exit 1
  fi
done

require_literal "$config_path" "access_log off;"
require_literal "$config_path" "pid /run/ingenium-gateway/nginx.pid;"
require_literal "$config_path" "lock_file /run/ingenium-gateway/nginx.lock;"
require_literal "$config_path" "error_log /run/ingenium-gateway/nginx-error.log warn;"
reject_literal "$config_path" "error_log stderr warn;"
reject_literal "$config_path" "error_log /dev/stderr"
require_literal "$config_path" "limit_req_zone \$binary_remote_addr zone=dashboard_request:10m rate=30r/s;"
require_literal "$config_path" "limit_req_zone \$dashboard_api_read_limit_key zone=dashboard_api_read:10m rate=60r/s;"
require_literal "$config_path" "limit_req_zone \$dashboard_api_strict_limit_key zone=dashboard_api_strict:10m rate=30r/s;"
require_literal "$config_path" "limit_req_zone \$opencode_request_limit_key zone=opencode_request:10m rate=30r/s;"
require_literal "$config_path" "limit_req_zone \$vscode_request_limit_key zone=vscode_request:10m rate=30r/s;"
require_literal "$config_path" "limit_conn_zone \$binary_remote_addr zone=gateway_conn:10m;"
require_literal "$config_path" "limit_conn gateway_conn 16;"
# Dynamic OpenCode requests use the client bucket; static assets and upgrade
# handshakes use an empty key so loading the UI does not exhaust that budget.
require_literal "$config_path" "map \$http_upgrade \$opencode_upgrade_rate_limit_key {"
require_literal "$config_path" "map \$uri \$opencode_request_limit_key {"
require_literal "$config_path" "map \$http_upgrade \$vscode_upgrade_rate_limit_key {"
require_literal "$config_path" "map \$uri \$vscode_request_limit_key {"
require_literal "$config_path" "include /app/nginx/dashboard-safe-reads-map.conf;"
require_literal "$config_path" "map \$dashboard_api_limit_class \$dashboard_api_read_limit_key {"
require_literal "$config_path" "map \$dashboard_api_limit_class \$dashboard_api_strict_limit_key {"
require_literal "$dashboard_safe_read_map_path" "map \$request_uri \$dashboard_api_raw_path {"
require_literal "$dashboard_safe_read_map_path" "map \"\$request_method|\$uri|\$dashboard_api_raw_path\" \$dashboard_api_limit_class {"
require_literal "$dashboard_safe_read_map_path" "default strict;"
reject_literal "$dashboard_safe_read_map_path" "GET|HEAD"
require_literal "$config_path" "map \$http_upgrade \$vscode_upgrade_request {"
require_literal "$config_path" "map \"\$vscode_upgrade_request:\$http_origin\" \$vscode_reject_upgrade {"
require_literal "$config_path" "default                              1;"
require_literal "$config_path" "~^0:"
require_literal "$config_path" "\"1:http://vscode.localhost:3000\""
require_literal "$config_path" "~^/(?:assets/|_next/|@vite/|node_modules/\\.vite/) \"\";"
require_literal "$config_path" "map \$host \$dashboard_ipv6_loopback {"
require_literal "$config_path" "\"::1\" 1;"
require_literal "$config_path" "return 308 http://localhost:3000\$request_uri;"
require_literal "$config_path" "map \$http_origin \$ttyd_websocket_upstream_host {"
require_literal "$config_path" "\"http://localhost:3000\" \"localhost:3000\";"
require_literal "$config_path" "\"http://127.0.0.1:3000\" \"127.0.0.1:3000\";"
require_literal "$config_path" "\"http://cli.localhost:3000\" \"cli.localhost:3000\";"
require_literal "$config_path" "limit_req zone=dashboard_request burst=60 nodelay;"
require_literal "$config_path" "limit_req zone=dashboard_api_read burst=360 nodelay;"
require_literal "$config_path" "limit_req zone=dashboard_api_strict burst=60 nodelay;"
require_literal "$compatibility_aliases_path" "limit_req zone=opencode_request burst=60 nodelay;"
require_literal "$compatibility_aliases_path" "limit_req zone=vscode_request burst=60 nodelay;"
require_literal "$config_path" "location ^~ /_next/static/ {"
require_literal "$config_path" "location ^~ /api/v1/ {"
reject_literal "$config_path" "location ^~ /_next/ {"
reject_literal "$config_path" "location ^~ /_next/static {"
reject_literal "$config_path" "zone=gateway_request"
require_literal "$config_path" "server_name _;"
require_literal "$config_path" "listen [::]:3000 default_server;"
require_literal "$config_path" "proxy_pass http://ingenium_dashboard;"
require_literal "$config_path" "include /run/ingenium-gateway/runtime-aliases.conf;"
require_literal "$compatibility_aliases_path" "server_name opencode.localhost;"
reject_literal "$config_path" "return 444;"
reject_literal "$config_path" "auth_basic"
reject_literal "$config_path" "auth_delay"
reject_literal "$config_path" "htpasswd"
require_literal "$config_path" "listen 1455 default_server;"
require_literal "$config_path" "location = /auth/callback"
require_literal "$config_path" "if (\$request_method != GET) {"
require_literal "$config_path" "return 405;"
require_literal "$config_path" "proxy_pass http://ingenium_api;"
require_literal "$config_path" "include /app/nginx/proxy-oauth-callback.conf;"
require_literal "$config_path" "location / {"
require_literal "$config_path" "return 404;"
require_literal "$compatibility_aliases_path" "location = /_ingenium/health"
require_literal "$compatibility_aliases_path" "proxy_pass http://opencode_cli;"
require_literal "$compatibility_aliases_path" "proxy_set_header X-Ingenium-Authenticated-User healthcheck;"
require_literal "$compatibility_aliases_path" "proxy_set_header X-Ingenium-Authenticated-User local-gateway;"
require_literal "$compatibility_aliases_path" "location = /ws {"
require_literal "$compatibility_aliases_path" "if (\$ttyd_websocket_upstream_host = \"\") {"
require_literal "$compatibility_aliases_path" "return 403;"
require_literal "$compatibility_aliases_path" "proxy_set_header Host \$ttyd_websocket_upstream_host;"
require_literal "$compatibility_aliases_path" "proxy_set_header Origin \$http_origin;"
require_literal "$config_path" "include /app/nginx/proxy-dashboard.conf;"
require_literal "$config_path" "error_page 429 = @dashboard_rate_limited;"
require_literal "$config_path" "location @dashboard_rate_limited {"
require_literal "$config_path" "add_header Retry-After \"1\" always;"
require_literal "$config_path" "return 429 '{\"error\":{\"code\":\"RATE_LIMITED\""
require_literal "$config_path" "upstream vscode {"
require_literal "$config_path" "server 127.0.0.1:4100;"
require_literal "$compatibility_aliases_path" "server_name vscode.localhost;"
require_literal "$compatibility_aliases_path" "proxy_pass http://vscode;"
require_literal "$compatibility_aliases_path" "include /app/nginx/proxy-vscode.conf;"
require_literal "$compatibility_aliases_path" "if (\$vscode_reject_upgrade) {"
require_literal "$compatibility_aliases_path" "proxy_set_header Host \"vscode.localhost:3000\";"
require_literal "$compatibility_aliases_path" "proxy_set_header Origin \$http_origin;"
require_literal "$config_path" "~^/(?:_static/|static/|stable/) \"\";"
reject_literal "$config_path" "3002"
reject_literal "$config_path" "proxy_set_header Origin \"http://vscode.localhost:3000\";"

# Keep the VS Code root on the same dual-stack listener pair as OpenCode. The
# bounded context is intentional: these two listen directives immediately
# precede the exact server name in the virtual-host declaration.
vscode_listener_block="$(grep -B 2 -F 'server_name vscode.localhost;' "$compatibility_aliases_path")"
case "$vscode_listener_block" in
  *"listen 3000;"*"listen [::]:3000;"*) ;;
  *)
    echo "ERROR: VS Code gateway must use the shared dual-stack port 3000 listener"
    exit 1
    ;;
esac
require_literal "$opencode_proxy_path" "proxy_set_header Authorization \"\";"
require_literal "$opencode_proxy_path" "proxy_set_header Proxy-Authorization \"\";"
require_literal "$opencode_proxy_path" "proxy_set_header X-Ingenium-Authenticated-User \"\";"
require_literal "$opencode_proxy_path" "proxy_set_header X-Forwarded-For \"\";"
require_literal "$opencode_proxy_path" "proxy_set_header X-Forwarded-Proto \"\";"
require_literal "$opencode_proxy_path" "proxy_set_header X-Forwarded-Prefix \"\";"
require_literal "$opencode_proxy_path" "proxy_set_header Forwarded \"\";"
reject_literal "$opencode_proxy_path" "proxy_set_header Host"
require_literal "$opencode_proxy_path" "proxy_hide_header Content-Security-Policy;"
require_literal "$opencode_proxy_path" "proxy_hide_header X-Frame-Options;"
require_literal "$opencode_proxy_path" "add_header Content-Security-Policy \"frame-ancestors http://localhost:3000 http://127.0.0.1:3000\" always;"
reject_literal "$opencode_proxy_path" "frame-ancestors http://localhost:3000 http://127.0.0.1:3000 http://[::1]:3000"
require_literal "$vscode_proxy_path" "proxy_set_header Authorization \"\";"
require_literal "$vscode_proxy_path" "proxy_set_header Proxy-Authorization \"\";"
require_literal "$vscode_proxy_path" "proxy_set_header X-Ingenium-Authenticated-User \"\";"
require_literal "$vscode_proxy_path" "proxy_set_header X-Forwarded-For \"\";"
require_literal "$vscode_proxy_path" "proxy_set_header X-Forwarded-Proto \"\";"
require_literal "$vscode_proxy_path" "proxy_set_header X-Forwarded-Prefix \"\";"
require_literal "$vscode_proxy_path" "proxy_set_header Forwarded \"\";"
reject_literal "$vscode_proxy_path" "proxy_set_header Host"
reject_literal "$vscode_proxy_path" "proxy_hide_header Content-Security-Policy;"
require_literal "$vscode_proxy_path" "proxy_hide_header X-Frame-Options;"
require_literal "$vscode_proxy_path" "add_header Content-Security-Policy \"frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000\" always;"
reject_literal "$vscode_proxy_path" "frame-ancestors *"
reject_literal "$vscode_proxy_path" "http://[::1]:3000"
reject_literal "$vscode_proxy_path" "http://192.168."
reject_literal "$vscode_proxy_path" "Bearer "
require_literal "$dashboard_proxy_path" "proxy_set_header Authorization \"\";"
require_literal "$dashboard_proxy_path" "proxy_set_header Proxy-Authorization \"\";"
require_literal "$dashboard_proxy_path" "proxy_set_header X-Ingenium-Authenticated-User \"\";"
require_literal "$dashboard_proxy_path" "proxy_set_header X-Forwarded-For \$remote_addr;"
require_literal "$dashboard_proxy_path" "proxy_set_header X-Forwarded-Host \$host;"
require_literal "$dashboard_proxy_path" "proxy_set_header X-Forwarded-Proto \$scheme;"
require_literal "$dashboard_proxy_path" "proxy_set_header X-Forwarded-Port \$server_port;"
require_literal "$dashboard_proxy_path" "proxy_set_header Forwarded \"\";"
require_literal "$oauth_callback_proxy_path" "proxy_set_header Authorization \"\";"
require_literal "$oauth_callback_proxy_path" "proxy_set_header Proxy-Authorization \"\";"
require_literal "$oauth_callback_proxy_path" "proxy_set_header X-Forwarded-For \"\";"
require_literal "$oauth_callback_proxy_path" "proxy_set_header Upgrade \"\";"
require_literal "$oauth_callback_proxy_path" "proxy_set_header Connection \"\";"
require_literal "$oauth_callback_proxy_path" "proxy_set_header Content-Length \"\";"
require_literal "$oauth_callback_proxy_path" "proxy_pass_request_body off;"

node "$dashboard_safe_read_generator" --check "$dashboard_safe_read_policy" "$dashboard_safe_read_map_path"

# This endpoint is loopback-only and must route only to ttyd.
health_locations="$(grep -F -c 'location = /_ingenium/health' "$compatibility_aliases_path")"
if [ "$health_locations" -ne 1 ]; then
  echo "ERROR: gateway must expose exactly one internal health location for ttyd"
  exit 1
fi

callback_locations="$(grep -F -c 'location = /auth/callback' "$config_path")"
if [ "$callback_locations" -ne 1 ]; then
  echo "ERROR: OAuth callback listener must expose exactly one exact callback location"
  exit 1
fi

dashboard_static_locations="$(grep -F -c 'location ^~ /_next/static/ {' "$config_path")"
if [ "$dashboard_static_locations" -ne 1 ]; then
  echo "ERROR: dashboard gateway must expose exactly one immutable Next asset location"
  exit 1
fi

dashboard_default_server="$(awk '
  /server_name _;/ { capture = 1 }
  capture && /^[[:space:]]*server \{/ { exit }
  capture { print }
' "$config_path")"
case "$dashboard_default_server" in
  *"location ^~ /_next/static/ {"*) ;;
  *)
    echo "ERROR: immutable dashboard assets must remain on the default dashboard host"
    exit 1
    ;;
esac

dashboard_static_block="$(awk '
  /^[[:space:]]*location \^~ \/_next\/static\/ \{/ { capture = 1 }
  capture { print }
  capture && /^[[:space:]]*\}$/ { exit }
' "$config_path")"
case "$dashboard_static_block" in
  *"limit_req"*)
    echo "ERROR: immutable dashboard assets must not use the dynamic request limiter"
    exit 1
    ;;
esac
for directive in \
  "limit_conn gateway_conn 16;" \
  "proxy_pass http://ingenium_dashboard;" \
  "include /app/nginx/proxy-common.conf;" \
  "include /app/nginx/proxy-dashboard.conf;"; do
  case "$dashboard_static_block" in
    *"$directive"*) ;;
    *)
      echo "ERROR: immutable dashboard asset location is missing: $directive"
      exit 1
      ;;
  esac
done

vscode_servers="$(grep -F -c 'server_name vscode.localhost;' "$compatibility_aliases_path")"
if [ "$vscode_servers" -ne 1 ]; then
  echo "ERROR: gateway must expose exactly one VS Code root host"
  exit 1
fi

require_literal "$production_aliases_path" "server_name opencode.localhost cli.localhost vscode.localhost;"
production_unavailable_includes="$(grep -F -c 'include /app/nginx/runtime-alias-unavailable-location.conf;' "$production_aliases_path")"
if [ "$production_unavailable_includes" -ne 1 ]; then
  echo "ERROR: production runtime aliases must share one unavailable response"
  exit 1
fi
require_literal "$unavailable_alias_path" 'add_header Cache-Control "no-store" always;'
require_literal "$unavailable_alias_path" 'add_header X-Content-Type-Options "nosniff" always;'
require_literal "$unavailable_alias_path" "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
require_literal "$unavailable_alias_path" 'return 404 "Direct local runtime aliases are unavailable in production. Open the Ingenium Dashboard and choose an authorized workspace.\n";'
reject_literal "$production_aliases_path" "proxy_pass"

if [ "${GATEWAY_VALIDATE_STATIC_ONLY:-0}" = "1" ]; then
  echo "Gateway static validation passed"
  exit 0
fi

nginx -t -c "$config_path"
