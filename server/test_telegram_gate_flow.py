"""End-to-end tests of the actual Telegram webhook + callback login flow.

No network calls or real Telegram credentials. Test first /start, denied checks,
successful explicit callback, and subsequent login with the same verified user.
"""
import asyncio
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse, parse_qs

from server import app as planner_app
from server.telegram_auth import TelegramStart, TelegramStatus, lookup_session

GROUPS = ("@mathematician24", "@investment2027")
CONFIG = {
    "TELEGRAM_REQUIRED_CHAT_IDS": ",".join(GROUPS),
    "TELEGRAM_BOT_TOKEN": "123456:" + "A" * 35,
    "TELEGRAM_BOT_USERNAME": "planer12345_bot",
    "TELEGRAM_WEBHOOK_SECRET": "s" * 40,
}


class FakeRequest:
    headers = {"content-length": "120"}

    def __init__(self, payload):
        self.payload = payload

    async def json(self):
        return self.payload


class ActualTelegramLoginFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.config = patch.dict(os.environ, CONFIG)
        self.config.start()
        self.addCleanup(self.config.stop)
        self.db_path = patch.object(planner_app, "DB_PATH", Path(self.temp.name) / "login.sqlite3")
        self.db_path.start()
        self.addCleanup(self.db_path.stop)
        self.bot_send = patch("server.telegram_auth.bot_send", return_value=True)
        self.sent_messages = self.bot_send.start()
        self.addCleanup(self.bot_send.stop)
        self.answer_callback = patch("server.telegram_auth.answer_callback")
        self.answer_callback.start()
        self.addCleanup(self.answer_callback.stop)

        routes = {route.path: route.endpoint for route in planner_app.app.routes}
        self.start = routes["/api/telegram/start"]
        self.status = routes["/api/telegram/status"]
        self.webhook = routes["/api/telegram/webhook"]

    def begin(self):
        response = self.start(TelegramStart(mode="login", timeZone="UTC"), authorization=None)
        code = parse_qs(urlparse(response["url"]).query)["start"][0].removeprefix("pl_")
        return code, response["requestId"]

    def send_start(self, code, user_id="12345"):
        return asyncio.run(self.webhook(
            FakeRequest({"message": {
                "from": {"id": int(user_id)},
                "chat": {"id": int(user_id), "type": "private"},
                "text": "/start pl_" + code,
            }}),
            x_telegram_bot_api_secret_token=CONFIG["TELEGRAM_WEBHOOK_SECRET"],
        ))

    def send_check(self, code, user_id="12345"):
        return asyncio.run(self.webhook(
            FakeRequest({"callback_query": {
                "id": "callback42",
                "from": {"id": int(user_id)},
                "message": {"chat": {"id": int(user_id), "type": "private"}},
                "data": "verify_" + code,
            }}),
            x_telegram_bot_api_secret_token=CONFIG["TELEGRAM_WEBHOOK_SECRET"],
        ))

    def test_unsubscribed_person_is_denied_until_both_subscribe_then_remembered(self):
        code, request_id = self.begin()
        with patch("server.telegram_auth.membership_status") as checker:
            self.send_start(code)
            checker.assert_not_called()
        first_text, first_kwargs = self.sent_messages.call_args.args[1], self.sent_messages.call_args.kwargs
        self.assertIn("ФИЗМАТ", first_text)
        self.assertIn("Мир инвестиций", first_text)
        self.assertIn("<b>Для первого входа подпишитесь на оба сообщества:</b>", first_text)
        self.assertEqual(first_kwargs["parse_mode"], "HTML")
        keyboard = first_kwargs["reply_markup"]["inline_keyboard"]
        self.assertEqual(len(keyboard), 3)
        self.assertEqual(
            self.status(TelegramStatus(requestId=request_id)),
            {"status": "pending", "joinRequired": True},
        )
        with patch("server.telegram_auth.membership_status", side_effect=[False, False]) as checker:
            self.send_check(code)
            self.assertEqual(checker.call_count, 2)
        self.assertIn("Вход пока закрыт", self.sent_messages.call_args.args[1])
        self.assertEqual(self.status(TelegramStatus(requestId=request_id))["status"], "pending")
        with planner_app.database() as db:
            self.assertIsNone(db.execute(
                "SELECT tg_id FROM telegram_accounts WHERE tg_id='12345'"
            ).fetchone())

        with patch("server.telegram_auth.membership_status", side_effect=[True, False]):
            self.send_check(code)
        self.assertEqual(self.status(TelegramStatus(requestId=request_id))["status"], "pending")

        with patch("server.telegram_auth.membership_status", side_effect=[True, True]):
            self.send_check(code)
        self.assertIn("Вход в «Планер» подтверждён", self.sent_messages.call_args.args[1])
        authenticated = self.status(TelegramStatus(requestId=request_id))
        self.assertEqual(authenticated["status"], "authenticated")
        with planner_app.database() as db:
            self.assertEqual(lookup_session(db, authenticated["token"]), ("tg:12345", "telegram"))

        # Return login: membership is checked silently; no repeated join action.
        again_code, again_request_id = self.begin()
        with patch("server.telegram_auth.membership_status", side_effect=[True, True]) as checker:
            self.send_start(again_code)
            self.assertEqual(checker.call_count, 2)
        self.assertIn("Вход в «Планер» подтверждён", self.sent_messages.call_args.args[1])
        self.assertEqual(self.status(TelegramStatus(requestId=again_request_id))["status"],
                         "authenticated")
        # If someone leaves a channel later, new login must be denied.
        left_code, left_request_id = self.begin()
        with patch("server.telegram_auth.membership_status", side_effect=[False, True]):
            self.send_start(left_code)
        self.assertIn("Вход пока закрыт", self.sent_messages.call_args.args[1])
        self.assertEqual(self.status(TelegramStatus(requestId=left_request_id))["status"],
                         "pending")
        with planner_app.database() as db:
            self.assertFalse(db.execute(
                "SELECT membership_verified_at FROM telegram_accounts WHERE tg_id='12345'"
            ).fetchone()[0])

    def test_legacy_cached_receipts_cannot_bypass_required_join_buttons(self):
        with planner_app.database() as db:
            db.execute("""INSERT INTO telegram_accounts(tg_id,uid,chat_id,time_zone)
                VALUES(?,?,?,?)""", ("54321", "tg:54321", "54321", "UTC"))
            db.executemany("""INSERT INTO telegram_verified_communities
                (tg_id,chat_id,verified_at) VALUES(?,?,?)""",
                [("54321", group, 1234) for group in GROUPS])
            db.commit()
        code, request_id = self.begin()
        with patch("server.telegram_auth.membership_status",
                   side_effect=AssertionError("first /start must not check")):
            self.send_start(code, user_id="54321")
        self.assertEqual(self.status(TelegramStatus(requestId=request_id))["status"], "pending")
        self.assertIn("Проверить подписки",
                      self.sent_messages.call_args.kwargs["reply_markup"]["inline_keyboard"][-1][0]["text"])

    def test_unavailable_api_never_authorizes(self):
        code, request_id = self.begin()
        self.send_start(code)
        with patch("server.telegram_auth.membership_status", side_effect=[True, None]):
            self.send_check(code)
        self.assertEqual(self.status(TelegramStatus(requestId=request_id))["status"], "pending")
        self.assertNotIn("Вход в «Планер» подтверждён", self.sent_messages.call_args.args[1])


if __name__ == "__main__":
    unittest.main()
