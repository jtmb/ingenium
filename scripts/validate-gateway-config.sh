#!/bin/sh
# Non-secret static validation hook. Run inside the built image or container.
set -eu

config_path="${1:-/app/nginx/gateway.conf}"
config_dir="$(dirname "$config_path")"
opencode_proxy_path="${config_dir}/proxy-opencode.conf"
dashboard_proxy_path="${config_dir}/proxy-dashboard.conf"
oauth_callback_proxy_path="${config_dir}/proxy-oauth-callback.conf"

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

require_literal "$config_path" "access_log off;"
require_literal "$config_path" "pid /run/ingenium-gateway/nginx.pid;"
require_literal "$config_path" "lock_file /run/ingenium-gateway/nginx.lock;"
require_literal "$config_path" "error_log /run/ingenium-gateway/nginx-error.log warn;"
reject_literal "$config_path" "error_log stderr warn;"
reject_literal "$config_path" "error_log /dev/stderr"
require_literal "$config_path" "limit_req_zone \$binary_remote_addr zone=dashboard_request:10m rate=30r/s;"
require_literal "$config_path" "limit_req_zone \$opencode_request_limit_key zone=opencode_request:10m rate=30r/s;"
require_literal "$config_path" "limit_conn_zone \$binary_remote_addr zone=gateway_conn:10m;"
require_literal "$config_path" "limit_conn gateway_conn 16;"
require_literal "$config_path" "map \$http_upgrade \$opencode_upgrade_rate_limit_key {"
require_literal "$config_path" "map \$uri \$opencode_request_limit_key {"
require_literal "$config_path" "~^/(?:assets/|_next/|@vite/|node_modules/\\.vite/) \"\";"
require_literal "$config_path" "map \$host \$dashboard_ipv6_loopback {"
require_literal "$config_path" "\"::1\" 1;"
require_literal "$config_path" "return 308 http://localhost:3000\$request_uri;"
require_literal "$config_path" "map \$http_origin \$ttyd_websocket_upstream_host {"
require_literal "$config_path" "\"http://localhost:3000\" \"localhost:3000\";"
require_literal "$config_path" "\"http://127.0.0.1:3000\" \"127.0.0.1:3000\";"
require_literal "$config_path" "\"http://cli.localhost:3000\" \"cli.localhost:3000\";"
require_literal "$config_path" "limit_req zone=dashboard_request burst=60 nodelay;"
require_literal "$config_path" "limit_req zone=opencode_request burst=60 nodelay;"
reject_literal "$config_path" "zone=gateway_request"
require_literal "$config_path" "server_name _;"
require_literal "$config_path" "listen [::]:3000 default_server;"
require_literal "$config_path" "proxy_pass http://ingenium_dashboard;"
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
require_literal "$config_path" "location = /_ingenium/health"
require_literal "$config_path" "proxy_pass http://opencode_cli;"
require_literal "$config_path" "proxy_set_header X-Ingenium-Authenticated-User healthcheck;"
require_literal "$config_path" "proxy_set_header X-Ingenium-Authenticated-User local-gateway;"
require_literal "$config_path" "location = /ws {"
require_literal "$config_path" "if (\$ttyd_websocket_upstream_host = \"\") {"
require_literal "$config_path" "return 403;"
require_literal "$config_path" "proxy_set_header Host \$ttyd_websocket_upstream_host;"
require_literal "$config_path" "proxy_set_header Origin \$http_origin;"
require_literal "$config_path" "include /app/nginx/proxy-dashboard.conf;"
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

# This endpoint is loopback-only and must route only to ttyd.
health_locations="$(grep -F -c 'location = /_ingenium/health' "$config_path")"
if [ "$health_locations" -ne 1 ]; then
  echo "ERROR: gateway must expose exactly one internal health location for ttyd"
  exit 1
fi

callback_locations="$(grep -F -c 'location = /auth/callback' "$config_path")"
if [ "$callback_locations" -ne 1 ]; then
  echo "ERROR: OAuth callback listener must expose exactly one exact callback location"
  exit 1
fi

if [ "${GATEWAY_VALIDATE_STATIC_ONLY:-0}" = "1" ]; then
  echo "Gateway static validation passed"
  exit 0
fi

nginx -t -c "$config_path"
