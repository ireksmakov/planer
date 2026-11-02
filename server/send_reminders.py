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
            slots = set()
            for delta in (0, 1):
                stamp = local - timedelta(minutes=delta)
                slots.add((stamp.strftime("%Y-%m-%d"), stamp.strftime("%H:%M")))
            rows = db.execute("SELECT id,payload FROM tasks WHERE uid=?", (uid,)).fetchall()
            for task_id, raw in rows:
                try:
                    task = json.loads(raw)
                    date = task["date"]
                    time = task["time"]
                    if task["completed"] or (date, time) not in slots:
                        continue
                    cursor = db.execute(
                        "INSERT OR IGNORE INTO sent_reminders(endpoint_id,task_id,task_date,task_time) VALUES(?,?,?,?)",
                        (endpoint_id, task_id, date, time))
                    if cursor.rowcount == 0:
                        continue
                    db.commit()  # reserve this reminder before making external request
                    payload = json.dumps({
                        "title": "Планер · " + time,
                        "body": str(task["title"])[:350],
                        "tag": "planer-" + task_id[:100] + "-" + date + "-" + time,
                    }, ensure_ascii=False)
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
                        else:
                            # Retry when the next minute's timer executes.
                            db.execute(
                                "DELETE FROM sent_reminders WHERE endpoint_id=? AND task_id=? AND task_date=? AND task_time=?",
                                (endpoint_id, task_id, date, time))
                            print("Push delivery failed for a subscriber", file=sys.stderr)
                        db.commit()
                        if status in (404, 410):
                            break
                    except Exception:
                        db.execute(
                            "DELETE FROM sent_reminders WHERE endpoint_id=? AND task_id=? AND task_date=? AND task_time=?",
                            (endpoint_id, task_id, date, time))
                        db.commit()
                        print("Push delivery error", file=sys.stderr)
                except (KeyError, ValueError, TypeError):
                    continue
        # Keep deduplication records for 35 days only.
        cutoff = (now - timedelta(days=35)).strftime("%Y-%m-%d")
        db.execute("DELETE FROM sent_reminders WHERE task_date < ?", (cutoff,))
        db.commit()
    print("Reminders sent:", sent)
    return 0

if __name__ == "__main__":
    sys.exit(run())
