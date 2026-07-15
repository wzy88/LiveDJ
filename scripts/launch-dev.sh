#!/bin/zsh
set -e

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PROJECT_ROOT="/Users/wzy/Documents/网页电台"
STABLE_ROOT="/Users/wzy/Documents/claudio-radio-dev"

if [[ ! -e "$STABLE_ROOT" ]]; then
  /bin/ln -s "$PROJECT_ROOT" "$STABLE_ROOT"
fi

cd "$STABLE_ROOT"
exec /usr/local/bin/npm run dev
