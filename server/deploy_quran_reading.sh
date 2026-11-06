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
echo "PLANNER QURAN READING DEPLOYED"
