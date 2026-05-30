#!/usr/bin/env bash
set -euo pipefail

ready_marker="/var/lib/doom-perf/ready"
deadline=$((SECONDS + 300))

while [[ ! -f "${ready_marker}" ]]; do
  if (( SECONDS >= deadline )); then
    echo "timed out waiting for ${ready_marker}" >&2
    systemctl --no-pager --full status doomperf-bootstrap doomperf-telemetry nginx || true
    exit 1
  fi
  sleep 1
done

curl -fsS http://127.0.0.1:8080/healthz >/dev/null
