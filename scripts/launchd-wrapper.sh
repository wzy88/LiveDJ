#!/bin/zsh
set -e

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_ROOT="/Users/wzy/Documents/网页电台"
STABLE_ROOT="/Users/wzy/Documents/claudio-radio-dev"

if [[ ! -e "$STABLE_ROOT" ]]; then
  /bin/ln -s "$PROJECT_ROOT" "$STABLE_ROOT"
fi

cd "$STABLE_ROOT"

/usr/local/bin/node server/index.js &
BACKEND_PID=$!

/usr/local/bin/npm run dev:web &
FRONTEND_PID=$!

trap 'kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true' EXIT INT TERM

while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    wait "$BACKEND_PID"
    exit $?
  fi
  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    wait "$FRONTEND_PID"
    exit $?
  fi
  sleep 2
done
