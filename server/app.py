"""Small isolated Planer API. Run behind HTTPS Nginx on 127.0.0.1:3001."""
import os
import sqlite3
import threading
import hashlib
import json
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel, Field, field_validator, model_validator
from typing import Literal
from server.telegram_auth import init_tables, lookup_session, register_routes
from server.quran_pages import fetch_quran_page

DB_PATH = Path(os.environ.get("PLANER_DB", "/opt/planer-api/data/planer.sqlite3"))
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
_lock = threading.RLock()
app = FastAPI(title="Planer Sync API", docs_url=None, redoc_url=None, openapi_url=None)

class QuranBookmark(BaseModel):
    session: int = Field(ge=0, lt=150)
    page: int = Field(ge=1, le=604)


class QuranReadingState(BaseModel):
    pace: Literal[6, 10, 12, 15, 30]
    startDate: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    completedSessions: list[int] = Field(default_factory=list, max_length=150)
    pageProgress: dict[str, int] = Field(default_factory=dict, max_length=150)
    bookmark: QuranBookmark | None = None

    @field_validator("startDate")
    @classmethod
    def validate_start_date(cls, value: str) -> str:
        if datetime.strptime(value, "%Y-%m-%d").strftime("%Y-%m-%d") != value:
            raise ValueError("Invalid date")
        return value

    @field_validator("completedSessions")
    @classmethod
    def validate_sessions(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values) or any(not 0 <= value < 150 for value in values):
            raise ValueError("Invalid or repeated reading session")
        return sorted(values)

    @model_validator(mode="after")
    def validate_page_progress(self):
        pages_per_session = 600 // (self.pace * 5)

        def bounds(session: int) -> tuple[int, int]:
            day_in_cycle = (session // 5) % self.pace
            prayer = session % 5
            first = (day_in_cycle * 5 + prayer) * pages_per_session + 1
            last = first + pages_per_session - 1
            if day_in_cycle == self.pace - 1 and prayer == 4:
                last += 4
            return first, last

        for key, count in self.pageProgress.items():
            if (not key.isdecimal() or str(int(key)) != key
                    or not 0 <= int(key) < 150):
                raise ValueError("Invalid Quran session index")
            first, last = bounds(int(key))
            if count < 0 or count > last - first + 1:
                raise ValueError("Quran page progress is out of bounds")

        if self.bookmark:
            first, last = bounds(self.bookmark.session)
            if not first <= self.bookmark.page <= last:
                raise ValueError("Bookmark must be inside its reading session")
        return self


class Task(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=500)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str = Field(max_length=5)  # task start, retained for older clients and reminders
    endTime: str = Field(default="", pattern=r"^$|^(?:[01]\d|2[0-3]):[0-5]\d$")
    priority: str = Field(pattern="^(low|medium|high)$")
    category: str = Field(max_length=100)
    completed: bool
    createdAt: int
    reminderMinutes: int = Field(default=30, ge=-1, le=1440)
    repeatReminder: bool = False
    subgoals: list[str] = Field(default_factory=list, max_length=30)
    quranReading: QuranReadingState | None = None

class ImportRequest(BaseModel):
    tasks: list[Task] = Field(max_length=3000)

class ChangeRequest(BaseModel):
    task: Task
    baseVersion: int = Field(ge=0)

class DeleteRequest(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    baseVersion: int = Field(ge=0)

class DeleteBatchRequest(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=3000)
    baseVersion: int = Field(ge=0)

@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(DB_PATH), timeout=10)
    try:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0)")
        db.execute("CREATE TABLE IF NOT EXISTS tasks (uid TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(uid,id))")
        db.execute("""CREATE TABLE IF NOT EXISTS push_subscriptions
          (endpoint_id TEXT PRIMARY KEY, uid TEXT NOT NULL, subscription_json TEXT NOT NULL,
           time_zone TEXT NOT NULL)""")
        db.execute("""CREATE TABLE IF NOT EXISTS sent_reminders
          (endpoint_id TEXT NOT NULL, task_id TEXT NOT NULL, task_date TEXT NOT NULL,
           task_time TEXT NOT NULL, PRIMARY KEY(endpoint_id,task_id,task_date,task_time))""")
        db.execute("""CREATE TABLE IF NOT EXISTS sent_repeat_reminders
          (endpoint_id TEXT NOT NULL, task_id TEXT NOT NULL, task_date TEXT NOT NULL,
           task_time TEXT NOT NULL, step INTEGER NOT NULL,
           PRIMARY KEY(endpoint_id,task_id,task_date,task_time,step))""")
        init_tables(db)
        db.commit()
        yield db
    finally:
        db.close()

