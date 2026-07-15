#!/bin/zsh
set -e

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_ROOT="/Users/wzy/Documents/网页电台"
STABLE_ROOT="/Users/wzy/Documents/claudio-radio-dev"

if [[ ! -e "$STABLE_ROOT" ]]; then
  /bin/ln -s "$PROJECT_ROOT" "$STABLE_ROOT"
fi

cd "$STABLE_ROOT"

frontend_ok=0
backend_ok=0

if /usr/sbin/lsof -iTCP:5173 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  frontend_ok=1
fi

if /usr/sbin/lsof -iTCP:8787 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  backend_ok=1
fi

if [[ "$frontend_ok" == "1" && "$backend_ok" == "1" ]]; then
  echo "Claudio dev server is already running."
  exit 0
fi

mkdir -p "/Users/wzy/Library/Logs"
if [[ "$backend_ok" != "1" ]]; then
  nohup /usr/local/bin/node server/index.js > "/Users/wzy/Library/Logs/claudio-radio-server.out.log" 2> "/Users/wzy/Library/Logs/claudio-radio-server.err.log" &
  echo "Started Claudio backend. PID: $!"
fi

if [[ "$frontend_ok" != "1" ]]; then
  nohup /usr/local/bin/npm run dev:web > "/Users/wzy/Library/Logs/claudio-radio-web.out.log" 2> "/Users/wzy/Library/Logs/claudio-radio-web.err.log" &
  echo "Started Claudio frontend. PID: $!"
fi
