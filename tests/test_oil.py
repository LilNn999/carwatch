"""Offline contract tests using sanitized, captured public Eastmoney rows.

Captured 2026-11-03 from the public RPTA_WEB_YJ_JH JSON query, projecting
DIM_DATE,CITYNAME,V92,V95. Rows below are verbatim public observations;
small response envelopes/counts are constructed for isolated test pages.
No private chat exports or images are used.
"""

import copy
import io
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit


BEIJING = [
    {"DIM_DATE": "2026-10-30 00:00:00", "CITYNAME": "北京", "V92": 8.89, "V95": 9.46},
    {"DIM_DATE": "2026-09-25 00:00:00", "CITYNAME": "北京", "V92": 8.61, "V95": 9.17},
    {"DIM_DATE": "2026-09-12 00:00:00", "CITYNAME": "北京", "V92": 8.29, "V95": 8.83},
]
ZHEJIANG = [
    {"DIM_DATE": "2026-10-30 00:00:00", "CITYNAME": "浙江", "V92": 8.85, "V95": 9.42},
    {"DIM_DATE": "2026-09-25 00:00:00", "CITYNAME": "浙江", "V92": 8.58, "V95": 9.12},
    {"DIM_DATE": "2026-09-12 00:00:00", "CITYNAME": "浙江", "V92": 8.26, "V95": 8.79},
]
LEGACY_ZHEJIANG = {
    "DIM_DATE": "2010-04-14 00:00:00", "CITYNAME": "浙江", "V92": 6.53, "V95": None
}


def envelope(rows=None, *, pages=1, count=None):
    rows = copy.deepcopy(BEIJING if rows is None else rows)
    return {
        "version": "public-fixture",
        "result": {"pages": pages, "data": rows, "count": len(rows) if count is None else count},
        "success": True,
        "message": "ok",
        "code": 0,
    }


class Response(io.BytesIO):
    def __init__(self, payload, *, headers=None, status=200):
        if isinstance(payload, dict) or isinstance(payload, list):
            payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        super().__init__(payload)
        self.headers = {} if headers is None else headers
        self.status = status
        self.read_sizes = []

    def read(self, size=-1):
        self.read_sizes.append(size)
        if size < 0:
            raise AssertionError("The provider must bound response reads")
        return super().read(size)


