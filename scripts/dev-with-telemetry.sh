#!/usr/bin/env bash
set -euo pipefail

go run ./cmd/telemetry &
telemetry_pid=$!

./node_modules/.bin/esbuild src/index.ts \
  --bundle \
  --sourcemap \
  --loader:.vert=text \
  --loader:.frag=text \
  --outdir=public/dist \
  --servedir=public \
  --watch=forever &
web_pid=$!

cleanup() {
  kill "$web_pid" "$telemetry_pid" 2>/dev/null || true
  wait "$web_pid" "$telemetry_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM
wait -n "$web_pid" "$telemetry_pid"
