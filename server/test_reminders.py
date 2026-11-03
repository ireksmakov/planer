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
            ("2026-11-02T19:25", None),
            ("2026-11-02T19:26", None),
            ("2026-11-02T19:27", None),
            ("2026-11-02T20:20", None),
            ("2026-11-02T20:21", 60),
            ("2026-11-02T20:22", 60),
            ("2026-11-02T20:23", None),
        ):
            self.check(clock, expected)

    def test_default_single_notification(self):
        self.check("2026-11-02T19:21", 0, repeat=False)
        self.check("2026-11-02T19:23", None, repeat=False)
        self.check("2026-11-02T19:25", None, repeat=False)
        self.check("2026-11-02T20:21", None, repeat=False)

    def test_completed_tasks_never_repeat(self):
        self.check("2026-11-02T19:21", None, completed=True)
        self.check("2026-11-02T19:23", None, completed=True)
        self.check("2026-11-02T19:25", None, completed=True)
        self.check("2026-11-02T20:21", None, completed=True)

    def test_midnight_rollover(self):
        task = dict(self.task, date="2026-11-02", time="23:58")
        self.assertEqual(due_reminder_stage(task, datetime(2026, 11, 3, 0, 0)), 2)
        self.assertIsNone(due_reminder_stage(task, datetime(2026, 11, 3, 0, 2)))
        self.assertEqual(due_reminder_stage(task, datetime(2026, 11, 3, 0, 58)), 60)
        self.assertEqual(due_reminder_stage(task, datetime(2026, 11, 3, 0, 59)), 60)

    def test_telegram_fifteen_minute_warning(self):
        task = dict(self.task)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 6)), -15)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 7)), -15)
        self.assertIsNone(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 8)))
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 21)), 0)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 23)), 2)
        self.assertIsNone(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 25)))
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 20, 21)), 60)

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

    def test_second_repeat_arrives_at_end_of_task(self):
        task = dict(self.task, title="Публикация", endTime="20:15")
        message = telegram_reminder_message(task, -15)
        self.assertIn("Начало: <b>19:21</b>", message)
        self.assertIn("Конец: <b>20:15</b>", message)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 6)), -15)
        self.assertEqual(due_reminder_stage(task, datetime(2026, 11, 2, 19, 21)), 0)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 23)), 2)
        self.assertIsNone(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 25)))
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 20, 15)), 6)
        self.assertEqual(telegram_reminder_stage(task, datetime(2026, 11, 2, 20, 16)), 6)
        self.assertIsNone(telegram_reminder_stage(task, datetime(2026, 11, 2, 20, 17)))
        self.assertIn("ПОВТОРНОЕ НАПОМИНАНИЕ 2/2", telegram_reminder_message(task, 6))
        self.assertIn("Время, отведённое на задачу, закончилось", telegram_reminder_message(task, 6))

    def test_start_2050_end_2100_ends_at_2100_not_2054(self):
        task = dict(self.task, date="2026-11-03", time="20:50", endTime="21:00")
        expected = [
            ("20:35", -15), ("20:50", 0), ("20:52", 2),
            ("20:54", None), ("20:59", None), ("21:00", 6),
            ("21:01", 6), ("21:02", None),
        ]
        for clock, stage in expected:
            with self.subTest(clock=clock):
                current = datetime.strptime("2026-11-03 " + clock, "%Y-%m-%d %H:%M")
                self.assertEqual(telegram_reminder_stage(task, current), stage)
                if stage != -15:
                    self.assertEqual(due_reminder_stage(task, current), stage)

    def test_end_reminder_respects_repeat_option_and_completion(self):
        task = dict(self.task, endTime="19:31", repeatReminder=False)
        self.assertIsNone(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 31)))
        task["repeatReminder"] = True
        task["completed"] = True
        self.assertIsNone(telegram_reminder_stage(task, datetime(2026, 11, 2, 19, 31)))

    def test_very_short_tasks_skip_first_repeat(self):
        for end_clock in ("19:22", "19:23"):
            task = dict(self.task, endTime=end_clock)
            end_at = datetime.strptime("2026-11-02 " + end_clock, "%Y-%m-%d %H:%M")
            self.assertEqual(due_reminder_stage(task, end_at), 6)
            self.assertIsNone(due_reminder_stage(task, end_at + timedelta(minutes=2)))
            self.assertIsNone(due_reminder_stage(task, datetime(2026, 11, 2, 19, 25)))

    def test_second_repeat_without_end_is_after_one_hour(self):
        task = dict(self.task, title="Старая задача")
        self.assertIsNone(due_reminder_stage(task, datetime(2026, 11, 2, 19, 25)))
        self.assertEqual(due_reminder_stage(task, datetime(2026, 11, 2, 20, 21)), 60)
        self.assertNotIn("Конец:", telegram_reminder_message(task, 60))
        self.assertIn("ПОВТОРНОЕ НАПОМИНАНИЕ 2/2", telegram_reminder_message(task, 60))
        self.assertIn("Цель ещё отмечена как невыполненная", telegram_reminder_message(task, 60))

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
        for stage in (0, 2, 6, 60):
            next_text = telegram_reminder_message(task, stage)
            self.assertIn('<b>Урок &lt;1&gt;', next_text)
            self.assertIn('Начало: <b>19:21</b>', next_text)


if __name__ == "__main__":
    unittest.main()
