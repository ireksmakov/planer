"""Quran text proxy and bookmark validation regression tests.

Network is deliberately mocked: CI must never need an external Quran service.
"""
import io
import json
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from server.app import QuranReadingState, quran_page
from server.quran_pages import _parse_quran_page, fetch_quran_page


def sample_response(page=1):
    return json.dumps({
        "code": 200,
        "status": "OK",
        "data": {
            "number": page,
            "ayahs": [{
                "text": "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",
                "numberInSurah": 1,
                "surah": {"number": 1, "name": "سُورَةُ ٱلْفَاتِحَةِ"},
            }],
        },
    }, ensure_ascii=False).encode("utf-8")


class FakeResponse(io.BytesIO):
    pass


class QuranPagesTests(unittest.TestCase):
    def setUp(self):
        fetch_quran_page.cache_clear()
        self.addCleanup(fetch_quran_page.cache_clear)

    def test_page_text_is_unmodified_and_cache_prevents_repeated_requests(self):
        arabic = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ"
        with patch("server.quran_pages.urlopen", return_value=FakeResponse(sample_response())) as outgoing:
            page = quran_page(1)
            self.assertEqual(page["page"], 1)
            self.assertEqual(page["edition"], "quran-uthmani")
            self.assertEqual(page["ayahs"][0]["text"], arabic)
            self.assertEqual(page["ayahs"][0]["surah"]["name"], "سُورَةُ ٱلْفَاتِحَةِ")
            self.assertEqual(quran_page(1), page)
            outgoing.assert_called_once()

    def test_rejects_wrong_page_number_and_malformed_ayah(self):
        with self.assertRaises(ValueError):
            _parse_quran_page(sample_response(2), 1)
        bad = json.loads(sample_response())
        bad["data"]["ayahs"][0]["text"] = ""
        with self.assertRaises(ValueError):
            _parse_quran_page(json.dumps(bad).encode("utf-8"), 1)

    def test_invalid_number_never_calls_external_source(self):
        with patch("server.quran_pages.urlopen") as outgoing:
            for number in (0, 605, -1):
                with self.assertRaises(HTTPException) as caught:
                    quran_page(number)
                self.assertEqual(caught.exception.status_code, 422)
            outgoing.assert_not_called()

    def test_upstream_failure_does_not_return_fake_quran_text(self):
        with patch("server.quran_pages.urlopen", side_effect=OSError("network down")) as outgoing:
            with self.assertRaises(HTTPException) as caught:
                quran_page(17)
            self.assertEqual(caught.exception.status_code, 503)
            self.assertEqual(outgoing.call_count, 2)

    def test_valid_partial_bookmark_and_completed_sessions(self):
        state = QuranReadingState.model_validate({
            "pace": 30, "startDate": "2027-02-08",
            "completedSessions": [0],
            "pageProgress": {"0": 4, "1": 2},
            "bookmark": {"session": 1, "page": 6},
        })
        self.assertEqual(state.pageProgress["1"], 2)
        self.assertEqual(state.bookmark.page, 6)
        self.assertEqual(QuranReadingState.model_validate(state.model_dump()).pageProgress, state.pageProgress)

    def test_out_of_range_reading_positions_are_rejected(self):
        sample = {"pace": 30, "startDate": "2027-02-08", "completedSessions": []}
        for invalid in (
            {"pageProgress": {"0": 5}},
            {"pageProgress": {"150": 1}},
            {"pageProgress": {"01": 1}},
            {"pageProgress": {"149": 9}},  # day 30, Isha covers 597–604 (8 pages)
            {"bookmark": {"session": 0, "page": 100}},
            {"bookmark": {"session": 150, "page": 1}},
        ):
            with self.subTest(invalid=invalid), self.assertRaises(ValidationError):
                QuranReadingState.model_validate({**sample, **invalid})

    def test_last_prayer_in_cycle_allows_extra_four_pages(self):
        state = QuranReadingState.model_validate({
            "pace": 6, "startDate": "2027-02-08",
            "completedSessions": [], "pageProgress": {"29": 24},
            "bookmark": {"session": 29, "page": 604},
        })
        self.assertEqual(state.pageProgress["29"], 24)


if __name__ == "__main__":
    unittest.main()
