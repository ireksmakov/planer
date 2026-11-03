"""One-time Telegram community membership verification for Planner onboarding.

The bot must be an administrator in the configured group/channel for
getChatMember to reliably check other people. Verification is stored once.
"""
import json
import os
import re
from urllib import request as urlrequest
from urllib.error import HTTPError, URLError

_CHAT_ID = re.compile(r"^(?:@[A-Za-z][A-Za-z0-9_]{4,31}|-100[0-9]{5,20})$")
_JOIN_URL = re.compile(r"^https://t\.me/(?:[A-Za-z][A-Za-z0-9_]{4,31}|\+[A-Za-z0-9_-]{8,})$")


def configured_group():
    chat_id = os.getenv("TELEGRAM_REQUIRED_CHAT_ID", "").strip()
    url = os.getenv("TELEGRAM_REQUIRED_CHAT_URL", "").strip()
    if not _CHAT_ID.fullmatch(chat_id) or not _JOIN_URL.fullmatch(url):
        return None
    return chat_id, url


def telegram_api(method: str, payload: dict):
    """Call a fixed Telegram Bot API method, without leaking credentials."""
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


def membership_status(telegram_user_id: str):
    """True if joined, False if not joined, None if API unavailable."""
    config = configured_group()
    if not config:
        return None
    result = telegram_api("getChatMember", {
        "chat_id": config[0], "user_id": int(telegram_user_id),
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


def verification_keyboard(request_code: str) -> dict:
    config = configured_group()
    if not config:
        raise ValueError("Required Telegram group has not been configured")
    return {"inline_keyboard": [
        [{"text": "🌙 Вступить в группу Планера", "url": config[1]}],
        [{"text": "✅ Проверить подписку", "callback_data": "verify_" + request_code}],
    ]}


def answer_callback(callback_id: str, message: str):
    if callback_id:
        telegram_api("answerCallbackQuery", {
            "callback_query_id": callback_id,
            "text": message[:180],
            "show_alert": False,
        })