def google_uid(credential: str) -> str:
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google authentication is not configured")
    try:
        claims = id_token.verify_oauth2_token(
            credential, google_requests.Request(), GOOGLE_CLIENT_ID,
            clock_skew_in_seconds=30
        )
        if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
            raise ValueError("Invalid issuer")
        return str(claims["sub"])
    except Exception:
        raise HTTPException(401, "Google login expired. Please sign in again")


def auth_context(authorization: str | None) -> tuple[str, str]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Sign in required")
    token = authorization[7:]
    if token.startswith("pln_"):
        with database() as db:
            session = lookup_session(db, token)
        if session is None:
            raise HTTPException(401, "Planner session expired. Please sign in again")
        return session
    # Backward compatibility for installed clients still using Google ID tokens.
    return google_uid(token), "google"


def user(authorization: str | None):
    return auth_context(authorization)[0]


def snapshot(db, uid):
    import json
    version = db.execute("SELECT version FROM users WHERE uid=?", (uid,)).fetchone()
    rows = db.execute("SELECT payload FROM tasks WHERE uid=? ORDER BY id", (uid,)).fetchall()
    return {"version": version[0] if version else 0, "tasks": [json.loads(row[0]) for row in rows]}

@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/quran/page/{page_number}")
def quran_page(page_number: int):
    """Read authentic Quran pages inside Planner without external navigation."""
    if not 1 <= page_number <= 604:
        raise HTTPException(status_code=422, detail="Page must be between 1 and 604")
    try:
        return fetch_quran_page(page_number)
    except (ConnectionError, ValueError):
        raise HTTPException(status_code=503, detail="Quran text is temporarily unavailable")


@app.get("/api/tasks")
def tasks(authorization: str | None = Header(default=None)):
    uid = user(authorization)
    with _lock, database() as db:
        return snapshot(db, uid)

