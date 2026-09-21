#!/bin/sh
# Wait for OpenCode's private HTTP listener before starting ttyd. This keeps
# ttyd from attaching during OpenCode startup while guaranteeing a finite wait.
set -eu

# This script is invoked before ttyd starts. Re-exec with a tiny allowlist so a
# container-level secret cannot reach either readiness curl or OpenCode's child.
if [ "${INGENIUM_OPENCODE_READINESS_CLEAN_ENV:-}" != "1" ]; then
  exec env -i \
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    INGENIUM_OPENCODE_READINESS_CLEAN_ENV="1" \
    /bin/sh "$0"
fi

attempts="${OPENCODE_READINESS_ATTEMPTS:-60}"
case "$attempts" in
  ''|*[!0-9]*)
    echo "ERROR: OPENCODE_READINESS_ATTEMPTS must be a positive integer"
    exit 1
    ;;
esac

if [ "$attempts" -le 0 ]; then
  echo "ERROR: OPENCODE_READINESS_ATTEMPTS must be greater than zero"
  exit 1
fi

attempt=1
while [ "$attempt" -le "$attempts" ]; do
  # OpenCode V2 requires HTTP basic auth on every route. Read the provisioned
  # secret inside this clean environment; the credential reaches curl through
  # stdin config, never argv. Containers without the secret (runtime gateways
  # terminate auth upstream) keep the unauthenticated probe.
  opencode_password=""
  if [ -r /run/ingenium-secrets/opencode/opencode-server-password ]; then
    opencode_password="$(cat /run/ingenium-secrets/opencode/opencode-server-password)"
  fi
  if [ -n "$opencode_password" ]; then
    if printf 'user = "opencode:%s"\n' "$opencode_password" | curl --fail --silent --config - --max-time 2 --output /dev/null http://127.0.0.1:4098/api/info; then
      echo "OpenCode readiness check passed after ${attempt} attempt(s)"
      exit 0
    fi
  elif curl --fail --silent --max-time 2 --output /dev/null http://127.0.0.1:4098/api/info; then
    echo "OpenCode readiness check passed after ${attempt} attempt(s)"
    exit 0
  fi

  if [ "$attempt" -eq "$attempts" ]; then
    break
  fi

  sleep 1
  attempt=$((attempt + 1))
done

echo "ERROR: OpenCode did not become ready on 127.0.0.1:4098 within ${attempts} seconds"
exit 1
