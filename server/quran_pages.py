"""Safe, bounded same-origin proxy for page-accurate Uthmani Quran text.

The Quran text comes from AlQuran Cloud's documented public quran-uthmani
edition (604-page Madinah mushaf). Text is relayed without modification.
No API credentials, browser redirection, or whole-corpus download are needed.
"""
import json
from functools import lru_cache
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

QURAN_PAGE_SOURCES = (
    "https://api.alquran.cloud/v1/page/{page}/quran-uthmani",
    "https://alquran.api.islamic.network/v1/page/{page}/quran-uthmani",
)
MAX_RESPONSE_BYTES = 180_000


def _parse_quran_page(raw: bytes, expected_page: int) -> dict:
    response = json.loads(raw)
    if not isinstance(response, dict) or response.get("code") != 200:
        raise ValueError("Quran API returned an error")
    page = response.get("data")
    if not isinstance(page, dict) or page.get("number") != expected_page:
        raise ValueError("Unexpected Quran page")
    ayahs = page.get("ayahs")
    if not isinstance(ayahs, list) or not 1 <= len(ayahs) <= 100:
        raise ValueError("Invalid Quran page contents")

    results = []
    for ayah in ayahs:
        if not isinstance(ayah, dict):
            raise ValueError("Malformed Quran verse")
        text = ayah.get("text")
        surah = ayah.get("surah")
        if (not isinstance(text, str) or not 1 <= len(text) <= 15_000
                or not isinstance(surah, dict)
                or not isinstance(surah.get("name"), str)
                or not isinstance(surah.get("number"), int)
                or not isinstance(ayah.get("numberInSurah"), int)
                or not 1 <= surah["number"] <= 114
                or not 1 <= ayah["numberInSurah"] <= 286):
            raise ValueError("Invalid Quran verse metadata")
        # Keep Arabic letters, diacritics, and Uthmani orthography untouched.
        results.append({
            "text": text,
            "numberInSurah": ayah["numberInSurah"],
            "surah": {"name": surah["name"], "number": surah["number"]},
        })
    return {"page": expected_page, "ayahs": results, "edition": "quran-uthmani"}


@lru_cache(maxsize=96)
def fetch_quran_page(page_number: int) -> dict:
    if type(page_number) is not int or not 1 <= page_number <= 604:
        raise ValueError("Quran page must be 1–604")
    for source in QURAN_PAGE_SOURCES:
        url = source.format(page=page_number)
        request = Request(url, headers={
            "User-Agent": "Planner-Quran-Reader/1.0",
            "Accept": "application/json",
        })
        try:
            with urlopen(request, timeout=8) as response:
                # Read at most MAX_RESPONSE_BYTES + 1; never let an upstream
                # response exhaust server memory.
                raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise ValueError("Quran page response is too large")
            return _parse_quran_page(raw, page_number)
        except (HTTPError, URLError, TimeoutError, OSError, ValueError,
                json.JSONDecodeError, KeyError, TypeError):
            # Other documented mirror may remain reachable during an outage.
            continue
    raise ConnectionError("Quran text service is temporarily unavailable")
