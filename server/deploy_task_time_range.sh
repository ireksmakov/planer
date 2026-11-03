#!/usr/bin/env bash
# Safe task start/end time release for Planner on the existing Zomro VPS.
# The trading bot and its services are never touched.
set -Eeuo pipefail
trap 'exit_code=$?; echo "PLANNER TIME RANGE UPDATE STOPPED (exit $exit_code)"; exit "$exit_code"' ERR
cd /opt/planer-source

if [ "$(id -u)" -ne 0 ]; then
  echo "Please run in Termius as root."; exit 1
fi
test -d /var/www/planer
test -f /etc/planer-api.env
test -x /opt/planer-api/venv/bin/python
systemctl is-active --quiet planer-api
systemctl is-active --quiet planer-reminders.timer

echo "Checking Planner API, Telegram subscriptions and start/end reminders..."
/opt/planer-api/venv/bin/python -m compileall -q server
/opt/planer-api/venv/bin/python -m unittest \
  server.test_task_time_range server.test_reminders \
  server.test_telegram_auth server.test_telegram_group server.test_telegram_gate_flow

echo "Building updated Planner interface..."
# OAuth button is hidden; no need to modify bot/group config.
npm run build -- --base=/

echo "Backing up the currently published frontend and task database..."
stamp="$(date +%Y%m%d%H%M%S)"
cp -a /var/www/planer "/var/www/planer.before-time-range.$stamp"
/opt/planer-api/venv/bin/python - <<'PY'
import os, sqlite3
from datetime import datetime
from pathlib import Path
source = Path(os.environ.get("PLANER_DB", "/opt/planer-api/data/planer.sqlite3"))
if not source.exists():
    raise SystemExit("Planner SQLite database not found; stopped.")
backup = source.with_name(source.name + ".before-time-range." + datetime.now().strftime("%Y%m%d%H%M%S") + ".bak")
with sqlite3.connect(source) as origin, sqlite3.connect(backup) as target:
    origin.backup(target)
backup.chmod(0o600)
print("Task backup:", backup)
PY

echo "Restarting only planner-api..."
systemctl restart planer-api
ready=false
for i in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo "Planner API unhealthy; do not publish frontend."
  systemctl status planer-api --no-pager --lines=15 || true
  exit 1
fi

cp -a dist/. /var/www/planer/
echo "PLANNER START AND END TIME DEPLOYED"
echo "Planner API: $(systemctl is-active planer-api)"
echo "Reminder timer: $(systemctl is-active planer-reminders.timer)"
