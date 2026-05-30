#!/usr/bin/env bash
set -euo pipefail

state_dir="/var/lib/doom-perf"
ready_marker="${state_dir}/ready"

mkdir -p "${state_dir}"
rm -f "${ready_marker}"

for cmd in curl doomperf-telemetry nginx; do
  command -v "${cmd}" >/dev/null 2>&1 || {
    echo "missing expected tool: ${cmd}" >&2
    exit 1
  }
done

for asset in \
  /opt/doom-perf/public/index.html \
  /opt/doom-perf/public/game/index.html \
  /opt/doom-perf/public/dist/index.js \
  /opt/doom-perf/public/engine/doom.js \
  /opt/doom-perf/public/engine/doom.wasm \
  /opt/doom-perf/public/maps/doomperf-lab.wad; do
  test -f "${asset}" || {
    echo "missing expected asset: ${asset}" >&2
    exit 1
  }
done

nginx -t

deadline=$((SECONDS + 120))
until curl -fsS http://127.0.0.1:8080/healthz >/dev/null; do
  if (( SECONDS >= deadline )); then
    echo "doom-perf web service did not become ready" >&2
    systemctl --no-pager --full status doomperf-telemetry nginx || true
    exit 1
  fi
  sleep 1
done

touch "${ready_marker}"
chmod 0644 "${ready_marker}"
