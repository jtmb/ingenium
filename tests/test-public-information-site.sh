#!/usr/bin/env bash
set -euo pipefail
IMAGE="${1:?runtime image is required}"
docker run --rm --network none --user 1000:1000 --entrypoint sh -i "$IMAGE" -s <<'CONTAINER'
set -eu
run_root="$(mktemp -d)"
cleanup() { nginx -c "$run_root/nginx.conf" -s quit >/dev/null 2>&1 || true; }
trap cleanup EXIT
cat > "$run_root/nginx.conf" <<EOF
pid $run_root/nginx.pid;
error_log stderr warn;
events { worker_connections 32; }
http {
    include /etc/nginx/mime.types;
    client_body_temp_path $run_root/client;
    include /app/nginx/public-information.conf;
}
EOF
nginx -c "$run_root/nginx.conf"
for path in / /index.html /privacy.html /terms.html; do
    code="$(curl --silent --output "$run_root/body" --write-out '%{http_code}' "http://127.0.0.1:4170$path")"
    test "$code" = 200
    grep -q '<!doctype html>' "$run_root/body"
done
for path in /api/v1/projects /mail /chat /opencode /secrets /.env /README.md /provenance.json /%2e%2e/.env; do
    code="$(curl --path-as-is --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:4170$path")"
    test "$code" = 404
done
test "$(curl --silent --request POST --output /dev/null --write-out '%{http_code}' http://127.0.0.1:4170/)" = 405
curl --silent --head http://127.0.0.1:4170/ > "$run_root/headers"
grep -qi '^Content-Security-Policy:' "$run_root/headers"
! grep -qi '^Set-Cookie:' "$run_root/headers"
printf 'PASS: public information origin serves only the three static pages; private paths and writes are denied\n'
CONTAINER
