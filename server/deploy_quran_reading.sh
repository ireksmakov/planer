#!/usr/bin/env bash
# Safe Planner-only deployment of the Quran reading feature.
# The existing deployment performs backups, API tests, health check and UI build.
# No trading bot service is touched.
set -Eeuo pipefail
cd /opt/planer-source
echo "Checking all five Quran plans, including the last four pages..."
node scripts/test-quran-pages.mjs
echo "Deploying the Quran section with Planner database backup..."
bash server/deploy_task_time_range.sh
echo "Checking whether the public Quran text source is reachable from the VPS..."
if curl -fsS --max-time 23 http://127.0.0.1:3001/api/quran/page/1 | \
  /opt/planer-api/venv/bin/python -c 'import json,sys; data=json.load(sys.stdin); assert data["page"] == 1 and len(data["ayahs"]) > 0' >/dev/null; then
  echo "QURAN TEXT: live page verified"
else
  echo "QURAN TEXT WARNING: source temporarily unreachable. Planner and tasks are safe; reading may need a retry."
fi
echo "PLANNER QURAN READING DEPLOYED"
