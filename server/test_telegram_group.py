"""Checks for one-time group membership configuration and verification."""
import os
import sqlite3
import unittest
from unittest.mock import patch

from server.telegram_auth import create_session, init_tables, lookup_session
from server.telegram_membership import configured_group, membership_status, verification_keyboard

SETTINGS = {
    "TELEGRAM_REQUIRED_CHAT_ID": "@planer_community",
    "TELEGRAM_REQUIRED_CHAT_URL": "https://t.me/planer_community",
}


class GroupGateTests(unittest.TestCase):
    def test_group_configuration_checks_both_id_and_link(self):
        with patch.dict(os.environ, SETTINGS):
            self.assertEqual(configured_group(), (
                "@planer_community", "https://t.me/planer_community"
            ))
        with patch.dict(os.environ, {
            "TELEGRAM_REQUIRED_CHAT_ID": "invalid",
            "TELEGRAM_REQUIRED_CHAT_URL": "https://evil.invalid/"
        }):
            self.assertIsNone(configured_group())

    @patch("server.telegram_membership.telegram_api")
    def test_only_actual_members_pass(self, mock_api):
        with patch.dict(os.environ, SETTINGS):
            for status in ("member", "administrator", "creator"):
                mock_api.return_value = {"status": status}
                self.assertTrue(membership_status("123456"))
            mock_api.return_value = {"status": "restricted", "is_member": True}
            self.assertTrue(membership_status("123456"))
            mock_api.return_value = {"status": "restricted", "is_member": False}
            self.assertFalse(membership_status("123456"))
            for status in ("left", "kicked"):
                mock_api.return_value = {"status": status}
                self.assertFalse(membership_status("123456"))
            mock_api.return_value = None
            self.assertIsNone(membership_status("123456"))
            mock_api.assert_called_with("getChatMember", {
                "chat_id": "@planer_community", "user_id": 123456
            })

    def test_button_contains_join_link_and_one_time_challenge(self):
        with patch.dict(os.environ, SETTINGS):
            keys = verification_keyboard("abc123")
        rows = keys["inline_keyboard"]
        self.assertEqual(rows[0][0]["url"], SETTINGS["TELEGRAM_REQUIRED_CHAT_URL"])
        self.assertEqual(rows[1][0]["callback_data"], "verify_abc123")

    def test_login_requires_verified_group_then_remembers_it(self):
        db = sqlite3.connect(":memory:")
        init_tables(db)
        token = create_session(db, "telegram", "12345")
        db.execute(
            "INSERT INTO telegram_accounts (tg_id,uid,chat_id,time_zone) VALUES(?,?,?,?)",
            ("12345", "tg:12345", "12345", "UTC")
        )
        db.commit()
        with patch.dict(os.environ, SETTINGS):
            self.assertIsNone(lookup_session(db, token))
            db.execute(
                "UPDATE telegram_accounts SET verified_group_id=?,verified_at=? WHERE tg_id=?",
                ("@planer_community", 123456789, "12345")
            )
            db.commit()
            self.assertEqual(lookup_session(db, token), ("tg:12345", "telegram"))
            # Later logins use the saved proof without another Bot API call.
            with patch("server.telegram_membership.telegram_api", side_effect=AssertionError("unexpected check")):
                self.assertEqual(lookup_session(db, token), ("tg:12345", "telegram"))
        db.close()

    def test_google_session_survives_transition(self):
        db = sqlite3.connect(":memory:")
        init_tables(db)
        token = create_session(db, "google", "google-uid")
        db.commit()
        with patch.dict(os.environ, SETTINGS):
            self.assertEqual(lookup_session(db, token), ("google-uid", "google"))
        db.close()


if __name__ == "__main__":
    unittest.main()
