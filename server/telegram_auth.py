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
from server.telegram_membership import configured_groups, membership_status, verification_keyboard, answer_callback

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
    # Old Telegram bindings remain intact; existing users verify group membership once.
    columns = {row[1] for row in db.execute("PRAGMA table_info(telegram_accounts)").fetchall()}
    if "verified_group_id" not in columns:
        db.execute("ALTER TABLE telegram_accounts ADD COLUMN verified_group_id TEXT")
    if "verified_at" not in columns:
        db.execute("ALTER TABLE telegram_accounts ADD COLUMN verified_at INTEGER")
    # v2 is issued ONLY after a user presses 'Check subscriptions' and BOTH
    # communities return live Telegram membership. Legacy receipts aren't proof.
    if "membership_verified_set" not in columns:
        db.execute("ALTER TABLE telegram_accounts ADD COLUMN membership_verified_set TEXT NOT NULL DEFAULT ''")
    if "membership_verified_at" not in columns:
        db.execute("ALTER TABLE telegram_accounts ADD COLUMN membership_verified_at INTEGER NOT NULL DEFAULT 0")
    db.execute("CREATE INDEX IF NOT EXISTS idx_telegram_accounts_uid ON telegram_accounts(uid)")
    db.execute("""CREATE TABLE IF NOT EXISTS telegram_verified_communities (
        tg_id TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        verified_at INTEGER NOT NULL,
        PRIMARY KEY(tg_id, chat_id)
    )""")
    # Preserve receipts from the previous single-group version if it ran.
    db.execute("""INSERT OR IGNORE INTO telegram_verified_communities(tg_id,chat_id,verified_at)
        SELECT tg_id,verified_group_id,COALESCE(verified_at,0)
        FROM telegram_accounts WHERE verified_group_id IS NOT NULL""")
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
    request_columns = {row[1] for row in db.execute("PRAGMA table_info(telegram_login_requests)").fetchall()}
    if "membership_required" not in request_columns:
        db.execute("ALTER TABLE telegram_login_requests ADD COLUMN membership_required INTEGER NOT NULL DEFAULT 0")
    db.execute("""CREATE TABLE IF NOT EXISTS sent_telegram_reminders (
        tg_id TEXT NOT NULL, task_id TEXT NOT NULL,
        task_date TEXT NOT NULL, task_time TEXT NOT NULL, step INTEGER NOT NULL,
        PRIMARY KEY(tg_id, task_id, task_date, task_time, step)
    )""")


def required_community_key() -> str:
    """Stable exact set of communities, independent of configuration order."""
    return ",".join(sorted(group["id"] for group in configured_groups()))


def membership_already_confirmed(db, tg_id: str) -> bool:
    """Only v2 explicit-confirmation receipts can bypass later join prompts."""
    key = required_community_key()
    if not key:
        return False
    row = db.execute(
        """SELECT membership_verified_set,membership_verified_at
        FROM telegram_accounts WHERE tg_id=?""", (tg_id,)
    ).fetchone()
    return bool(row and row[0] == key and row[1] > 0)


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
        if mapped is not None and membership_already_confirmed(db, subject):
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


