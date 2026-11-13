#!/bin/zsh
# Try signing in and sync in the simulator without Sign in with Apple.
#
# Sign in with Apple only works in a build signed with an Apple Developer team. This runs the backend on this Mac
# with developer sign-in turned on and points the simulator's debug build at it.
#
#   ios/scripts/local-server.sh          start the local server and point the app at it
#   ios/scripts/local-server.sh off      point the app back at https://api.eksigo.com
#
# Then, in the app: Me › Sign in › "Developer sign-in (local server)".
set -euo pipefail
cd "$(dirname "$0")/../.."

APP=com.eksigo.app

if [[ ${1:-} == off ]]; then
  xcrun simctl spawn booted defaults delete $APP apiBase 2>/dev/null || true
  xcrun simctl terminate booted $APP 2>/dev/null || true
  xcrun simctl launch booted $APP >/dev/null
  echo "The app uses https://api.eksigo.com again (sign in again there)."
  exit 0
fi

if ! curl -sf http://localhost:8000/v1/health >/dev/null; then
  echo "Starting the local server (log: backend/data/local-server.log)…"
  mkdir -p backend/data
  (cd backend && EKSIGO_DEV_LOGIN=1 nohup uv run uvicorn app.main:create_app --factory --port 8000 \
     > data/local-server.log 2>&1 &)
  for _ in {1..30}; do curl -sf http://localhost:8000/v1/health >/dev/null && break; sleep 1; done
fi
curl -sf http://localhost:8000/v1/health >/dev/null || { echo "The server didn't start; see backend/data/local-server.log"; exit 1; }

xcrun simctl spawn booted defaults write $APP apiBase http://localhost:8000
xcrun simctl terminate booted $APP 2>/dev/null || true
xcrun simctl launch booted $APP >/dev/null
echo "The app now uses http://localhost:8000. Sign in with \"Developer sign-in (local server)\"."
