#!/usr/bin/env bash
# Configure BOTH Telegram communities for a one-time Planner sign-in gate.
# Existing Telegram-linked tasks and Google accounts stay untouched.
set -Eeuo pipefail
trap 'status=$?; echo "GROUP SETUP STOPPED (line ${LINENO}, exit $status)"; exit "$status"' ERR
cd /opt/planer-source

if [ "$(id -u)" -ne 0 ]; then echo "Run as root in Termius"; exit 1; fi
test -f /etc/planer-api.env
test -x /opt/planer-api/venv/bin/python
test -f /var/www/planer/index.html

set -a
. /etc/planer-api.env
set +a
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "Planner Telegram bot has not been installed yet"; exit 1
fi

# Both public community links were supplied by the Planner owner.
# No manual token entry, no contact with the trading bot service.
export TELEGRAM_REQUIRED_CHAT_IDS="@mathematician24,@investment2027"
echo "Проверяем бота и права администратора в обоих сообществах..."
/opt/planer-api/venv/bin/python - <<'PY'
from server.telegram_membership import configured_groups, telegram_api

groups = configured_groups()
if {g["id"] for g in groups} != {"@mathematician24", "@investment2027"}:
    raise SystemExit("ERROR: неправильная конфигурация Telegram-сообществ")
me = telegram_api("getMe", {})
if not isinstance(me, dict) or not me.get("is_bot"):
    raise SystemExit("ERROR: не удалось проверить бота")
for group in groups:
    result = telegram_api("getChatMember", {
        "chat_id": group["id"], "user_id": me["id"]
    })
    if not isinstance(result, dict) or result.get("status") not in ("administrator", "creator"):
        raise SystemExit("ERROR: сделайте @planer12345_bot администратором: " + group["title"])
    print("Telegram group verified:", group["title"], group["url"])
PY

echo "Проверяем код авторизации и напоминаний..."
/opt/planer-api/venv/bin/python -m compileall -q server
/opt/planer-api/venv/bin/python -m unittest server.test_telegram_auth server.test_telegram_group server.test_reminders

echo "Создаём резервные копии настроек и задач..."
backup="/etc/planer-api.env.before-group.$(date +%Y%m%d%H%M%S)"
cp -a /etc/planer-api.env "$backup"
/opt/planer-api/venv/bin/python - <<'PY'
import os, sqlite3
from datetime import datetime
from pathlib import Path
src = Path(os.getenv("PLANER_DB", "/opt/planer-api/data/planer.sqlite3"))
if not src.is_file():
    raise SystemExit("ERROR: база задач не найдена: " + str(src))
dst = src.with_name(src.name + ".before-group." + datetime.now().strftime("%Y%m%d%H%M%S") + ".bak")
with sqlite3.connect(src) as source, sqlite3.connect(dst) as destination:
    source.backup(destination)
dst.chmod(0o600)
print("SQLite backup:", dst)
PY

echo "Сохраняем оба сообщества в приватной конфигурации Планера..."
/opt/planer-api/venv/bin/python - <<'PY'
import os, stat
from pathlib import Path
path = Path("/etc/planer-api.env")
remove = (
    "TELEGRAM_REQUIRED_CHAT_ID=",
    "TELEGRAM_REQUIRED_CHAT_URL=",
    "TELEGRAM_REQUIRED_CHAT_IDS=",
)
lines = [line for line in path.read_text().splitlines() if not line.startswith(remove)]
lines.append("TELEGRAM_REQUIRED_CHAT_IDS=" + os.environ["TELEGRAM_REQUIRED_CHAT_IDS"])
temp = path.with_name(path.name + ".group-temp")
fd = os.open(str(temp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as out:
    out.write("\\n".join(lines) + "\\n")
os.replace(temp, path)
os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
PY

echo "Собираем новую версию сайта..."
if ! VITE_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" npm run build -- --base=/; then
  cp -a "$backup" /etc/planer-api.env
  echo "Build failed; settings restored."
  exit 1
fi

echo "Перезапускаем только planer-api..."
if ! systemctl restart planer-api; then
  cp -a "$backup" /etc/planer-api.env
  systemctl restart planer-api || true
  echo "API restart failed; previous settings restored."
  exit 1
fi
ready=false
for attempt in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    ready=true; break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  cp -a "$backup" /etc/planer-api.env
  systemctl restart planer-api || true
  echo "API did not respond. Original settings restored; site unchanged."
  exit 1
fi

echo "Включаем кнопку проверки подписки в Telegram..."
/opt/planer-api/venv/bin/python - <<'PY'
import json, os, urllib.request
req = urllib.request.Request(
    "https://api.telegram.org/bot" + os.environ["TELEGRAM_BOT_TOKEN"] + "/setWebhook",
    data=json.dumps({
        "url": "https://planer.fizmat-course.com/api/telegram/webhook",
        "secret_token": os.environ["TELEGRAM_WEBHOOK_SECRET"],
        "allowed_updates": ["message", "callback_query"],
        "drop_pending_updates": False
    }).encode(),
    headers={"Content-Type": "application/json"}, method="POST"
)
with urllib.request.urlopen(req, timeout=12) as response:
    data = json.load(response)
if data.get("ok") is not True or data.get("result") is not True:
    raise SystemExit("Could not update Telegram webhook")
print("Telegram callback verification enabled")
PY

config="$(curl -fsS --max-time 5 http://127.0.0.1:3001/api/auth/config)"
if ! printf '%s' "$config" | /opt/planer-api/venv/bin/python -c '
import json,sys
config = json.load(sys.stdin)
expected = {"https://t.me/mathematician24", "https://t.me/investment2027"}
actual = {g["url"] for g in config.get("groups", [])}
sys.exit(0 if config.get("telegram") is True and actual == expected else 1)
'; then
  echo "Оба Telegram-сообщества не активны; сайт не обновлён."
  exit 1
fi

cp -a dist/. /var/www/planer/
echo "TELEGRAM TWO COMMUNITY LOGIN DEPLOYED"
echo "Planner API: $(systemctl is-active planer-api)"
echo "Reminder timer: $(systemctl is-active planer-reminders.timer)"
echo "Google sign-in hidden; first Telegram login requires FIZMAT + Investment membership."