def bot_send(chat_id: str, text: str, *, parse_mode: str | None = None,
             reply_markup: dict | None = None) -> bool:
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    if not token or not ID_PATTERN.fullmatch(str(chat_id)):
        return False
    payload = {"chat_id": chat_id, "text": text, "disable_web_page_preview": True}
    if parse_mode == "HTML":
        payload["parse_mode"] = "HTML"
    if reply_markup is not None:
        payload["reply_markup"] = reply_markup
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
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
        return {
            "telegram": telegram_enabled() and bool(configured_groups()),
            "botUrl": "https://t.me/" + os.environ.get("TELEGRAM_BOT_USERNAME", "").lstrip("@") if telegram_enabled() else None,
            "groupUrl": configured_groups()[0]["url"] if configured_groups() else None,
            "groups": [{"title": c["title"], "url": c["url"]} for c in configured_groups()],
        }

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
        if not telegram_enabled() or not configured_groups():
            raise HTTPException(503, "Telegram group setup is not complete")
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
            row = db.execute("""SELECT mode,tg_id,expires_at,completed,consumed,membership_required
                FROM telegram_login_requests WHERE poll_hash=?""", (digest(body.requestId),)).fetchone()
            if row is None or row[2] < int(time.time()):
                raise HTTPException(410, "Login confirmation expired")
            mode, tg_id, _, completed, consumed, membership_required = row
            if not completed:
                return {"status": "pending", "joinRequired": bool(membership_required)}
            if consumed:
                raise HTTPException(410, "Login confirmation already used")
            db.execute("UPDATE telegram_login_requests SET consumed=1 WHERE poll_hash=?", (digest(body.requestId),))
            if mode == "login":
                token = create_session(db, "telegram", tg_id)
                db.commit()
                return {"status": "authenticated", "token": token}
            db.commit()
            return {"status": "linked"}


    def confirm_group_and_login(tg_id: str, chat_id: str, request_code: str,
                                *, check_pressed: bool = False):
        """Gate first-time access on an explicit button + two LIVE Telegram checks.

        Previous versions could auto-confirm on /start or trust cached group receipts.
        This v2 proof is set only when both current memberships have been checked.
        On future logins, that proof is re-used as the user requested.
        """
        groups = configured_groups()
        if not groups:
            return "error", "Сообщества Планера пока не настроены.", []
        code_hash = digest(request_code)
        with database() as db:
            row = db.execute("""SELECT mode,target_uid,time_zone,expires_at,completed
                FROM telegram_login_requests WHERE request_hash=?""", (code_hash,)).fetchone()
            previously_confirmed = membership_already_confirmed(db, tg_id)
        if row is None or row[3] < int(time.time()) or row[4]:
            return "error", "⏱ Ссылка для входа устарела. Создайте новую в «Планере».", []

        if not previously_confirmed and not check_pressed:
            # A /start command NEVER grants first-time access by itself.
            with database() as db:
                db.execute("""UPDATE telegram_login_requests
                    SET membership_required=1 WHERE request_hash=? AND completed=0""",
                    (code_hash,))
                db.commit()
            return ("join", "🌙 Добро пожаловать в «Планер»!\n\n"
                    "Для первого входа подпишитесь на оба сообщества:\n"
                    "📚 ФИЗМАТ\n"
                    "📈 Мир инвестиций\n\n"
                    "После подписки нажмите «✅ Проверить подписки». "
                    "Повторная проверка при следующих входах не понадобится.",
                    [g["id"] for g in groups])

        if not previously_confirmed:
            missing = []
            unavailable = []
            for group in groups:
                status = membership_status(tg_id, group["id"])
                if status is False:
                    missing.append(group["id"])
                elif status is not True:
                    unavailable.append(group["id"])
            if missing or unavailable:
                with database() as db:
                    db.execute("""UPDATE telegram_login_requests
                        SET membership_required=1 WHERE request_hash=? AND completed=0""",
                        (code_hash,))
                    db.commit()
                if unavailable:
                    return ("error", "⚠️ Не удалось проверить подписки Telegram. "
                            "Попробуйте снова, убедившись, что бот — администратор "
                            "обоих сообществ.", missing + unavailable)
                names = [g["title"] for g in groups if g["id"] in missing]
                return ("join", "🔒 Вход пока закрыт.\n\n"
                        "Вы ещё не подписаны на: " + ", ".join(names)
                        + ".\n\nПодпишитесь и снова нажмите «✅ Проверить подписки».",
                        missing)

        with database() as db:
            db.execute("BEGIN IMMEDIATE")
            latest = db.execute("""SELECT mode,target_uid,time_zone,expires_at,completed
                FROM telegram_login_requests WHERE request_hash=?""", (code_hash,)).fetchone()
            if latest is None or latest[3] < int(time.time()) or latest[4]:
                return "error", "⏱ Ссылка для входа устарела. Создайте новую.", []
            mode, target_uid, time_zone, _, _ = latest
            existing = db.execute("SELECT uid FROM telegram_accounts WHERE tg_id=?", (tg_id,)).fetchone()
            if mode == "link":
                if existing and existing[0] != target_uid and not existing[0].startswith("tg:"):
                    return "error", "Этот Telegram уже привязан к другому аккаунту «Планера».", []
                if existing and existing[0] != target_uid:
                    db.execute("INSERT OR IGNORE INTO users(uid) VALUES(?)", (target_uid,))
                    changed = db.execute("""INSERT OR IGNORE INTO tasks(uid,id,payload)
                        SELECT ?,id,payload FROM tasks WHERE uid=?""",
                        (target_uid, existing[0])).rowcount
                    if changed:
                        db.execute("UPDATE users SET version=version+1 WHERE uid=?", (target_uid,))
                uid = target_uid
                message = ("✅ Telegram привязан к вашему аккаунту «Планера». "
                           "Обе подписки подтверждены. Повторять проверку не нужно. "
                           "Напоминания будут приходить сюда. Отключить: /stop.")
            else:
                uid = existing[0] if existing else "tg:" + tg_id
                message = ("✅ Вход в «Планер» подтверждён!\n"
                           "Подписки на «ФИЗМАТ» и «Мир инвестиций» подтверждены.\n"
                           "Вернитесь на сайт — ваши задачи загрузятся автоматически. "
                           "При следующих входах повторная проверка не нужна.")
            db.execute("""INSERT INTO telegram_accounts
                (tg_id,uid,chat_id,time_zone,notifications_enabled,
                 membership_verified_set,membership_verified_at)
                VALUES(?,?,?,?,1,?,?)
                ON CONFLICT(tg_id) DO UPDATE SET
                uid=excluded.uid,chat_id=excluded.chat_id,
                time_zone=excluded.time_zone,notifications_enabled=1,
                membership_verified_set=excluded.membership_verified_set,
                membership_verified_at=excluded.membership_verified_at""",
                (tg_id, uid, chat_id, time_zone, required_community_key(), int(time.time())))
            if not previously_confirmed:
                # Legacy per-community records are informational only, never a gate.
                for group in groups:
                    db.execute("""INSERT OR REPLACE INTO telegram_verified_communities
                        (tg_id,chat_id,verified_at) VALUES(?,?,?)""",
                        (tg_id, group["id"], int(time.time())))
            db.execute("""UPDATE telegram_login_requests
                SET tg_id=?,completed=1 WHERE request_hash=?""", (tg_id, code_hash))
            db.commit()
        return "ok", message, []

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

        callback = update.get("callback_query")
        if isinstance(callback, dict):
            sender = callback.get("from") or {}
            original = callback.get("message") or {}
            chat = original.get("chat") or {}
            tg_id = str(sender.get("id", "")) if isinstance(sender, dict) else ""
            chat_id = str(chat.get("id", "")) if isinstance(chat, dict) else ""
            cb_data = str(callback.get("data", ""))
            if (isinstance(chat, dict) and chat.get("type") == "private"
                    and tg_id == chat_id and ID_PATTERN.fullmatch(tg_id)
                    and re.fullmatch(r"verify_[A-Za-z0-9_-]{24,64}", cb_data)):
                result, response, missing = confirm_group_and_login(
                    tg_id, chat_id, cb_data[7:], check_pressed=True
                )
                answer_callback(str(callback.get("id", "")), "Проверка завершена" if result == "ok" else "Проверьте сообщение")
                markup = verification_keyboard(cb_data[7:], missing) if result == "join" else None
                bot_send(chat_id, response, reply_markup=markup)
            return {"ok": True}

        message = update.get("message") or {}
        if not isinstance(message, dict):
            return {"ok": True}
        chat = message.get("chat") or {}
        sender = message.get("from") or {}
        if not isinstance(chat, dict) or not isinstance(sender, dict):
            return {"ok": True}
        tg_id, chat_id = str(sender.get("id", "")), str(chat.get("id", ""))
        if chat.get("type") != "private" or tg_id != chat_id or not ID_PATTERN.fullmatch(tg_id):
            return {"ok": True}
        text = str(message.get("text", "")).strip()
        if text == "/stop":
            with database() as db:
                db.execute("UPDATE telegram_accounts SET notifications_enabled=0 WHERE tg_id=?", (tg_id,))
                db.commit()
            bot_send(chat_id, "🔕 Напоминания в Telegram отключены. Включить снова: /start.")
            return {"ok": True}
        if text in ("/start", "/help"):
            if text == "/start":
                with database() as db:
                    db.execute("UPDATE telegram_accounts SET notifications_enabled=1 WHERE tg_id=?", (tg_id,))
                    db.commit()
            bot_send(chat_id, "🌙 Откройте planer.fizmat-course.com и нажмите «Войти через Telegram». Новым пользователям потребуется подписаться на оба сообщества только один раз. Отключить напоминания: /stop.")
            return {"ok": True}

        match = re.fullmatch(r"/start(?:@[A-Za-z0-9_]+)? pl_([A-Za-z0-9_-]{24,64})", text)
        if match:
            code = match.group(1)
            result, response, missing = confirm_group_and_login(tg_id, chat_id, code)
            markup = verification_keyboard(code, missing) if result == "join" else None
            bot_send(chat_id, response, reply_markup=markup)
        return {"ok": True}
