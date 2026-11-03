"""One-time membership verification for Planner's required Telegram communities.

Bot administrator privileges are required in EVERY configured group or channel:
Telegram getChatMember checks of other users are only reliable for admins.
"""
import json
import os
import re
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

_CHAT_ID = re.compile(r"^@[A-Za-z][A-Za-z0-9_]{4,31}$")
_CHAT_ID_PRIVATE = re.compile(r"^-100[0-9]{5,20}$")
_JOIN_URL = re.compile(r"^https://t\.me/(?:[A-Za-z][A-Za-z0-9_]{4,31}|\+[A-Za-z0-9_-]{8,})$")
_LABELS = {"@mathematician24": "ФИЗМАТ", "@investment2027": "Мир инвестиций"}


def configured_groups():
    """Return required groups as {id,title,url}; fail closed on invalid config."""
    raw = os.getenv("TELEGRAM_REQUIRED_CHAT_IDS", "").strip()
    if raw:
        ids = [item.strip() for item in raw.split(",")]
        if not 1 <= len(ids) <= 5 or len(ids) != len(set(ids)):
            return []
        if any(not _CHAT_ID.fullmatch(identifier) for identifier in ids):
            return []
        return [{
            "id": identifier,
            "title": _LABELS.get(identifier, identifier),
            "url": "https://t.me/" + identifier[1:],
        } for identifier in ids]
    # Backwards compatibility for older single-group deployments.
    chat_id = os.getenv("TELEGRAM_REQUIRED_CHAT_ID", "").strip()
    url = os.getenv("TELEGRAM_REQUIRED_CHAT_URL", "").strip()
    if not chat_id or not url:
        return []
    if not (_CHAT_ID.fullmatch(chat_id) or _CHAT_ID_PRIVATE.fullmatch(chat_id)):
        return []
    if not _JOIN_URL.fullmatch(url):
        return []
    return [{"id": chat_id, "title": "Сообщество Планера", "url": url}]


def telegram_api(method: str, payload: dict):
    """Call a fixed Telegram Bot API method without printing credentials."""
    if method not in ("getChatMember", "getMe", "answerCallbackQuery"):
        return None
    token = os.getenv("TELEGRAM_BOT_TOKEN", "")
    if not token:
        return None
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urlrequest.Request(
        "https://api.telegram.org/bot" + token + "/" + method,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlrequest.urlopen(req, timeout=8) as result:
            data = json.load(result)
        return data.get("result") if data.get("ok") else None
    except (HTTPError, URLError, OSError, ValueError):
        return None


def membership_status(telegram_user_id: str, chat_id: str):
    """True when joined, False when absent, None when Bot API is unavailable."""
    result = telegram_api("getChatMember", {
        "chat_id": chat_id, "user_id": int(telegram_user_id),
    })
    if not isinstance(result, dict):
        return None
    status = result.get("status")
    if status in ("creator", "administrator", "member"):
        return True
    if status == "restricted":
        return result.get("is_member") is True
    if status in ("left", "kicked"):
        return False
    return None


def verification_keyboard(request_code: str, missing=None):
    """Show one join link per outstanding community, then one verify button."""
    groups = configured_groups()
    if not groups:
        raise ValueError("Required Telegram communities are not configured")
    outstanding = groups if missing is None else [
        group for group in groups if group["id"] in set(missing)
    ]
    keyboard = [
        [{"text": "🌙 " + group["title"], "url": group["url"]}]
        for group in outstanding
    ]
    keyboard.append([{
        "text": "✅ Проверить подписки",
        "callback_data": "verify_" + request_code,
    }])
    return {"inline_keyboard": keyboard}


def answer_callback(callback_id: str, message: str):
    if callback_id:
        telegram_api("answerCallbackQuery", {
            "callback_query_id": callback_id,
            "text": message[:180],
            "show_alert": False,
        })
