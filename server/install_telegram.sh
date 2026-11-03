#!/usr/bin/env bash
# One-time setup: a SEPARATE Telegram bot for Planner, not the trading bot.
# Keeps existing SQLite data, VAPID keys and other systemd services untouched.
set -Eeuo pipefail
trap 'code=$?; echo "TELEGRAM SETUP FAILED (line ${LINENO}, exit ${code})"; exit "$code"' ERR

if [ "$(id -u)" -ne 0 ]; then echo "Run in Termius as root."; exit 1; fi
cd /opt/planer-source
test -f /etc/planer-api.env
test -x /opt/planer-api/venv/bin/python
test -d /var/www/planer
systemctl is-active --quiet planer-api
systemctl is-active --quiet planer-reminders.timer

echo "Checking the Planner backend and Telegram login tests..."
/opt/planer-api/venv/bin/python -m py_compile server/app.py server/telegram_auth.py server/send_reminders.py
/opt/planer-api/venv/bin/python -m unittest server.test_reminders server.test_telegram_auth

set -a
. /etc/planer-api.env
set +a

bot_username="${TELEGRAM_BOT_USERNAME:-}"
bot_token="${TELEGRAM_BOT_TOKEN:-}"
if [ -z "$bot_username" ]; then
  read -r -p "Введите username НОВОГО бота Планера (без @): " bot_username
fi
bot_username="${bot_username#@}"
if [[ ! "$bot_username" =~ ^[A-Za-z][A-Za-z0-9_]{4,31}$ ]]; then
  echo "Invalid bot username"; exit 1
fi
if [ -z "$bot_token" ]; then
  # Termius on iPhone sometimes submits an empty value for Bash "read -s".
  # Disable terminal echo instead, then use the ordinary readable input path.
  # Restore the terminal even when Ctrl+C or an error interrupts setup.
  trap 'stty echo </dev/tty 2>/dev/null || true' EXIT
  stty -echo </dev/tty
  IFS= read -r -p "Вставьте токен бота из BotFather (символы не отображаются): " bot_token
  stty echo </dev/tty
  echo
fi
if [[ ! "$bot_token" =~ ^[0-9]{5,20}:[A-Za-z0-9_-]{25,}$ ]]; then
  echo "Invalid bot token format"; exit 1
fi
export TELEGRAM_BOT_USERNAME="$bot_username"
export TELEGRAM_BOT_TOKEN="$bot_token"

echo "Verifying Telegram bot identity without displaying its token..."
/opt/planer-api/venv/bin/python - <<'PY'
import json, os, sys, urllib.request
token = os.environ["TELEGRAM_BOT_TOKEN"]
username = os.environ["TELEGRAM_BOT_USERNAME"]
def call(name):
    req = urllib.request.Request("https://api.telegram.org/bot" + token + "/" + name)
    with urllib.request.urlopen(req, timeout=10) as res:
        data = json.load(res)
    if not data.get("ok"): raise SystemExit("Telegram API did not confirm bot")
    return data["result"]
me = call("getMe")
if me.get("username","").lower() != username.lower() or not me.get("is_bot"):
    raise SystemExit("This token belongs to a DIFFERENT bot. No settings were changed.")
hook = call("getWebhookInfo")
actual = hook.get("url", "")
expected = "https://planer.fizmat-course.com/api/telegram/webhook"
if actual and actual != expected:
    raise SystemExit("This bot already has another webhook. Use a NEW Planner bot.")
print("Bot verified:", "@" + username)
PY

echo "Backing up the existing task database and Planner environment file..."
/opt/planer-api/venv/bin/python - <<'PY'
import os, sqlite3
from datetime import datetime
from pathlib import Path
path = Path(os.environ.get("PLANER_DB", "/opt/planer-api/data/planer.sqlite3"))
if not path.is_file(): raise SystemExit("Task database missing: " + str(path))
stamp = datetime.now().strftime("%Y%m%d%H%M%S")
backup = path.with_name(path.name + ".before-telegram." + stamp + ".bak")
with sqlite3.connect(path) as source, sqlite3.connect(backup) as destination:
    source.backup(destination)
backup.chmod(0o600)
print("Task backup stored:", backup)
PY
cp -a /etc/planer-api.env "/etc/planer-api.env.before-telegram.$(date +%Y%m%d%H%M%S)"

echo "Saving Telegram bot credentials privately (never in the website build)..."
/opt/planer-api/venv/bin/python - <<'PY'
from pathlib import Path
import os, secrets, stat
path = Path("/etc/planer-api.env")
existing = path.read_text()
names = ("TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET")
values = {
    "TELEGRAM_BOT_TOKEN": os.environ["TELEGRAM_BOT_TOKEN"],
    "TELEGRAM_BOT_USERNAME": os.environ["TELEGRAM_BOT_USERNAME"],
    "TELEGRAM_WEBHOOK_SECRET": os.environ.get("TELEGRAM_WEBHOOK_SECRET") or secrets.token_urlsafe(36),
}
lines = [line for line in existing.splitlines() if not any(line.startswith(key + "=") for key in names)]
lines.extend(key + "=" + values[key] for key in names)
temp = path.with_suffix(".telegram-tmp")
fd = os.open(str(temp), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as out:
    out.write("\n".join(lines) + "\n")
os.replace(temp, path)
os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
print("Private Telegram settings saved.")
PY

echo "Building Planner interface..."
VITE_GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" npm run build -- --base=/

echo "Restarting only planer-api (trading bot stays running)..."
systemctl restart planer-api
ready=false
for i in {1..30}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    ready=true; break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo "Planner API failed to start. Do not publish frontend."
  systemctl status planer-api --no-pager --lines=25 || true
  exit 1
fi

set -a
. /etc/planer-api.env
set +a
echo "Registering Telegram webhook on the same Planner HTTPS domain..."
/opt/planer-api/venv/bin/python - <<'PY'
import json, os, urllib.request
token = os.environ["TELEGRAM_BOT_TOKEN"]
payload = {
    "url": "https://planer.fizmat-course.com/api/telegram/webhook",
    "secret_token": os.environ["TELEGRAM_WEBHOOK_SECRET"],
    "allowed_updates": ["message"],
    "drop_pending_updates": False,
}
req = urllib.request.Request(
    "https://api.telegram.org/bot" + token + "/setWebhook",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"}, method="POST",
)
with urllib.request.urlopen(req, timeout=12) as res:
    result = json.load(res)
if not result.get("ok") or result.get("result") is not True:
    raise SystemExit("Telegram webhook could not be registered")
print("Telegram webhook configured successfully")
PY

config="$(curl -fsS --max-time 5 http://127.0.0.1:3001/api/auth/config)"
if ! printf '%s' "$config" | grep -q '"telegram":true'; then
  # JSON from FastAPI is usually compact. Check both standard forms.
  if ! printf '%s' "$config" | grep -q '"telegram": true'; then
    echo "Telegram bot settings did not load in the Planner API; frontend was not published."
    exit 1
  fi
fi

cp -a dist/. /var/www/planer/
echo "PLANNER TELEGRAM LOGIN AND REMINDERS DEPLOYED"
echo "Planner API: $(systemctl is-active planer-api)"
echo "Reminders: $(systemctl is-active planer-reminders.timer)"
echo "Bot: @$bot_username"
echo "Never share the BotFather token or the server environment file."
