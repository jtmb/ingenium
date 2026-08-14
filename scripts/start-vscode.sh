#!/bin/sh
# code-server shares appuser and /workspace with the local container session.
# This auth-none, full-terminal administrator-grade profile is unsupported for LAN, remote, shared, or untrusted users.
set -eu

# Supervisor starts this service as appuser. Re-exec before any filesystem or
# code-server operation so inherited deployment secrets never reach code-server.
if [ "${1:-}" != "--clean-env" ]; then
  if [ "$#" -ne 0 ]; then
    echo "ERROR: start-vscode does not accept arguments"
    exit 1
  fi
  exec env -i \
    PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    HOME="/home/appuser" \
    XDG_CONFIG_HOME="/home/appuser/.config" \
    XDG_DATA_HOME="/home/appuser/.local/share" \
    INGENIUM_RUNTIME_BIND_HOST="${INGENIUM_RUNTIME_BIND_HOST:-127.0.0.1}" \
    /bin/sh "$0" --clean-env
fi

if [ "$(id -un)" != "appuser" ]; then
  echo "ERROR: code-server must run as appuser"
  exit 1
fi

VSCODE_DATA_DIR="/home/appuser/vscode-data"
VSCODE_EXTENSION_FILE="/usr/local/share/ingenium/vscode-extensions/sst-dev.opencode-0.0.13.vsix"
VSCODE_EXTENSION_ID="sst-dev.opencode@0.0.13"
VSCODE_EXTENSION_SHA256="e9a75751aa21fce3f9c9822d1f718043b1a9ba97e64c66b190a3fa85850c60d4"

for directory in "${VSCODE_DATA_DIR}/user-data" "${VSCODE_DATA_DIR}/extensions"; do
  if [ ! -d "$directory" ] || [ -L "$directory" ]; then
    echo "ERROR: code-server data directories must be initialized by the vscode-data volume"
    exit 1
  fi
done

if [ ! -f "$VSCODE_EXTENSION_FILE" ] || [ -L "$VSCODE_EXTENSION_FILE" ]; then
  echo "ERROR: baked code-server extension artifact is unavailable"
  exit 1
fi
artifact_sum="$(sha256sum "$VSCODE_EXTENSION_FILE")" || {
  echo "ERROR: baked code-server extension artifact cannot be verified"
  exit 1
}
case "$artifact_sum" in
  "$VSCODE_EXTENSION_SHA256"\ *) ;;
  *)
    echo "ERROR: baked code-server extension artifact hash is invalid"
    exit 1
    ;;
esac

code_server() {
  /usr/local/bin/code-server \
    --user-data-dir "${VSCODE_DATA_DIR}/user-data" \
    --extensions-dir "${VSCODE_DATA_DIR}/extensions" \
    "$@"
}

list_extensions() {
  extension_list="$(code_server --list-extensions --show-versions)" || {
    echo "ERROR: code-server extension list failed"
    exit 1
  }
  printf '%s\n' "$extension_list"
}

has_expected_extension() {
  found=0
  while IFS= read -r extension || [ -n "$extension" ]; do
    normalized_extension="$(printf '%s' "$extension" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    case "$normalized_extension" in
      sst-dev.opencode@*)
        if [ "$extension" != "$VSCODE_EXTENSION_ID" ]; then
          return 1
        fi
        found=$((found + 1))
        ;;
    esac
  done <<EOF
$1
EOF
  [ "$found" -eq 1 ]
}

extension_list="$(list_extensions)"
if ! has_expected_extension "$extension_list"; then
  if ! code_server --install-extension "$VSCODE_EXTENSION_FILE" --force; then
    echo "ERROR: baked code-server extension installation failed"
    exit 1
  fi
  extension_list="$(list_extensions)"
fi
if ! has_expected_extension "$extension_list"; then
  echo "ERROR: baked code-server extension identity is invalid"
  exit 1
fi

exec /usr/local/bin/code-server \
  --bind-addr "${INGENIUM_RUNTIME_BIND_HOST:-127.0.0.1}:4100" \
  --auth none \
  --disable-telemetry \
  --disable-update-check \
  --user-data-dir "${VSCODE_DATA_DIR}/user-data" \
  --extensions-dir "${VSCODE_DATA_DIR}/extensions" \
  /workspace
