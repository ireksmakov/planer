"""Backwards-compatible task start/end field tests for the Planner API."""
import unittest
from pydantic import ValidationError

from server.app import Task


class TaskTimeRangeTests(unittest.TestCase):
    def sample(self):
        return dict(
            id="demo", title="Публикация", date="2026-11-03", time="20:35",
            priority="medium", category="Личное", completed=False,
            createdAt=1793738100000,
        )

    def test_existing_task_without_end_still_loads(self):
        task = Task.model_validate(self.sample())
        self.assertEqual(task.time, "20:35")
        self.assertEqual(task.endTime, "")
        self.assertEqual(task.model_dump()["endTime"], "")

    def test_new_task_with_end_roundtrips(self):
        payload = dict(self.sample(), endTime="21:15")
        task = Task.model_validate(payload)
        saved = task.model_dump()
        self.assertEqual(saved["time"], "20:35")
        self.assertEqual(saved["endTime"], "21:15")
        self.assertEqual(Task.model_validate(saved).endTime, "21:15")

    def test_additional_ramadan_goals_roundtrip_and_old_tasks(self):
        legacy = Task.model_validate(self.sample())
        self.assertEqual(legacy.subgoals, [])
        rich = Task.model_validate(dict(self.sample(), category="Рамадан",
            subgoals=["Выучить суру", "Повторить дуа"], endTime="21:15"))
        saved = rich.model_dump()
        self.assertEqual(saved["subgoals"], ["Выучить суру", "Повторить дуа"])
        self.assertEqual(Task.model_validate(saved).subgoals, rich.subgoals)

    def test_too_many_additional_goals_are_rejected(self):
        with self.assertRaises(ValidationError):
            Task.model_validate(dict(self.sample(), subgoals=["Цель"] * 31))

    def test_bad_end_time_is_rejected(self):
        for end in ("25:15", "20:99", "tomorrow", "9:00"):
            with self.subTest(end=end), self.assertRaises(ValidationError):
                Task.model_validate(dict(self.sample(), endTime=end))


if __name__ == "__main__":
    unittest.main()