class OilProviderTests(unittest.TestCase):
    def setUp(self):
        # This assertion makes the initial RED an explicit missing-feature failure.
        self.assertTrue(
            (Path(__file__).resolve().parents[1] / "backend" / "oil.py").is_file(),
            "backend/oil.py public provider has not been implemented",
        )
        from backend import oil
        self.oil = oil

    def fetch(self, payload=None, province="北京", **kwargs):
        response = Response(envelope() if payload is None else payload)
        with patch.object(self.oil, "urlopen", return_value=response):
            result = self.oil.fetch_prices(province, **kwargs)
        return result

    def test_beijing_maps_grades_decimal_units_and_sorts_dates(self):
        rows = copy.deepcopy(BEIJING)
        rows[0].update(V89=8.32, V98=10.0, QE92=8.61, QE95=9.17, ZDE92=0.28)
        result = self.fetch(envelope(rows))
        self.assertEqual(result["province"], "北京")
        self.assertEqual(result["records"], [
            {"effective_date": "2026-09-12", "p92": 8.29, "p95": 8.83},
            {"effective_date": "2026-09-25", "p92": 8.61, "p95": 9.17},
            {"effective_date": "2026-10-30", "p92": 8.89, "p95": 9.46},
        ])
        self.assertEqual(result["unit"], "元/升")
        self.assertEqual(result["latest_date"], "2026-10-30")
        self.assertEqual(result["coverage_start"], "2026-09-12")
        for row in result["records"]:
            self.assertIs(type(row["p92"]), float)
            self.assertIs(type(row["p95"]), float)

    def test_zhejiang_has_its_own_public_observations(self):
        result = self.fetch(envelope(ZHEJIANG), province="浙江")
        self.assertEqual(result["records"][-1], {
            "effective_date": "2026-10-30", "p92": 8.85, "p95": 9.42,
        })

    def test_source_query_is_public_json_and_filters_requested_province(self):
        response = Response(envelope(ZHEJIANG))
        before = datetime.now(timezone.utc)
        with patch.object(self.oil, "urlopen", return_value=response) as network:
            result = self.oil.fetch_prices("浙江", timeout=7.5)
        after = datetime.now(timezone.utc)
        request = network.call_args.args[0]
        url = urlsplit(request.full_url)
        query = parse_qs(url.query)
        self.assertEqual(url.scheme, "https")
        self.assertEqual(url.netloc, "datacenter-web.eastmoney.com")
        self.assertEqual(query["reportName"], ["RPTA_WEB_YJ_JH"])
        self.assertEqual(query["columns"], ["DIM_DATE,CITYNAME,V92,V95"])
        self.assertEqual(query["filter"], ['(CITYNAME="浙江")'])
        self.assertNotIn("callback", query)
        self.assertGreater(network.call_args.kwargs["timeout"], 0)
        self.assertLessEqual(network.call_args.kwargs["timeout"], 7.5)
        self.assertEqual(result["source_url"], request.full_url)
        self.assertIn("东方财富", result["source"])
        fetched_at = datetime.fromisoformat(result["fetched_at"].replace("Z", "+00:00"))
        self.assertEqual(fetched_at.utcoffset().total_seconds(), 0)
        self.assertLessEqual(before, fetched_at)
        self.assertLessEqual(fetched_at, after)
        self.assertTrue(response.closed)
        self.assertTrue(all(0 < size <= 262145 for size in response.read_sizes))

    def test_supported_names_include_required_provinces_and_reject_unknowns(self):
        self.assertIsInstance(self.oil.PROVINCES, list)
        self.assertIn("浙江", self.oil.PROVINCES)
        self.assertIn("北京", self.oil.PROVINCES)
        self.assertEqual(len(self.oil.PROVINCES), len(set(self.oil.PROVINCES)))
        with patch.object(self.oil, "urlopen") as network:
            for province in ["", "浙江省", " 北京 ", "香港", "不存在", None, 12, []]:
                with self.subTest(province=province), self.assertRaises(ValueError):
                    self.oil.fetch_prices(province)
            network.assert_not_called()

    def test_invalid_timeouts_fail_before_network(self):
        with patch.object(self.oil, "urlopen") as network:
            for timeout in [0, -1, float("nan"), float("inf"), True, "12", None, 61, 10**400]:
                with self.subTest(timeout=timeout), self.assertRaises(ValueError):
                    self.oil.fetch_prices("北京", timeout=timeout)
            network.assert_not_called()

    def test_legacy_prices_are_excluded_without_inventing_missing_95(self):
        result = self.fetch(envelope(ZHEJIANG + [LEGACY_ZHEJIANG]), province="浙江")
        self.assertEqual(len(result["records"]), 3)
        self.assertIn("2017", result["notes"])
        self.assertIn("调整", result["notes"])
        self.assertEqual(result["records"][0]["effective_date"], "2026-09-12")

    def test_future_source_date_is_preserved_and_explicitly_flagged(self):
        with patch.object(self.oil, "datetime", wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 10, 29, 12, tzinfo=timezone.utc)
            result = self.fetch()
        self.assertEqual(result["latest_date"], "2026-10-30")
        self.assertTrue(result["latest_is_future"])
        self.assertIn("未来", result["notes"])
        # The date is taken verbatim from DIM_DATE, without subtracting a day.
        self.assertEqual(result["records"][-1]["effective_date"], "2026-10-30")

    def test_future_comparison_uses_china_calendar_date(self):
        with patch.object(self.oil, "datetime", wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 10, 29, 17, tzinfo=timezone.utc)
            result = self.fetch()
        self.assertFalse(result["latest_is_future"])

    def test_identical_dates_are_deduplicated(self):
        result = self.fetch(envelope(BEIJING + [BEIJING[0]]))
        self.assertEqual(len(result["records"]), 3)

    def test_conflicting_prices_on_one_date_raise(self):
        duplicate = {**BEIJING[0], "V92": 8.61}
        with self.assertRaises(self.oil.OilFetchError):
            self.fetch(envelope(BEIJING + [duplicate]))

    def test_pagination_collects_all_records(self):
        responses = [
            Response(envelope(BEIJING[:2], pages=2, count=3)),
            Response(envelope(BEIJING[2:], pages=2, count=3)),
        ]
        with patch.object(self.oil, "_PAGE_SIZE", 2), patch.object(
            self.oil, "urlopen", side_effect=responses
        ) as network:
            result = self.oil.fetch_prices("北京")
        self.assertEqual(len(result["records"]), 3)
        self.assertEqual(result["records"][0]["effective_date"], "2026-09-12")
        self.assertEqual(
            [parse_qs(urlsplit(call.args[0].full_url).query)["pageNumber"] for call in network.call_args_list],
            [["1"], ["2"]],
        )

    def test_pagination_changes_do_not_return_incomplete_success(self):
        responses = [
            Response(envelope(BEIJING[:2], pages=2, count=3)),
            Response(envelope(BEIJING[2:], pages=2, count=4)),
        ]
        with patch.object(self.oil, "_PAGE_SIZE", 2), patch.object(
            self.oil, "urlopen", side_effect=responses
        ), self.assertRaises(self.oil.OilFetchError):
            self.oil.fetch_prices("北京")

    def test_excessive_pagination_is_rejected(self):
        with patch.object(self.oil, "urlopen", return_value=Response(
            envelope(pages=1000000, count=500000000)
        )) as network, self.assertRaises(self.oil.OilFetchError):
            self.oil.fetch_prices("北京")
        self.assertEqual(network.call_count, 1)

    def test_pagination_shares_one_timeout_budget(self):
        with patch.object(self.oil, "_PAGE_SIZE", 2), patch.object(
            self.oil, "urlopen", return_value=Response(envelope(BEIJING[:2], pages=2, count=3))
        ) as network, patch.object(self.oil.time, "monotonic", side_effect=[0, 0, 13]), self.assertRaises(
            self.oil.OilFetchError
        ):
            self.oil.fetch_prices("北京", timeout=12)
        self.assertEqual(network.call_count, 1)

    def test_network_errors_are_wrapped(self):
        errors = [
            URLError("offline"), TimeoutError("timed out"), OSError("connection reset"),
            HTTPError("https://datacenter-web.eastmoney.com/", 503, "unavailable", {}, None),
        ]
        for error in errors:
            with self.subTest(error=type(error).__name__), patch.object(
                self.oil, "urlopen", side_effect=error
            ), self.assertRaises(self.oil.OilFetchError):
                self.oil.fetch_prices("北京")

    def test_body_and_declared_size_are_bounded(self):
        cases = [
            Response(b" " * 262145),
            Response(b"{}", headers={"Content-Length": "999999999"}),
            Response(b"{}", headers={"Content-Length": "invalid"}),
        ]
        for response in cases:
            with self.subTest(headers=response.headers), patch.object(
                self.oil, "urlopen", return_value=response
            ), self.assertRaises(self.oil.OilFetchError):
                self.oil.fetch_prices("北京")
            self.assertTrue(response.closed)
        self.assertEqual(cases[1].read_sizes, [])

    def test_non_json_or_invalid_utf8_is_rejected(self):
        for payload in [b"callback({})", b"<html>blocked</html>", b"\xff", b"{", b"null"]:
            with self.subTest(payload=payload), self.assertRaises(self.oil.OilFetchError):
                self.fetch(payload)

    def test_invalid_response_envelopes_are_rejected(self):
        cases = [
            {**envelope(), "success": False}, {**envelope(), "code": 1},
            {**envelope(), "result": None}, {**envelope(), "result": []},
            {**envelope(), "success": 1}, envelope([], count=0),
            envelope(count=4), envelope(pages=True), envelope(count=True),
            envelope(pages=0), envelope(pages=2),
        ]
        for payload in cases:
            with self.subTest(payload=payload), self.assertRaises(self.oil.OilFetchError):
                self.fetch(payload)

    def test_wrong_province_and_malformed_rows_fail(self):
        malformed = [None, [], "row", {**BEIJING[0], "CITYNAME": "浙江"}]
        missing = copy.deepcopy(BEIJING[0])
        del missing["V95"]
        malformed.append(missing)
        for row in malformed:
            with self.subTest(row=row), self.assertRaises(self.oil.OilFetchError):
                self.fetch(envelope([row]))

    def test_prices_must_be_finite_positive_numeric_yuan_per_litre(self):
        for value in [None, "8.89", "8.89元/升", True, 0, -1, 8850, float("nan"), float("inf")]:
            with self.subTest(value=value), self.assertRaises(self.oil.OilFetchError):
                self.fetch(envelope([{**BEIJING[0], "V92": value}]))
        with self.assertRaises(self.oil.OilFetchError):
            self.fetch(envelope([{**BEIJING[0], "V95": None}]))

    def test_dates_must_be_real_midnight_source_dates(self):
        for value in [None, "2026-02-30 00:00:00", "2026-10-30 24:00:00", "2026-10-30", "2026-10-30 12:30:00"]:
            with self.subTest(value=value), self.assertRaises(self.oil.OilFetchError):
                self.fetch(envelope([{**BEIJING[0], "DIM_DATE": value}]))

    def test_legacy_only_history_fails_instead_of_empty_success(self):
        with self.assertRaises(self.oil.OilFetchError):
            self.fetch(envelope([LEGACY_ZHEJIANG]), province="浙江")

    def test_http_failure_status_is_rejected(self):
        with patch.object(self.oil, "urlopen", return_value=Response(envelope(), status=503)), self.assertRaises(
            self.oil.OilFetchError
        ):
            self.oil.fetch_prices("北京")


if __name__ == "__main__":
    unittest.main()
