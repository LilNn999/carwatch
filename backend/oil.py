"""Public provincial 92/95 petrol adjustment history, using only the stdlib.

Source page: https://data.eastmoney.com/cjsj/oil_city.html
The page's oil_city.js uses the public RPTA_WEB_YJ_JH report. V92 and V95
are prices in yuan/litre; QE* and ZDE* are previous prices and changes.
DIM_DATE is the source's local adjustment/effective calendar date. Preserve
it verbatim rather than interpreting it as UTC, subtracting a day, or
replacing it with the retrieval date.

Only observations dated 2017-01-01 onward are returned: earlier values in
the same series can describe legacy 93/97 grades. These are adjustment
observations, not a complete daily history or individual station quotes.
This module performs no caching, disk writes, or database operations.
"""

from __future__ import annotations

import json
import math
import time
from datetime import date, datetime, timedelta, timezone
from http.client import HTTPException
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


# Canonical names exposed by the source's RPTA_WEB_YJ_DQ province selector.
PROVINCES = [
    "安徽", "北京", "重庆", "福建", "广西", "甘肃", "广东", "贵州", "海南", "黑龙江",
    "河北", "河南", "湖北", "湖南", "吉林", "江苏", "江西", "辽宁", "内蒙古", "宁夏",
    "青海", "陕西", "上海", "山东", "四川", "山西", "天津", "西藏", "新疆", "云南", "浙江",
]

_ENDPOINT = "https://datacenter-web.eastmoney.com/api/data/v1/get"
_PAGE_SIZE = 500
_MAX_PAGES = 10
_MAX_RESPONSE_BYTES = 256 * 1024
_HISTORY_START = date(2017, 1, 1)
_CHINA_TZ = timezone(timedelta(hours=8))


class OilFetchError(RuntimeError):
    """The public source could not be fetched or failed data validation."""


def _query_url(province: str, page_number: int) -> str:
    return _ENDPOINT + "?" + urlencode({
        "reportName": "RPTA_WEB_YJ_JH",
        "columns": "DIM_DATE,CITYNAME,V92,V95",
        "sortColumns": "DIM_DATE",
        "sortTypes": -1,
        "filter": f'(CITYNAME="{province}")',
        "pageNumber": page_number,
        "pageSize": _PAGE_SIZE,
        "source": "WEB",
    })


def _reject_nonfinite(value: str) -> None:
    raise ValueError(f"Non-finite JSON number: {value}")


def _read_json(url: str, timeout: float) -> dict:
    request = Request(url, headers={
        "User-Agent": "Mozilla/5.0",
        "Accept": "application/json",
        "Accept-Encoding": "identity",
        "Referer": "https://data.eastmoney.com/cjsj/oil_city.html",
    })
    try:
        with urlopen(request, timeout=timeout) as response:
            if response.status != 200:
                raise OilFetchError(f"Oil source returned HTTP {response.status}")
            length = response.headers.get("Content-Length")
            if length is not None and not 0 <= int(length) <= _MAX_RESPONSE_BYTES:
                raise OilFetchError("Oil source response exceeds the byte limit")
            raw = response.read(_MAX_RESPONSE_BYTES + 1)
            if len(raw) > _MAX_RESPONSE_BYTES:
                raise OilFetchError("Oil source response exceeds the byte limit")
    except (URLError, OSError, HTTPException, ValueError) as exc:
        raise OilFetchError(f"Could not read public oil source: {exc}") from exc

    try:
        payload = json.loads(raw.decode("utf-8"), parse_constant=_reject_nonfinite)
    except (ValueError, UnicodeError, RecursionError) as exc:
        raise OilFetchError("Oil source did not return valid UTF-8 JSON") from exc
    if not isinstance(payload, dict):
        raise OilFetchError("Oil source returned an invalid JSON envelope")
    return payload


def _page_data(payload: dict, page_number: int) -> tuple[int, int, list]:
    if payload.get("success") is not True or type(payload.get("code")) is not int or payload["code"] != 0:
        raise OilFetchError("Oil source reported an unsuccessful query")
    result = payload.get("result")
    if not isinstance(result, dict):
        raise OilFetchError("Oil source is missing its result object")
    pages, count, rows = result.get("pages"), result.get("count"), result.get("data")
    if type(pages) is not int or not 1 <= pages <= _MAX_PAGES:
        raise OilFetchError("Oil source page count is invalid or exceeds the limit")
    if type(count) is not int or not 1 <= count <= _PAGE_SIZE * _MAX_PAGES:
        raise OilFetchError("Oil source record count is invalid or exceeds the limit")
    if pages != (count + _PAGE_SIZE - 1) // _PAGE_SIZE:
        raise OilFetchError("Oil source pagination does not match its record count")
    expected = min(_PAGE_SIZE, count - (page_number - 1) * _PAGE_SIZE)
    if not isinstance(rows, list) or len(rows) != expected:
        raise OilFetchError("Oil source page is empty or incomplete")
    return pages, count, rows


