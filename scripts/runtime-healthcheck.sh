#!/bin/sh
set -eu

curl --fail --silent --max-time 3 --output /dev/null http://127.0.0.1:4098/
curl --fail --silent --max-time 3 --output /dev/null --header "X-Ingenium-Authenticated-User: runtime" http://127.0.0.1:4099/
curl --fail --silent --max-time 3 --output /dev/null http://127.0.0.1:4100/healthz
