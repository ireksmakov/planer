"""Fast regression tests for the optional repeat-reminder schedule."""
import unittest
from datetime import datetime, timezone, timedelta

from server.send_reminders import due_reminder_stage, telegram_reminder_stage, telegram_reminder_message


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

    def test_telegram_fifteen_minute_warning(self):
        task = dict(self.task)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 6)), -15)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 7)), -15)
        self.assertIsNone(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 8)))
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 21)), 0)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 23)), 2)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 25)), 4)

    def test_telegram_warning_without_extra_repeats(self):
        task = dict(self.task, repeatReminder=False)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 6)), -15)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 21)), 0)
        self.assertIsNone(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 23)))
        task["completed"] = True
        self.assertIsNone(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 6)))

    def test_telegram_early_warning_across_midnight(self):
        task = dict(self.task, date="2026-11-03", time="00:10")
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 23, 55)), -15)

    def test_end_time_is_displayed_but_does_not_change_reminder_schedule(self):
        task = dict(self.task, title="Публикация", endTime="20:15")
        message = telegram_reminder_message(task, -15)
        self.assertIn("Начало: <b>19:21</b>", message)
        self.assertIn("Конец: <b>20:15</b>", message)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 6)), -15)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 21)), 0)
        self.assertIsNone(telegram_reminder_stage(task, datetime(2026, 11, 2, 20, 15)))

    def test_old_tasks_with_no_end_time_keep_working(self):
        task = dict(self.task, title="Старая задача")
        self.assertNotIn("Конец:", telegram_reminder_message(task, 0))
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 21)), 0)

    def test_html_title_bold_and_escaped_with_real_linebreaks(self):
        task = dict(self.task, title='Урок <1> & \'важное\'')
        text = telegram_reminder_message(task, -15)
        self.assertIn('Цель: <b>Урок &lt;1&gt; &amp; &#x27;важное&#x27;</b>', text)
        self.assertIn('15 минут', text)
        self.assertIn('\n\n', text)
        self.assertNotIn('\\\\n', text)
        self.assertIn('<a href="https://planer.fizmat-course.com/">', text)
        for stage in (0, 2, 4):
            next_text = telegram_reminder_message(task, stage)
            self.assertIn('<b>Урок &lt;1&gt;', next_text)
            self.assertIn('Начало: <b>19:21</b>', next_text)


if __name__ == "__main__":
    unittest.main()
