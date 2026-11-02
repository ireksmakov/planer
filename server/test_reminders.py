"""Fast regression tests for the optional repeat-reminder schedule."""
import unittest
from datetime import datetime, timezone, timedelta

from server.send_reminders import due_reminder_stage


class ReminderScheduleTests(unittest.TestCase):
    def setUp(self):
        self.task = {
            "date": "2026-11-02", "time": "19:21",
            "completed": False, "repeatReminder": True,
        }

    def check(self, clock, expected, repeat=True, completed=False):
        task = dict(self.task, repeatReminder=repeat, completed=completed)
        actual = due_reminder_stage(task, datetime.fromisoformat(clock))
        self.assertEqual(actual, expected, clock)

    def test_repeated_schedule(self):
        for clock, expected in (
            ("2026-11-02T19:20", None),
            ("2026-11-02T19:21", 0),
            ("2026-11-02T19:22", 0),
            ("2026-11-02T19:23", 2),
            ("2026-11-02T19:24", 2),
            ("2026-11-02T19:25", 4),
            ("2026-11-02T19:26", 4),
            ("2026-11-02T19:27", None),
        ):
            self.check(clock, expected)

    def test_default_single_notification(self):
        self.check("2026-11-02T19:21", 0, repeat=False)
        self.check("2026-11-02T19:23", None, repeat=False)
        self.check("2026-11-02T19:25", None, repeat=False)

    def test_completed_tasks_never_repeat(self):
        self.check("2026-11-02T19:21", None, completed=True)
        self.check("2026-11-02T19:23", None, completed=True)
        self.check("2026-11-02T19:25", None, completed=True)

    def test_midnight_rollover(self):
        task = dict(self.task, date="2026-11-02", time="23:58")
        self.assertEqual(due_reminder_stage(task, datetime(2026, 11, 3, 0, 0)), 2)
        self.assertEqual(due_reminder_stage(task, datetime(2026, 11, 3, 0, 2)), 4)


if __name__ == "__main__":
    unittest.main()
