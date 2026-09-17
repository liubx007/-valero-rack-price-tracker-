#!/usr/bin/env python3
"""Collect Nova Scotia Zone 1 regular-gasoline regulated price components."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path

import pdfplumber


LANDING_URL = (
    "https://nserbt.ca/nseb/mandates/gasoline-diesel-pricing/"
    "gasoline-diesel-prices-zone-map"
)
USER_AGENT = "Rackline-E10/1.0 (+https://github.com/liubx007/-valero-rack-price-tracker-)"


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() == "a":
            self._href = dict(attrs).get("href")
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._href is not None:
            self.links.append((self._href, " ".join(self._text).strip()))
            self._href = None
            self._text = []


def download(url: str, attempts: int = 4) -> bytes:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": USER_AGENT, "Cache-Control": "no-cache"},
            )
            with urllib.request.urlopen(request, timeout=40) as response:
                return response.read()
        except Exception as error:  # pragma: no cover - network retry path
            last_error = error
            if attempt + 1 < attempts:
                time.sleep(2**attempt)
    raise RuntimeError(f"unable to download {url}: {last_error}")


def find_breakdown_url(page: bytes) -> str:
    parser = LinkParser()
    parser.feed(page.decode("utf-8", errors="replace"))
    for href, text in parser.links:
        candidate = f"{href} {text}".lower()
        if "breakdown" in candidate and ".pdf" in candidate:
            return urllib.parse.urljoin(LANDING_URL, href)
    raise ValueError("could not find the current price-breakdown PDF link")


def _number(text: str, label: str, pattern: str) -> float:
    match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
    if not match:
        raise ValueError(f"missing regulated-price field: {label}")
    return float(match.group(1))


def parse_breakdown(payload: bytes) -> dict:
    from io import BytesIO

    with pdfplumber.open(BytesIO(payload)) as pdf:
        if len(pdf.pages) < 2:
            raise ValueError("regulated-price PDF does not contain the detailed breakdown")
        text = pdf.pages[1].extract_text() or ""

    date_match = re.search(r"Effective date:\s*([A-Za-z]+ \d{1,2}, \d{4})", text)
    if not date_match:
        raise ValueError("missing effective date in regulated-price PDF")
    effective_date = datetime.strptime(date_match.group(1), "%B %d, %Y").date().isoformat()

    values = {
        "benchmark_price": _number(text, "benchmark", r"^New Benchmark Price\s+(-?\d+(?:\.\d+)?)"),
        "forward_averaging_correction": _number(text, "forward averaging", r"^Forward Averaging Correction \(current week\)\s+(-?\d+(?:\.\d+)?)"),
        "transportation_adjustment": _number(text, "transportation", r"^Add: Transportation Adjustment\s+(-?\d+(?:\.\d+)?)"),
        "carbon_charge": _number(text, "carbon charge", r"^Add: Carbon Charge\s+(-?\d+(?:\.\d+)?)"),
        "clean_fuel_adjustor": _number(text, "clean fuel adjustor", r"^Add: Clean Fuel Adjustor\s+(-?\d+(?:\.\d+)?)"),
        "wholesale_margin": _number(text, "wholesale margin", r"^Add: Wholesale Margin\s+(-?\d+(?:\.\d+)?)"),
        "federal_excise_tax": _number(text, "federal excise tax", r"^Add: Federal Excise Tax\s+(-?\d+(?:\.\d+)?)"),
        "provincial_motive_fuel_tax": _number(text, "provincial fuel tax", r"^Add: Provincial Motive Fuel Tax\s+(-?\d+(?:\.\d+)?)"),
        "wholesale_selling_price": _number(text, "wholesale selling price", r"^Equals: Wholesale Selling price \(rounded\)\s+(-?\d+(?:\.\d+)?)"),
    }
    ranges: dict[str, tuple[float, float]] = {}
    for key, label in (
        ("retail_markup", "Retail Mark-up"),
        ("markup_adjustment", "Mark-up Adjustment"),
        ("hst", "HST"),
        ("pump_price", "Pump Price"),
    ):
        match = re.search(
            rf"^Add: {re.escape(label)}\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)"
            if key != "pump_price"
            else r"^Equals: Pump Price\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)",
            text,
            flags=re.IGNORECASE | re.MULTILINE,
        )
        if not match:
            raise ValueError(f"missing regulated-price range: {label}")
        ranges[key] = (float(match.group(1)), float(match.group(2)))

    calculated_min = round(
        values["wholesale_selling_price"]
        + ranges["retail_markup"][0]
        + ranges["markup_adjustment"][0]
        + ranges["hst"][0],
        1,
    )
    if abs(calculated_min - ranges["pump_price"][0]) > 0.11:
        raise ValueError(
            f"regulated-price components do not reconcile: {calculated_min} vs "
            f"{ranges['pump_price'][0]}"
        )

    return {
        "schema_version": 1,
        "effective_date": effective_date,
        "zone": 1,
        "market": "Halifax, Nova Scotia",
        "product": "Regular Unleaded Gasoline",
        "service": "Self-Service",
        "unit": "CAD cents/litre",
        **values,
        "base_wholesale_price": round(
            values["wholesale_selling_price"]
            - values["federal_excise_tax"]
            - values["provincial_motive_fuel_tax"],
            2,
        ),
        "retail_markup_min": ranges["retail_markup"][0],
        "retail_markup_max": ranges["retail_markup"][1],
        "markup_adjustment_min": ranges["markup_adjustment"][0],
        "markup_adjustment_max": ranges["markup_adjustment"][1],
        "hst_min": ranges["hst"][0],
        "hst_max": ranges["hst"][1],
        "pump_price_min": ranges["pump_price"][0],
        "pump_price_max": ranges["pump_price"][1],
    }


def write_snapshot(parsed: dict, payload: bytes, source_url: str, output: Path) -> bool:
    snapshot = {
        **parsed,
        "collected_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "landing_url": LANDING_URL,
        "source_url": source_url,
        "source_sha256": hashlib.sha256(payload).hexdigest(),
    }
    if output.exists():
        previous = json.loads(output.read_text(encoding="utf-8"))
        source_unchanged = previous.get("source_sha256") == snapshot["source_sha256"]
        schema_unchanged = all(previous.get(key) == value for key, value in parsed.items())
        if source_unchanged and schema_unchanged:
            return False
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, help="use a local breakdown PDF")
    parser.add_argument("--source-url", help="source URL when --pdf is supplied")
    parser.add_argument("--output", type=Path, default=Path("docs/data/regulated.json"))
    args = parser.parse_args()

    if args.pdf:
        source_url = args.source_url or LANDING_URL
        payload = args.pdf.read_bytes()
    else:
        source_url = find_breakdown_url(download(LANDING_URL))
        payload = download(source_url)
    parsed = parse_breakdown(payload)
    changed = write_snapshot(parsed, payload, source_url, args.output)
    print(json.dumps({"effective_date": parsed["effective_date"], "changed": changed}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
