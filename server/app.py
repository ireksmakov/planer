"""Small isolated Planer API. Run behind HTTPS Nginx on 127.0.0.1:3001."""
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from pydantic import BaseModel, Field

DB_PATH = Path(os.environ.get("PLANER_DB", "/opt/planer-api/data/planer.sqlite3"))
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
_lock = threading.RLock()
app = FastAPI(title="Planer Sync API", docs_url=None, redoc_url=None, openapi_url=None)

class Task(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=500)
    date: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    time: str = Field(max_length=5)
    priority: str = Field(pattern="^(low|medium|high)$")
    category: str = Field(max_length=100)
    completed: bool
    createdAt: int

class ImportRequest(BaseModel):
    tasks: list[Task] = Field(max_length=3000)

class ChangeRequest(BaseModel):
    task: Task
    baseVersion: int = Field(ge=0)

class DeleteRequest(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    baseVersion: int = Field(ge=0)

@contextmanager
def database():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(str(DB_PATH), timeout=10)
    try:
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0)")
        db.execute("CREATE TABLE IF NOT EXISTS tasks (uid TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(uid,id))")
        db.commit()
        yield db
    finally:
        db.close()

def user(authorization: str | None):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(503, "Google authentication is not configured")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Google login required")
    try:
        claims = id_token.verify_oauth2_token(
            authorization[7:], google_requests.Request(), GOOGLE_CLIENT_ID, clock_skew_in_seconds=30
        )
        if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
            raise ValueError("Invalid issuer")
        return str(claims["sub"])
    except Exception:
        raise HTTPException(401, "Invalid or expired Google token")

def snapshot(db, uid):
    import json
    version = db.execute("SELECT version FROM users WHERE uid=?", (uid,)).fetchone()
    rows = db.execute("SELECT payload FROM tasks WHERE uid=? ORDER BY id", (uid,)).fetchall()
    return {"version": version[0] if version else 0, "tasks": [json.loads(row[0]) for row in rows]}

@app.get("/api/health")
def health():
    return {"ok": True}

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
