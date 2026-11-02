#!/usr/bin/env bash
# One-time opt-in Web Push setup for the existing Planner VPS.
# Does NOT touch the trading bot service or its files.
set -Eeuo pipefail
trap 'code=$?; echo "ERROR: установка прервана на строке ${LINENO}, код ${code}."; exit "$code"' ERR
echo "Проверяем окружение Планера..."
if [ "$(id -u)" -ne 0 ]; then echo "ERROR: требуется пользователь root"; exit 1; fi
cd /opt/planer-source
require_file() {
  if [ ! -f "$1" ]; then echo "ERROR: не найден файл: $1"; exit 1; fi
}
require_dir() {
  if [ ! -d "$1" ]; then echo "ERROR: не найдена папка: $1"; exit 1; fi
}
require_file /etc/planer-api.env
require_file /opt/planer-api/venv/bin/python
require_file /opt/planer-source/server/app.py
require_file /opt/planer-source/server/send_reminders.py
require_dir /var/www/planer
actual_workdir="$(systemctl show -p WorkingDirectory --value planer-api)"
if [ "$actual_workdir" != "/opt/planer-source" ]; then
  echo "ERROR: работающий planer-api использует другую папку: $actual_workdir"
  echo "Покажите вывод: systemctl cat planer-api"
  exit 1
fi
push_user="$(systemctl show -p User --value planer-api)"
if [ -z "$push_user" ] || ! id "$push_user" >/dev/null 2>&1; then
  echo "ERROR: не удалось определить пользователя службы planer-api"
  exit 1
fi
push_group="$(id -gn "$push_user")"
echo "Найден API: /opt/planer-source/server/app.py (пользователь $push_user)."
echo "Окружение проверено. Собираем фронтенд..."

set -a
. /etc/planer-api.env
set +a
VITE_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" npm run build -- --base=/

# Save the existing API before changing anything.
# The running API imports server.app from /opt/planer-source.
# Capture a known previously deployed API version for emergency rollback.
backup="/opt/planer-api/planer-app-pre-push.$(date +%Y%m%d%H%M%S).py"
if git cat-file -e 195918b:server/app.py 2>/dev/null; then
  git show 195918b:server/app.py > "$backup"
else
  cp -a server/app.py "$backup"
fi
/opt/planer-api/venv/bin/python -m pip install -r server/requirements.txt
install -d -m 700 /etc/planer-push
if [ ! -f /etc/planer-push/private_key.pem ]; then
  (cd /etc/planer-push && /opt/planer-api/venv/bin/vapid --gen >/dev/null)
fi
chown "$push_user:$push_group" /etc/planer-push /etc/planer-push/private_key.pem /etc/planer-push/public_key.pem
chmod 700 /etc/planer-push
chmod 600 /etc/planer-push/private_key.pem
chmod 644 /etc/planer-push/public_key.pem
# vapid CLI prints "Application Server Key = <key>", not just the key.
# Extract only the URL-safe base64 value so systemd and JS can read it.
public_key="$(cd /etc/planer-push && /opt/planer-api/venv/bin/vapid --applicationServerKey | sed -n 's/^Application Server Key = \([A-Za-z0-9_-]*\).*$/\1/p')"
if [[ ! "$public_key" =~ ^[A-Za-z0-9_-]{80,100}$ ]]; then
  echo "ERROR: не удалось получить корректный публичный VAPID-ключ"
  exit 1
fi
# Repair any older invalid value while keeping all other settings intact.
if grep -q '^PUSH_PUBLIC_KEY=' /etc/planer-api.env; then
  sed -i "s|^PUSH_PUBLIC_KEY=.*|PUSH_PUBLIC_KEY=$public_key|" /etc/planer-api.env
else
  printf 'PUSH_PUBLIC_KEY=%s\n' "$public_key" >> /etc/planer-api.env
fi
if ! grep -q '^PUSH_VAPID_PRIVATE_KEY=' /etc/planer-api.env; then
  printf 'PUSH_VAPID_PRIVATE_KEY=/etc/planer-push/private_key.pem\n' >> /etc/planer-api.env
fi
if ! grep -q '^PUSH_SUBJECT=' /etc/planer-api.env; then
  printf 'PUSH_SUBJECT=https://planer.fizmat-course.com\n' >> /etc/planer-api.env
fi
chmod 600 /etc/planer-api.env
/opt/planer-api/venv/bin/python -m py_compile server/app.py server/send_reminders.py

if ! systemctl restart planer-api || ! systemctl is-active --quiet planer-api; then
  echo "API update failed; restoring previous API"
  cp -a "$backup" /opt/planer-source/server/app.py
  systemctl restart planer-api
  echo "Откат API выполнен; проверьте журнал planer-api."
  exit 1
fi

cat > /etc/systemd/system/planer-reminders.service <<'UNIT'
[Unit]
Description=Planner timed Web Push reminders
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=planer
Group=planer
WorkingDirectory=/opt/planer-source
EnvironmentFile=/etc/planer-api.env
ExecStart=/opt/planer-api/venv/bin/python -m server.send_reminders
NoNewPrivileges=true
PrivateTmp=true
UNIT

cat > /etc/systemd/system/planer-reminders.timer <<'UNIT'
[Unit]
Description=Check Planner task reminders every minute

[Timer]
OnCalendar=*-*-* *:*:00
AccuracySec=1s
Persistent=false
Unit=planer-reminders.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now planer-reminders.timer
cp -a dist/. /var/www/planer/

echo "=== Notification API ==="
curl -fsS http://127.0.0.1:3001/api/push/public-key > /dev/null && echo "PUSH API OK"
systemctl is-active planer-api
systemctl is-active planer-reminders.timer
echo "WEB PUSH INSTALLED (private keys stay on VPS)"
