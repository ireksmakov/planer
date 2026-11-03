"""Regression tests for one-time membership in TWO Telegram communities."""
import os
import sqlite3
import unittest
from unittest.mock import patch

from server.telegram_auth import create_session, init_tables, lookup_session, required_community_key, membership_already_confirmed
from server.telegram_membership import configured_groups, membership_status, verification_keyboard

SETTINGS = {"TELEGRAM_REQUIRED_CHAT_IDS": "@mathematician24,@investment2027"}
GROUP_IDS = ("@mathematician24", "@investment2027")


class GroupGateTests(unittest.TestCase):
    def test_two_groups_have_correct_ids_titles_and_urls(self):
        with patch.dict(os.environ, SETTINGS):
            groups = configured_groups()
        self.assertEqual([g["id"] for g in groups], list(GROUP_IDS))
        self.assertEqual([g["title"] for g in groups], ["ФИЗМАТ", "Мир инвестиций"])
        self.assertEqual([g["url"] for g in groups], [
            "https://t.me/mathematician24", "https://t.me/investment2027",
        ])

    def test_configuration_rejects_invalid_or_duplicate_group_ids(self):
        with patch.dict(os.environ, {"TELEGRAM_REQUIRED_CHAT_IDS": "@bad,@bad"}):
            self.assertEqual(configured_groups(), [])
        with patch.dict(os.environ, {"TELEGRAM_REQUIRED_CHAT_IDS": "@a,https://evil.com"}):
            self.assertEqual(configured_groups(), [])

    @patch("server.telegram_membership.telegram_api")
    def test_membership_status_and_error_conditions(self, mock_api):
        for status in ("member", "administrator", "creator"):
            mock_api.return_value = {"status": status}
            self.assertTrue(membership_status("123456", "@mathematician24"))
        mock_api.return_value = {"status": "restricted", "is_member": True}
        self.assertTrue(membership_status("123456", "@investment2027"))
        mock_api.return_value = {"status": "restricted", "is_member": False}
        self.assertFalse(membership_status("123456", "@investment2027"))
        for status in ("left", "kicked"):
            mock_api.return_value = {"status": status}
            self.assertFalse(membership_status("123456", "@mathematician24"))
        mock_api.return_value = None
        self.assertIsNone(membership_status("123456", "@investment2027"))
        mock_api.assert_called_with("getChatMember", {
            "chat_id": "@investment2027", "user_id": 123456
        })

    def test_join_keyboard_contains_two_named_buttons(self):
        with patch.dict(os.environ, SETTINGS):
            keyboard = verification_keyboard("abc123")
            only_second = verification_keyboard("abc123", ["@investment2027"])
        rows = keyboard["inline_keyboard"]
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0][0]["url"], "https://t.me/mathematician24")
        self.assertEqual(rows[1][0]["url"], "https://t.me/investment2027")
        self.assertEqual(rows[2][0]["callback_data"], "verify_abc123")
        self.assertEqual(len(only_second["inline_keyboard"]), 2)
        self.assertEqual(only_second["inline_keyboard"][0][0]["text"], "🌙 Мир инвестиций")

    def test_old_receipts_cannot_bypass_explicit_verification(self):
        db = sqlite3.connect(":memory:")
        init_tables(db)
        token = create_session(db, "telegram", "12345")
        db.execute(
            "INSERT INTO telegram_accounts (tg_id,uid,chat_id,time_zone) VALUES(?,?,?,?)",
            ("12345", "tg:12345", "12345", "UTC"),
        )
        db.executemany("""INSERT INTO telegram_verified_communities
            (tg_id,chat_id,verified_at) VALUES(?,?,?)""",
            [("12345", chat_id, 123456) for chat_id in GROUP_IDS])
        db.commit()
        with patch.dict(os.environ, SETTINGS):
            # Before v2 a /start could create these receipts automatically.
            self.assertIsNone(lookup_session(db, token))
            self.assertFalse(membership_already_confirmed(db, "12345"))
            db.execute("""UPDATE telegram_accounts SET
                membership_verified_set=?,membership_verified_at=?
                WHERE tg_id=?""",
                (required_community_key(), 123456, "12345"))
            db.commit()
            self.assertEqual(lookup_session(db, token), ("tg:12345", "telegram"))
            with patch("server.telegram_membership.telegram_api",
                       side_effect=AssertionError("Do not recheck after explicit confirmation")):
                self.assertEqual(lookup_session(db, token), ("tg:12345", "telegram"))
        db.close()

    def test_existing_google_session_and_linked_uid_are_preserved(self):
        db = sqlite3.connect(":memory:")
        init_tables(db)
        google_token = create_session(db, "google", "original-user")
        telegram_token = create_session(db, "telegram", "12345")
        db.execute(
            "INSERT INTO telegram_accounts(tg_id,uid,chat_id,time_zone) VALUES(?,?,?,?)",
            ("12345", "original-user", "12345", "UTC"),
        )
        db.execute("""UPDATE telegram_accounts SET
            membership_verified_set=?,membership_verified_at=? WHERE tg_id=?""",
            (",".join(sorted(GROUP_IDS)), 123456, "12345"))
        db.commit()
        with patch.dict(os.environ, SETTINGS):
            self.assertEqual(lookup_session(db, google_token), ("original-user", "google"))
            self.assertEqual(lookup_session(db, telegram_token), ("original-user", "telegram"))
        db.close()

    def test_migrate_single_group_receipt_without_erasing_link(self):
        db = sqlite3.connect(":memory:")
        init_tables(db)
        db.execute("""INSERT INTO telegram_accounts
            (tg_id,uid,chat_id,time_zone,verified_group_id,verified_at)
            VALUES(?,?,?,?,?,?)""",
            ("10", "google-uid", "10", "UTC", "@mathematician24", 123456))
        init_tables(db)
        row = db.execute("""SELECT verified_at FROM telegram_verified_communities
            WHERE tg_id=? AND chat_id=?""", ("10", "@mathematician24")).fetchone()
        self.assertEqual(row, (123456,))
        db.close()


if __name__ == "__main__":
    unittest.main()
