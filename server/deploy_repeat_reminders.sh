#!/usr/bin/env bash
# Safely deploy optional repeat reminders; do not rerun Web Push key setup.
set -Eeuo pipefail
trap 'code=$?; echo "DEPLOY FAILED (line ${LINENO}, exit ${code})"; exit "$code"' ERR
cd /opt/planer-source

test -f /etc/planer-api.env
test -x /opt/planer-api/venv/bin/python
systemctl is-active --quiet planer-api
systemctl is-active --quiet planer-reminders.timer

echo "Checking Python code and reminder schedule tests..."
/opt/planer-api/venv/bin/python -m py_compile server/app.py server/send_reminders.py
/opt/planer-api/venv/bin/python -m unittest server.test_reminders

echo "Building the latest Planner..."
set -a
. /etc/planer-api.env
set +a
VITE_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" npm run build -- --base=/

echo "Backing up SQLite without interrupting active users..."
/opt/planer-api/venv/bin/python - <<'PY'
import os
from pathlib import Path
from datetime import datetime
import sqlite3
source = Path(os.environ.get('PLANER_DB', '/opt/planer-api/data/planer.sqlite3'))
if not source.is_file():
    raise SystemExit(f"Database not found: {source}")
target = source.with_name(source.name + ".before-repeat." + datetime.now().strftime('%Y%m%d%H%M%S') + ".bak")
with sqlite3.connect(str(source)) as src, sqlite3.connect(str(target)) as dst:
    src.backup(dst)
target.chmod(0o600)
print("SQLite backup:", target)
PY

echo "Restarting only the Planner API (not the trading bot)..."
if ! systemctl restart planer-api; then
  echo "ERROR: Could not restart the Planner API."
  systemctl status planer-api --no-pager --lines=15 || true
  exit 1
fi

# systemctl may mark a service active before Uvicorn opens its listening socket.
echo "Waiting for Planner API to listen on 127.0.0.1:3001..."
api_ready=false
for attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    api_ready=true
    break
  fi
  if ! systemctl is-active --quiet planer-api; then
    echo "Planner API stopped during startup."
    break
  fi
  sleep 1
done
if [ "$api_ready" != true ]; then
  echo "ERROR: Planner API is not ready. Frontend remains unchanged."
  systemctl status planer-api --no-pager --lines=15 || true
  echo "Diagnosis: journalctl -u planer-api -n 35 --no-pager"
  exit 1
fi

# New reminder code is imported on every systemd timer run.
cp -a dist/. /var/www/planer/
echo "Planner API: active"
echo "Reminder timer: $(systemctl is-active planer-reminders.timer)"
echo "REPEAT REMINDERS DEPLOYED"
