#!/usr/bin/env bash
# Installed as /usr/local/bin/use-practice in the doom-perf lab image.
# Points the bundled use-practice dispatcher at its baked repo root and a
# laborant-writable runtime state dir, then hands off. See the doom-perf
# iximiuz Dockerfile for how the use-practice tree is copied in.
export USE_PRACTICE_ROOT=/opt/use-practice
export USE_PRACTICE_STATE_DIR=/var/lib/use-practice/state
exec /opt/use-practice/use-practice "$@"
