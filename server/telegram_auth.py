"""Telegram bot-based Planner login, account linking and durable sessions.

Telegram identity is trusted ONLY after a secret-protected Telegram Bot API webhook
reports a private /start containing a one-time, short-lived random challenge.
No bot tokens or webhook secrets are ever sent to the browser.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from urllib import request as http_request
from urllib.error import HTTPError, URLError
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

SESSION_TTL = 30 * 24 * 60 * 60
CHALLENGE_TTL = 10 * 60
ID_PATTERN = re.compile(r"^[0-9]{1,20}$")
BOT_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")
CHALLENGE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{24,64}$")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def init_tables(db):
    db.execute("""CREATE TABLE IF NOT EXISTS auth_sessions (
        secret_hash TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        expires_at INTEGER NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS telegram_accounts (
        tg_id TEXT PRIMARY KEY,
        uid TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        time_zone TEXT NOT NULL DEFAULT 'UTC',
        notifications_enabled INTEGER NOT NULL DEFAULT 1
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS idx_telegram_accounts_uid ON telegram_accounts(uid)")
    db.execute("""CREATE TABLE IF NOT EXISTS telegram_login_requests (
        request_hash TEXT PRIMARY KEY,
        poll_hash TEXT NOT NULL UNIQUE,
        mode TEXT NOT NULL,
        target_uid TEXT,
        tg_id TEXT,
        time_zone TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        completed INTEGER NOT NULL DEFAULT 0,
        consumed INTEGER NOT NULL DEFAULT 0
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS sent_telegram_reminders (
        tg_id TEXT NOT NULL, task_id TEXT NOT NULL,
        task_date TEXT NOT NULL, task_time TEXT NOT NULL, step INTEGER NOT NULL,
        PRIMARY KEY(tg_id, task_id, task_date, task_time, step)
    )""")


def lookup_session(db, token: str):
    """Return (current uid, provider) or None. Telegram uid follows account linking."""
    if not token.startswith("pln_") or len(token) > 120:
        return None
    row = db.execute(
        "SELECT provider,subject,expires_at FROM auth_sessions WHERE secret_hash=?",
        (digest(token),)
    ).fetchone()
    if row is None or row[2] < int(time.time()):
        return None
    provider, subject, _ = row
    if provider == "google":
        return subject, provider
    if provider == "telegram":
        mapped = db.execute("SELECT uid FROM telegram_accounts WHERE tg_id=?", (subject,)).fetchone()
        if mapped is not None:
            return mapped[0], provider
    return None


def create_session(db, provider: str, subject: str) -> str:
    token = "pln_" + secrets.token_urlsafe(36)
    db.execute(
        "INSERT INTO auth_sessions(secret_hash,provider,subject,expires_at) VALUES(?,?,?,?)",
        (digest(token), provider, subject, int(time.time()) + SESSION_TTL)
    )
    return token


def telegram_enabled() -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    username = os.environ.get("TELEGRAM_BOT_USERNAME", "").lstrip("@").strip()
    webhook_secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "").strip()
    return bool(
        re.fullmatch(r"[0-9]{5,20}:[A-Za-z0-9_-]{25,}", token)
        and BOT_PATTERN.fullmatch(username)
        and re.fullmatch(r"[A-Za-z0-9_-]{32,256}", webhook_secret)
    )


def bot_send(chat_id: str, text: str) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not token or not ID_PATTERN.fullmatch(str(chat_id)):
        return False
    data = json.dumps({
        "chat_id": chat_id, "text": text, "disable_web_page_preview": True
    }).encode("utf-8")
    req = http_request.Request(
        "https://api.telegram.org/bot" + token + "/sendMessage",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with http_request.urlopen(req, timeout=8) as reply:
            return json.load(reply).get("ok") is True
    except (HTTPError, URLError, OSError, ValueError):
        return False


class GoogleExchange(BaseModel):
    credential: str = Field(min_length=100, max_length=6000)


class TelegramStart(BaseModel):
    mode: str = Field(pattern=r"^(login|link)$")
    timeZone: str = Field(min_length=1, max_length=100)


class TelegramStatus(BaseModel):
    requestId: str = Field(min_length=24, max_length=64)


def register_routes(app, database, auth_context, google_uid):
    @app.get("/api/auth/config")
    def auth_config():
        return {"telegram": telegram_enabled()}

    @app.post("/api/auth/google-session")
    def exchange_google(body: GoogleExchange):
        uid = google_uid(body.credential)
        with database() as db:
            token = create_session(db, "google", uid)
            db.commit()
        return {"token": token, "uid": uid, "provider": "google"}

    @app.get("/api/auth/me")
    def auth_me(authorization: str | None = Header(default=None)):
        uid, provider = auth_context(authorization)
        with database() as db:
            row = db.execute(
                "SELECT notifications_enabled FROM telegram_accounts WHERE uid=? LIMIT 1", (uid,)
            ).fetchone()
        return {
            "uid": uid,
            "provider": provider,
            "telegramLinked": row is not None,
            "telegramNotifications": bool(row and row[0]),
        }

    @app.post("/api/auth/logout")
    def auth_logout(authorization: str | None = Header(default=None)):
        # Revoke only Planner sessions, not the original Google ID token.
        if authorization and authorization.startswith("Bearer pln_"):
            token = authorization[7:]
            with database() as db:
                db.execute("DELETE FROM auth_sessions WHERE secret_hash=?", (digest(token),))
                db.commit()
        return {"ok": True}

    @app.post("/api/telegram/start")
    def start_telegram(body: TelegramStart, authorization: str | None = Header(default=None)):
        if not telegram_enabled():
            raise HTTPException(503, "Telegram bot is not configured")
        try:
            ZoneInfo(body.timeZone)
        except (ZoneInfoNotFoundError, ValueError):
            raise HTTPException(422, "Invalid time zone")
        target_uid = None
        if body.mode == "link":
            uid, provider = auth_context(authorization)
            if provider != "google":
                raise HTTPException(403, "Link Telegram while signed in with Google")
            target_uid = uid
        request_code = secrets.token_urlsafe(24)  # fits Telegram's 64-char start payload
        poll_code = secrets.token_urlsafe(32)
        expires = int(time.time()) + CHALLENGE_TTL
        with database() as db:
            # Bounded cleanup of old challenges; completed sessions are kept separately.
            db.execute("DELETE FROM telegram_login_requests WHERE expires_at < ?", (int(time.time()),))
            db.execute("""INSERT INTO telegram_login_requests
                (request_hash,poll_hash,mode,target_uid,time_zone,expires_at)
                VALUES(?,?,?,?,?,?)""", (
                    digest(request_code), digest(poll_code), body.mode, target_uid,
                    body.timeZone, expires
                ))
            db.commit()
        username = os.environ["TELEGRAM_BOT_USERNAME"].lstrip("@")
        return {
            "url": "https://t.me/" + username + "?start=pl_" + request_code,
            "requestId": poll_code,
            "expiresIn": CHALLENGE_TTL,
        }

    @app.post("/api/telegram/status")
    def telegram_status(body: TelegramStatus):
        if not CHALLENGE_PATTERN.fullmatch(body.requestId):
            raise HTTPException(400, "Invalid confirmation")
        with database() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("""SELECT mode,tg_id,expires_at,completed,consumed
                FROM telegram_login_requests WHERE poll_hash=?""", (digest(body.requestId),)).fetchone()
            if row is None or row[2] < int(time.time()):
                raise HTTPException(410, "Login confirmation expired")
            mode, tg_id, _, completed, consumed = row
            if not completed:
                return {"status": "pending"}
            if consumed:
                raise HTTPException(410, "Login confirmation already used")
            db.execute("UPDATE telegram_login_requests SET consumed=1 WHERE poll_hash=?", (digest(body.requestId),))
            if mode == "login":
                token = create_session(db, "telegram", tg_id)
                db.commit()
                return {"status": "authenticated", "token": token}
            db.commit()
            return {"status": "linked"}

    @app.post("/api/telegram/webhook")
    async def telegram_webhook(
        request: Request, x_telegram_bot_api_secret_token: str | None = Header(default=None)
    ):
        secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET", "")
        if not telegram_enabled() or not secret or not hmac.compare_digest(
            (x_telegram_bot_api_secret_token or ""), secret
        ):
            raise HTTPException(403, "Invalid Telegram webhook")
        if int(request.headers.get("content-length", "0") or "0") > 8192:
            raise HTTPException(413, "Update too large")
        update = await request.json()
        if not isinstance(update, dict):
            return {"ok": True}
        message = update.get("message") or {}
        if not isinstance(message, dict):
            return {"ok": True}
        chat = message.get("chat") or {}
        sender = message.get("from") or {}
        if not isinstance(chat, dict) or not isinstance(sender, dict):
            return {"ok": True}
        # Only a real user's direct chat with the bot, never groups or channels.
        tg_id, chat_id = str(sender.get("id", "")), str(chat.get("id", ""))
        if chat.get("type") != "private" or tg_id != chat_id or not ID_PATTERN.fullmatch(tg_id):
            return {"ok": True}
        text = str(message.get("text", ""))
        if text.startswith("/stop"):
            with database() as db:
                db.execute(
                    "UPDATE telegram_accounts SET notifications_enabled=0 WHERE tg_id=?",
                    (tg_id,)
                )
                db.commit()
            bot_send(chat_id, "🔕 Напоминания Планера в Telegram отключены. Чтобы включить снова, отправьте /start.")
            return {"ok": True}
        if text.strip() in ("/start", "/help"):
            if text.strip() == "/start":
                with database() as db:
                    db.execute(
                        "UPDATE telegram_accounts SET notifications_enabled=1 WHERE tg_id=?",
                        (tg_id,)
                    )
                    db.commit()
            bot_send(chat_id, "🌙 Планер: для входа откройте planer.fizmat-course.com и нажмите «Войти через Telegram». Для отключения сообщений отправьте /stop.")
            return {"ok": True}
        match = re.fullmatch(r"/start(?:@[A-Za-z0-9_]+)? pl_([A-Za-z0-9_-]{24,64})", text.strip())
        if not match:
            return {"ok": True}
        code_hash = digest(match.group(1))
        reply = None
        with database() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("""SELECT mode,target_uid,time_zone,expires_at,completed
                FROM telegram_login_requests WHERE request_hash=?""", (code_hash,)).fetchone()
            if row is None or row[3] < int(time.time()) or row[4]:
                reply = "⏱ Ссылка для входа устарела. Создайте новую в «Планере»."
            else:
                mode, target_uid, time_zone, _, _ = row
                account = db.execute("SELECT uid FROM telegram_accounts WHERE tg_id=?", (tg_id,)).fetchone()
                if mode == "link":
                    if account and account[0] != target_uid and not account[0].startswith("tg:"):
                        reply = "Этот Telegram уже привязан к другому аккаунту «Планера». Для безопасности подключение отклонено."
                    else:
                        if account and account[0] != target_uid:
                            # Preserve Telegram-only tasks when linking to existing Google tasks.
                            db.execute("INSERT OR IGNORE INTO users(uid) VALUES(?)", (target_uid,))
                            changed = db.execute("""INSERT OR IGNORE INTO tasks(uid,id,payload)
                                SELECT ?,id,payload FROM tasks WHERE uid=?""",
                                (target_uid, account[0])).rowcount
                            if changed:
                                db.execute("UPDATE users SET version=version+1 WHERE uid=?", (target_uid,))
                        db.execute("""INSERT INTO telegram_accounts
                            (tg_id,uid,chat_id,time_zone,notifications_enabled)
                            VALUES(?,?,?,?,1)
                            ON CONFLICT(tg_id) DO UPDATE SET
                            uid=excluded.uid,chat_id=excluded.chat_id,
                            time_zone=excluded.time_zone,notifications_enabled=1""",
                            (tg_id, target_uid, chat_id, time_zone))
                        db.execute("UPDATE telegram_login_requests SET tg_id=?,completed=1 WHERE request_hash=?", (tg_id,code_hash))
                        reply = "✅ Telegram привязан к вашему Google-аккаунту «Планера». Напоминания будут приходить в этот чат. Для отключения: /stop."
                else:
                    uid = account[0] if account else "tg:" + tg_id
                    db.execute("""INSERT INTO telegram_accounts
                        (tg_id,uid,chat_id,time_zone,notifications_enabled)
                        VALUES(?,?,?,?,1)
                        ON CONFLICT(tg_id) DO UPDATE SET
                        chat_id=excluded.chat_id,time_zone=excluded.time_zone,notifications_enabled=1""",
                        (tg_id, uid, chat_id, time_zone))
                    db.execute("UPDATE telegram_login_requests SET tg_id=?,completed=1 WHERE request_hash=?", (tg_id, code_hash))
                    reply = "✅ Вход в «Планер» подтверждён. Вернитесь на сайт — задачи загрузятся автоматически. Напоминания включены. Отключить: /stop."
            db.commit()
        if reply:
            bot_send(chat_id, reply)
        return {"ok": True}