def _record(row: dict, province: str) -> dict | None:
    if not isinstance(row, dict) or row.get("CITYNAME") != province:
        raise OilFetchError("Oil source returned an invalid row or a different province")
    timestamp = row.get("DIM_DATE")
    try:
        if not isinstance(timestamp, str):
            raise ValueError("Missing source date")
        effective_date = date.fromisoformat(timestamp[:10])
        if timestamp != effective_date.isoformat() + " 00:00:00":
            raise ValueError("Unexpected source date format or time")
    except ValueError as exc:
        raise OilFetchError("Oil source returned an invalid adjustment date") from exc
    if effective_date < _HISTORY_START:
        return None

    prices = []
    for field in ("V92", "V95"):
        value = row.get(field)
        # The observed schema uses JSON numbers, not formatted price strings.
        # Reject tonne-scale values and non-finite/missing data rather than
        # guessing units, converting a null to zero, or filling forward.
        if type(value) not in (int, float) or not 0 < value < 100 or not math.isfinite(value):
            raise OilFetchError(f"Oil source returned an invalid yuan/litre price for {field}")
        prices.append(float(value))
    return {"effective_date": effective_date.isoformat(), "p92": prices[0], "p95": prices[1]}


def fetch_prices(province: str, *, timeout: float = 12) -> dict:
    """Fetch all supported adjustment observations for one canonical province.

    ``timeout`` must be a finite number in (0, 60] seconds. It is shared
    across page requests; each urllib call receives only the time remaining.
    At most 10 pages of 500 rows and 256 KiB per response are accepted. A
    changed/incomplete page set fails rather than returning a partial history.

    Required result keys are province, source, source_url, fetched_at (UTC
    retrieval time), and records. Records are unique by date and sorted
    ascending. Extra metadata explains the units, actual coverage, and any
    source-published future effective date. Such a date is retained and
    flagged; latest_date must not automatically be treated as today's price.

    Raises ValueError for unsupported input and OilFetchError for network or
    source/schema failures. Callers own caching and persistence.
    """
    if not isinstance(province, str) or province not in PROVINCES:
        raise ValueError("Unsupported province; choose a canonical name from PROVINCES")
    if type(timeout) not in (int, float) or not 0 < timeout <= 60:
        raise ValueError("timeout must be a finite number greater than 0 and at most 60 seconds")

    deadline = time.monotonic() + float(timeout)
    source_url = _query_url(province, 1)
    by_date = {}
    metadata = None
    page_number = 1
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise OilFetchError("Oil source fetch exceeded its timeout budget")
        payload = _read_json(_query_url(province, page_number), remaining)
        pages, count, rows = _page_data(payload, page_number)
        if metadata is not None and metadata != (pages, count):
            raise OilFetchError("Oil source history changed during pagination; retry the fetch")
        metadata = (pages, count)
        for row in rows:
            record = _record(row, province)
            if record is None:
                continue
            key = record["effective_date"]
            if key in by_date and by_date[key] != record:
                raise OilFetchError("Oil source returned conflicting prices for one date")
            by_date[key] = record
        if time.monotonic() > deadline:
            raise OilFetchError("Oil source fetch exceeded its timeout budget")
        if page_number == pages:
            break
        page_number += 1

    if not by_date:
        raise OilFetchError("Oil source has no supported 92/95 history since 2017")
    records = [by_date[key] for key in sorted(by_date)]
    fetched_at = datetime.now(timezone.utc)
    latest_date = records[-1]["effective_date"]
    latest_is_future = latest_date > fetched_at.astimezone(_CHINA_TZ).date().isoformat()
    notes = (
        "单位为元/升；日期沿用来源的调整生效日，记录为调价观测，非逐日或单站成交价。"
        "仅返回2017-01-01及以后记录，避免把早期93/97号历史系列当作92/95号；"
        "实际覆盖范围以首末记录为准，不补齐缺失日期。"
    )
    if latest_is_future:
        notes += "最新记录为来源公布的未来生效日，不代表今日已执行价格。"
    return {
        "province": province,
        "source": "东方财富网（Choice数据）",
        "source_url": source_url,
        "fetched_at": fetched_at.isoformat().replace("+00:00", "Z"),
        "records": records,
        "unit": "元/升",
        "coverage_start": records[0]["effective_date"],
        "latest_date": latest_date,
        "latest_is_future": latest_is_future,
        "notes": notes,
    }
