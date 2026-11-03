"""Run once per minute via systemd timer. Sends due, unfinished task reminders.

The timer is a separate service, never modifying the existing trading bot.
Each subscription belongs to one verified Google account and one device.
"""
import json
import os
import sys
from html import escape
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from pywebpush import WebPushException, webpush

from server.app import database
from server.telegram_auth import bot_send

def due_reminder_stage(task, local_now):
    """Reminder stages: start=0, first repeat=2, end repeat=6.

    For older tasks without an end time, the original +4 minute repeat uses
    stage=4. All stages allow a one-minute timer grace period; the separate
    stage=6 ID prevents an old +4 delivery from suppressing a new end reminder.
    """
    if task.get("completed"):
        return None

    task_date = str(task.get("date", ""))
    start = str(task.get("time", ""))
    scheduled = task_date + " " + start
    repeat = task.get("repeatReminder") is True
    end = str(task.get("endTime") or "")
    has_end = bool(end and len(end) == 5 and end > start)

    def is_due(timestamp):
        return any(timestamp == (local_now - timedelta(minutes=delay)).strftime("%Y-%m-%d %H:%M")
                   for delay in (0, 1))

    # Prioritize the end of a short task over a +1-minute grace reminder.
    if repeat and has_end and is_due(task_date + " " + end):
        return 6
    if is_due(scheduled):
        return 0
    if not repeat:
        return None

    # For tasks lasting <=2 minutes, do not send repeat 1/2 at or after the end.
    try:
        start_dt = datetime.strptime(scheduled, "%Y-%m-%d %H:%M")
    except ValueError:
        return None
    if (not has_end or datetime.strptime(task_date + " " + end, "%Y-%m-%d %H:%M") > start_dt + timedelta(minutes=2)) and is_due(
        (start_dt + timedelta(minutes=2)).strftime("%Y-%m-%d %H:%M")
    ):
        return 2
    if not has_end and is_due((start_dt + timedelta(minutes=4)).strftime("%Y-%m-%d %H:%M")):
        return 4
    return None


def telegram_reminder_stage(task, local_now):
    """Telegram-only heads-up 15 minutes before due; preserve normal reminder schedule."""
    if task.get("completed"):
        return None
    scheduled = str(task.get("date", "")) + " " + str(task.get("time", ""))
    # One-minute grace for the systemd timer. The DB step=-15 prevents duplicates.
    for grace in (0, 1):
        ahead = local_now + timedelta(minutes=15 - grace)
        if scheduled == ahead.strftime("%Y-%m-%d %H:%M"):
            return -15
    return due_reminder_stage(task, local_now)


def telegram_reminder_message(task, stage):
    """Telegram HTML with real line breaks and escaped user-supplied task names."""
    name = escape(str(task["title"])[:350])
    when = escape(str(task["time"]))
    end_time = escape(str(task.get("endTime") or ""))
    if stage == -15:
        heading = "🕌 НАПОМИНАНИЕ О ЦЕЛИ"
        detail = "⏳ До вашей цели осталось <b>15 минут</b>."
        closing = "Пусть Аллах дарует баракат вашему времени и облегчит задуманное."
    elif stage == 0:
        heading = "🌙 ВРЕМЯ ЦЕЛИ НАСТУПИЛО"
        detail = "✨ Время приступить к запланированному делу."
        closing = "Пусть ваше дело принесёт пользу и будет совершено с добрым намерением."
    else:
        heading = "🔔 ПОВТОРНОЕ НАПОМИНАНИЕ " + ("1/2" if stage == 2 else "2/2")
        detail = ("🏁 Время, отведённое на задачу, закончилось."
                  if stage == 6 else "🌿 Цель ещё отмечена как невыполненная.")
        closing = "Если вы уже завершили дело, отметьте его выполненным в Планере."
    return "\n".join((
        f"<b>{heading}</b>",
        "﴿ بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ ﴾",
        "",
        detail,
        "",
        f"🎯 Цель: <b>{name}</b>",
        f"🕰 Начало: <b>{when}</b>",
        *( [f"🏁 Конец: <b>{end_time}</b>"] if end_time else [] ),
        "",
        f"<i>{closing}</i>",
        "",
        '📖 <a href="https://planer.fizmat-course.com/">Открыть Планер</a>',
    ))


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
                stage = telegram_reminder_stage(task, local_time)
                if stage is None:
                    continue
                task_date, task_time = task["date"], task["time"]
                created = db.execute("""INSERT OR IGNORE INTO sent_telegram_reminders
                    (tg_id,task_id,task_date,task_time,step) VALUES(?,?,?,?,?)""",
                    (tg_id,task_id,task_date,task_time,stage)).rowcount
                if not created:
                    continue
                db.commit()
                body = telegram_reminder_message(task, stage)
                if bot_send(chat_id, body, parse_mode="HTML"):
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
                        "body": (str(task["title"])[:300] + (" · Конец: " + str(task["endTime"])
                            if stage == 6 else "")),
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