@app.post("/api/import")
def import_tasks(body: ImportRequest, authorization: str | None = Header(default=None)):
    """Add missing IDs, never overwrite tasks already stored in the account."""
    import json
    uid = user(authorization)
    with _lock, database() as db:
        db.execute("INSERT OR IGNORE INTO users(uid) VALUES(?)", (uid,))
        changed = 0
        for task in body.tasks:
            try:
                datetime.strptime(task.date, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(422, "Invalid task date")
            cursor = db.execute("INSERT OR IGNORE INTO tasks(uid,id,payload) VALUES(?,?,?)",
                                (uid,task.id,json.dumps(task.model_dump(),ensure_ascii=False)))
            changed += cursor.rowcount
        if changed:
            db.execute("UPDATE users SET version=version+1 WHERE uid=?", (uid,))
        db.commit()
        return snapshot(db, uid)

@app.put("/api/task")
def save_task(body: ChangeRequest, authorization: str | None = Header(default=None)):
    import json
    uid = user(authorization)
    with _lock, database() as db:
        db.execute("INSERT OR IGNORE INTO users(uid) VALUES(?)", (uid,))
        version = snapshot_version(db, uid)
        if version != body.baseVersion:
            raise HTTPException(409, "Cloud version changed. Refresh before editing.")
        db.execute("INSERT OR REPLACE INTO tasks(uid,id,payload) VALUES(?,?,?)",
                   (uid,body.task.id,json.dumps(body.task.model_dump(),ensure_ascii=False)))
        db.execute("UPDATE users SET version=version+1 WHERE uid=?", (uid,))
        db.commit()
        return snapshot(db, uid)

def snapshot_version(db, uid):
    return db.execute("SELECT version FROM users WHERE uid=?", (uid,)).fetchone()[0]

@app.post("/api/delete")
def delete_task(body: DeleteRequest, authorization: str | None = Header(default=None)):
    uid = user(authorization)
    with _lock, database() as db:
        db.execute("INSERT OR IGNORE INTO users(uid) VALUES(?)", (uid,))
        if snapshot_version(db, uid) != body.baseVersion:
            raise HTTPException(409, "Cloud version changed. Refresh before deleting.")
        db.execute("DELETE FROM tasks WHERE uid=? AND id=?", (uid,body.id))
        db.execute("UPDATE users SET version=version+1 WHERE uid=?", (uid,))
        db.commit()
        return snapshot(db, uid)

@app.post("/api/delete-batch")
def delete_tasks_batch(body: DeleteBatchRequest, authorization: str | None = Header(default=None)):
    """Atomically delete selected IDs belonging to the authenticated user only.

    Version check prevents an outdated device from wiping newly changed data.
    Other user accounts and all IDs not explicitly supplied remain untouched.
    """
    if any(not isinstance(task_id, str) or not 1 <= len(task_id) <= 100 for task_id in body.ids):
        raise HTTPException(422, "Invalid task ID")
    uid = user(authorization)
    with _lock, database() as db:
        db.execute("INSERT OR IGNORE INTO users(uid) VALUES(?)", (uid,))
        if snapshot_version(db, uid) != body.baseVersion:
            raise HTTPException(409, "Cloud version changed. Refresh before deleting.")
        unique_ids = sorted(set(body.ids))
        changed = 0
        for task_id in unique_ids:
            changed += db.execute(
                "DELETE FROM tasks WHERE uid=? AND id=?", (uid, task_id)
            ).rowcount
        if changed:
            db.execute("UPDATE users SET version=version+1 WHERE uid=?", (uid,))
        db.commit()
        return snapshot(db, uid)

# Notifications are opt-in and bound to verified Google identities.
# Push URLs and encryption keys are never returned in task snapshots.
class PushKeys(BaseModel):
    p256dh: str = Field(min_length=30, max_length=300)
    auth: str = Field(min_length=10, max_length=150)

class PushInfo(BaseModel):
    endpoint: str = Field(min_length=20, max_length=2048)
    keys: PushKeys

class PushRegister(BaseModel):
    subscription: PushInfo
    timeZone: str = Field(min_length=1, max_length=100)

class PushRemove(BaseModel):
    endpoint: str = Field(min_length=20, max_length=2048)

# Only browser push-provider endpoints; never POST to arbitrary user-supplied URLs.
_PUSH_PROVIDERS = (
    "push.apple.com", "fcm.googleapis.com", "fcm-xm.googleapis.com",
    "push.services.mozilla.com", "notify.windows.com", "wns.windows.com",
)

def validated_push_endpoint(value: str) -> str:
    url = urlparse(value)
    host = (url.hostname or "").lower()
    if url.scheme != "https" or url.username or url.password or url.port not in (None, 443):
        raise HTTPException(422, "Invalid push endpoint")
    if not any(host == domain or host.endswith("." + domain) for domain in _PUSH_PROVIDERS):
        raise HTTPException(422, "Unsupported push provider")
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

@app.get("/api/push/public-key")
def push_public_key():
    key = os.environ.get("PUSH_PUBLIC_KEY", "")
    if not key:
        raise HTTPException(503, "Push notifications are not configured")
    return {"publicKey": key}

@app.post("/api/push/subscribe")
def subscribe_push(body: PushRegister, authorization: str | None = Header(default=None)):
    uid = user(authorization)
    if not os.environ.get("PUSH_PUBLIC_KEY"):
        raise HTTPException(503, "Push notifications are not configured")
    endpoint_id = validated_push_endpoint(body.subscription.endpoint)
    try:
        ZoneInfo(body.timeZone)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "Invalid time zone")
    with _lock, database() as db:
        db.execute("""INSERT INTO push_subscriptions
          (endpoint_id, uid, subscription_json, time_zone) VALUES(?,?,?,?)
          ON CONFLICT(endpoint_id) DO UPDATE SET uid=excluded.uid,
          subscription_json=excluded.subscription_json,time_zone=excluded.time_zone""",
          (endpoint_id, uid, body.subscription.model_dump_json(), body.timeZone))
        db.commit()
    return {"ok": True}

@app.post("/api/push/unsubscribe")
def unsubscribe_push(body: PushRemove, authorization: str | None = Header(default=None)):
    uid = user(authorization)
    endpoint_id = validated_push_endpoint(body.endpoint)
    with _lock, database() as db:
        db.execute("DELETE FROM push_subscriptions WHERE endpoint_id=? AND uid=?", (endpoint_id, uid))
        db.commit()
    return {"ok": True}


# New sessions and Telegram routes coexist with existing Google task endpoints.
register_routes(app, database, auth_context, google_uid)
