#!/usr/bin/env bash
# Deploy presentation-only changes to Planner, without restarting any service.
set -Eeuo pipefail
cd /opt/planer-source
if [ "$(id -u)" -ne 0 ]; then echo "Run as root in Termius"; exit 1; fi
test -d /var/www/planer
test -f package.json
echo "Building updated Planner layout..."
npm run build -- --base=/
stamp="$(date +%Y%m%d%H%M%S)"
backup="/var/www/planer.before-ui.$stamp"
cp -a /var/www/planer "$backup"
echo "Previous website saved to: $backup"
cp -a dist/. /var/www/planer/
echo "PLANNER FRONTEND UPDATED"
echo "Planner API: $(systemctl is-active planer-api)"
echo "Reminder timer: $(systemctl is-active planer-reminders.timer)"
