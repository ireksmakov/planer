"""Regression checks for non-expiring account mappings and Telegram session isolation."""
import sqlite3
import time
import unittest
from unittest.mock import patch

from server.telegram_auth import create_session, digest, init_tables, lookup_session


class TelegramAuthTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        init_tables(self.db)
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def test_google_session_resolves_original_uid(self):
        token = create_session(self.db, "google", "google-sub-123")
        self.db.commit()
        self.assertEqual(lookup_session(self.db, token), ("google-sub-123", "google"))
        self.assertNotEqual(token, digest(token))
        self.assertIsNone(lookup_session(self.db, token + "x"))

    def test_telegram_session_uses_current_linked_google_uid(self):
        tg_id = "987654"
        self.db.execute(
            "INSERT INTO telegram_accounts(tg_id,uid,chat_id,time_zone) VALUES(?,?,?,?)",
            (tg_id, "tg:" + tg_id, tg_id, "UTC")
        )
        token = create_session(self.db, "telegram", tg_id)
        self.db.commit()
        self.assertEqual(lookup_session(self.db, token), ("tg:" + tg_id, "telegram"))
        self.db.execute("UPDATE telegram_accounts SET uid=? WHERE tg_id=?", ("google-sub-123", tg_id))
        self.db.commit()
        self.assertEqual(lookup_session(self.db, token), ("google-sub-123", "telegram"))

    def test_expired_and_unknown_tokens_rejected(self):
        token = create_session(self.db, "google", "abc")
        self.db.execute("UPDATE auth_sessions SET expires_at=?", (int(time.time()) - 1,))
        self.db.commit()
        self.assertIsNone(lookup_session(self.db, token))
        self.assertIsNone(lookup_session(self.db, "pln_fake"))
        self.assertIsNone(lookup_session(self.db, "Bearer " + token))


if __name__ == "__main__":
    unittest.main()
