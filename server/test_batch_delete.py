"""Atomic, user-scoped batch deletion for clearing a selected Ramadan checklist."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from server import app as planner_app
from server.app import DeleteBatchRequest


class BatchDeleteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        scoped_path = patch.object(planner_app, "DB_PATH", Path(self.temp.name) / "tasks.sqlite3")
        scoped_path.start()
        self.addCleanup(scoped_path.stop)
        authenticated_user = patch.object(planner_app, "user", return_value="owner")
        authenticated_user.start()
        self.addCleanup(authenticated_user.stop)
        with planner_app.database() as db:
            db.execute("INSERT INTO users(uid,version) VALUES('owner',1)")
            db.execute("INSERT INTO users(uid,version) VALUES('other',1)")
            for uid, task_id, day, category in (
                ("owner", "ramadan-one", "2026-11-06", "Рамадан"),
                ("owner", "ramadan-two", "2026-11-06", "Рамадан"),
                ("owner", "next-day", "2026-11-07", "Рамадан"),
                ("owner", "ordinary", "2026-11-06", "Личное"),
                ("other", "ramadan-one", "2026-11-06", "Рамадан"),
            ):
                db.execute(
                    "INSERT INTO tasks(uid,id,payload) VALUES(?,?,?)",
                    (uid, task_id, json.dumps({
                        "id": task_id, "date": day, "category": category, "title": task_id,
                    })),
                )
            db.commit()

    def test_clears_only_supplied_tasks_once_and_preserves_other_days_and_users(self):
        result = planner_app.delete_tasks_batch(
            DeleteBatchRequest(
                ids=["ramadan-one", "ramadan-two", "ramadan-two"],
                baseVersion=1,
            ),
            authorization="test",
        )
        self.assertEqual(result["version"], 2)
        self.assertEqual({t["id"] for t in result["tasks"]}, {"next-day", "ordinary"})
        with planner_app.database() as db:
            other = db.execute("SELECT id FROM tasks WHERE uid='other'").fetchall()
            self.assertEqual(other, [("ramadan-one",)])
            self.assertEqual(db.execute(
                "SELECT version FROM users WHERE uid='owner'"
            ).fetchone(), (2,))

    def test_stale_device_cannot_delete_any_tasks(self):
        with self.assertRaises(HTTPException) as caught:
            planner_app.delete_tasks_batch(
                DeleteBatchRequest(ids=["ramadan-one", "ramadan-two"], baseVersion=0),
                authorization="test",
            )
        self.assertEqual(caught.exception.status_code, 409)
        with planner_app.database() as db:
            self.assertEqual(db.execute(
                "SELECT COUNT(*) FROM tasks WHERE uid='owner'"
            ).fetchone()[0], 4)

    def test_empty_or_oversized_batches_are_rejected(self):
        for ids in ([], ["x"] * 3001):
            with self.subTest(length=len(ids)), self.assertRaises(ValidationError):
                DeleteBatchRequest(ids=ids, baseVersion=1)


if __name__ == "__main__":
    unittest.main()
