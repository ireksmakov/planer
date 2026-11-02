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
require_file /opt/planer-api/app.py
require_dir /var/www/planer
echo "Окружение проверено. Собираем фронтенд..."

set -a
. /etc/planer-api.env
set +a
VITE_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" npm run build -- --base=/

# Save the existing API before changing anything.
backup="/opt/planer-api/app.py.bak.$(date +%Y%m%d%H%M%S)"
cp -a /opt/planer-api/app.py "$backup"
/opt/planer-api/venv/bin/python -m pip install -r server/requirements.txt
install -d -m 700 /etc/planer-push
if [ ! -f /etc/planer-push/private_key.pem ]; then
  (cd /etc/planer-push && /opt/planer-api/venv/bin/vapid --gen >/dev/null)
fi
chmod 600 /etc/planer-push/private_key.pem
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
cp -a server/app.py /opt/planer-api/app.py
cp -a server/send_reminders.py /opt/planer-api/send_reminders.py
/opt/planer-api/venv/bin/python -m py_compile /opt/planer-api/app.py /opt/planer-api/send_reminders.py

if ! systemctl restart planer-api || ! systemctl is-active --quiet planer-api; then
  echo "API update failed; restoring previous API"
  cp -a "$backup" /opt/planer-api/app.py
  systemctl restart planer-api
  exit 1
fi

cat > /etc/systemd/system/planer-reminders.service <<'UNIT'
[Unit]
Description=Planner timed Web Push reminders
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=/opt/planer-api
EnvironmentFile=/etc/planer-api.env
ExecStart=/opt/planer-api/venv/bin/python /opt/planer-api/send_reminders.py
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
