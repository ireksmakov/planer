#!/usr/bin/env bash
# Safe rollout of Ramadan clear-day UI and atomic cloud removal.
# Reuses the verified Planner-only deploy path (backup, API restart and UI build).
# Never touches static-tradingbot services or secrets.
set -Eeuo pipefail
cd /opt/planer-source
bash server/deploy_task_time_range.sh
echo "PLANNER RAMADAN CLEAR DEPLOYED"
