"""Run once per minute via systemd timer. Sends due, unfinished task reminders.

The timer is a separate service, never modifying the existing trading bot.
Each subscription belongs to one verified Google account and one device.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from pywebpush import WebPushException, webpush

from server.app import database
from server.telegram_auth import bot_send

def due_reminder_stage(task, local_now):
    """Return 0 (at due time), 2, 4, or None; allow up to a minute for timer drift.

    This keeps default reminders unchanged and only repeats when explicitly enabled.
    """
    if task.get("completed"):
        return None
    scheduled = str(task.get("date", "")) + " " + str(task.get("time", ""))
    repeat = task.get("repeatReminder") is True
    for step in (0, 2, 4):
        if step and not repeat:
            continue
        for delay in (0, 1):
            timestamp = local_now - timedelta(minutes=step + delay)
            if scheduled == timestamp.strftime("%Y-%m-%d %H:%M"):
                return step
    return None


def send_telegram_reminders(db, now):
    """Send due tasks to linked personal Telegram chats, respecting /stop and deduplication."""
    sent = 0
    accounts = db.execute("""SELECT tg_id,uid,chat_id,time_zone FROM telegram_accounts
        WHERE notifications_enabled=1""").fetchall()
    for tg_id, uid, chat_id, time_zone in accounts:
        try:
            local_time = now.astimezone(ZoneInfo(time_zone))
        except Exception:
            continue
        tasks = db.execute("SELECT id,payload FROM tasks WHERE uid=?", (uid,)).fetchall()
        for task_id, raw in tasks:
            try:
                task = json.loads(raw)
                stage = due_reminder_stage(task, local_time)
                if stage is None:
                    continue
                task_date, task_time = task["date"], task["time"]
                created = db.execute("""INSERT OR IGNORE INTO sent_telegram_reminders
                    (tg_id,task_id,task_date,task_time,step) VALUES(?,?,?,?,?)""",
                    (tg_id,task_id,task_date,task_time,stage)).rowcount
                if not created:
                    continue
                db.commit()
                header = "⏰ Напоминание" if stage == 0 else (
                    "🔔 Повтор 1/2" if stage == 2 else "🔔 Повтор 2/2"
                )
                body = header + "\\n" + str(task["title"])[:350] + "\\nВремя: " + task_time
                # No links, account IDs, or chat names in the message.
                if bot_send(chat_id, body):
                    sent += 1
                else:
                    db.execute("""DELETE FROM sent_telegram_reminders
                        WHERE tg_id=? AND task_id=? AND task_date=? AND task_time=? AND step=?""",
                        (tg_id,task_id,task_date,task_time,stage))
                    db.commit()
                    print("Telegram reminder could not be delivered", file=sys.stderr)
            except (KeyError, ValueError, TypeError):
                continue
    cutoff = (now - timedelta(days=35)).strftime("%Y-%m-%d")
    db.execute("DELETE FROM sent_telegram_reminders WHERE task_date < ?", (cutoff,))
    db.commit()
    return sent


def run():
    private_key = os.environ.get("PUSH_VAPID_PRIVATE_KEY", "")
    if not private_key or not os.path.isfile(private_key):
        print("Missing VAPID private key", file=sys.stderr)
        return 1
    subject = os.environ.get("PUSH_SUBJECT", "https://planer.fizmat-course.com")
    now = datetime.now(timezone.utc)
    sent = 0
    with database() as db:
        subscriptions = db.execute(
            "SELECT endpoint_id,uid,subscription_json,time_zone FROM push_subscriptions"
        ).fetchall()
        for endpoint_id, uid, subscription_json, tz in subscriptions:
            try:
                local = now.astimezone(ZoneInfo(tz))
            except Exception:
                continue
            rows = db.execute("SELECT id,payload FROM tasks WHERE uid=?", (uid,)).fetchall()
            for task_id, raw in rows:
                try:
                    task = json.loads(raw)
                    date = task["date"]
                    time = task["time"]
                    stage = due_reminder_stage(task, local)
                    if stage is None:
                        continue
                    if stage == 0:
                        cursor = db.execute(
                            "INSERT OR IGNORE INTO sent_reminders(endpoint_id,task_id,task_date,task_time) VALUES(?,?,?,?)",
                            (endpoint_id, task_id, date, time))
                    else:
                        cursor = db.execute(
                            "INSERT OR IGNORE INTO sent_repeat_reminders(endpoint_id,task_id,task_date,task_time,step) VALUES(?,?,?,?,?)",
                            (endpoint_id, task_id, date, time, stage))
                    if cursor.rowcount == 0:
                        continue
                    db.commit()  # reserve a delivery before contacting push service
                    heading = ("Планер · " + time) if stage == 0 else (
                        "Планер · Повтор " + ("1/2" if stage == 2 else "2/2")
                    )
                    payload = json.dumps({
                        "title": heading,
                        "body": str(task["title"])[:350],
                        "tag": "planer-" + task_id[:80] + "-" + date + "-" + time + "-" + str(stage),
                    }, ensure_ascii=False)
                    def release_failed_delivery():
                        if stage == 0:
                            db.execute(
                                "DELETE FROM sent_reminders WHERE endpoint_id=? AND task_id=? AND task_date=? AND task_time=?",
                                (endpoint_id, task_id, date, time))
                        else:
                            db.execute(
                                "DELETE FROM sent_repeat_reminders WHERE endpoint_id=? AND task_id=? AND task_date=? AND task_time=? AND step=?",
                                (endpoint_id, task_id, date, time, stage))
                    try:
                        webpush(
                            subscription_info=json.loads(subscription_json),
                            data=payload,
                            vapid_private_key=private_key,
                            vapid_claims={"sub": subject},
                            ttl=900,
                            timeout=8,
                        )
                        sent += 1
                    except WebPushException as error:
                        response = getattr(error, "response", None)
                        status = getattr(response, "status_code", None)
                        if status in (404, 410):
                            db.execute("DELETE FROM push_subscriptions WHERE endpoint_id=?", (endpoint_id,))
                            db.execute("DELETE FROM sent_reminders WHERE endpoint_id=?", (endpoint_id,))
                            db.execute("DELETE FROM sent_repeat_reminders WHERE endpoint_id=?", (endpoint_id,))
                        else:
                            # Retry if still inside the two-minute delivery window.
                            release_failed_delivery()
                            print("Push delivery failed for a subscriber", file=sys.stderr)
                        db.commit()
                        if status in (404, 410):
                            break
                    except Exception:
                        release_failed_delivery()
                        db.commit()
                        print("Push delivery error", file=sys.stderr)
                except (KeyError, ValueError, TypeError):
                    continue
        telegram_sent = send_telegram_reminders(db, now)
        # Keep deduplication records for 35 days only.
        cutoff = (now - timedelta(days=35)).strftime("%Y-%m-%d")
        db.execute("DELETE FROM sent_reminders WHERE task_date < ?", (cutoff,))
        db.execute("DELETE FROM sent_repeat_reminders WHERE task_date < ?", (cutoff,))
        db.commit()
    print("Web Push reminders sent:", sent, "Telegram reminders sent:", telegram_sent)
    return 0

if __name__ == "__main__":
    sys.exit(run())
