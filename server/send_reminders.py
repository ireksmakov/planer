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
            # A two-minute grace period for each delivery stage.
            # 0 = normal, 2 = first repeat, 4 = final repeat.
            slots = {
                stage: {
                    (local - timedelta(minutes=stage + delay)).strftime("%Y-%m-%d %H:%M")
                    for delay in (0, 1)
                }
                for stage in (0, 2, 4)
            }
            rows = db.execute("SELECT id,payload FROM tasks WHERE uid=?", (uid,)).fetchall()
            for task_id, raw in rows:
                try:
                    task = json.loads(raw)
                    date = task["date"]
                    time = task["time"]
                    if task["completed"]:
                        continue
                    scheduled = date + " " + time
                    repeat = task.get("repeatReminder") is True
                    stage = next((
                        step for step in (0, 2, 4)
                        if scheduled in slots[step] and (step == 0 or repeat)
                    ), None)
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
        # Keep deduplication records for 35 days only.
        cutoff = (now - timedelta(days=35)).strftime("%Y-%m-%d")
        db.execute("DELETE FROM sent_reminders WHERE task_date < ?", (cutoff,))
        db.execute("DELETE FROM sent_repeat_reminders WHERE task_date < ?", (cutoff,))
        db.commit()
    print("Reminders sent:", sent)
    return 0

if __name__ == "__main__":
    sys.exit(run())
