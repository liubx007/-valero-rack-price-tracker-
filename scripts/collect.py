#!/usr/bin/env python3
"""Download and parse Valero's Canadian terminal rack price PDF."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
import re
import shutil
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import pdfplumber

SOURCE_URL = "https://valeroapps.valero.com/public/rpt_Terminal_Rack_Prices.pdf"
TERMINALS = [
    "Montreal", "Quebec", "Sept-Iles", "Toronto", "Hamilton", "Nanticoke",
    "London", "Sarnia", "Ottawa", "Maitland", "Belleville", "Halifax",
    "Sydney", "Saint John", "Chatham", "Charlottetown", "Corner Brook",
    "St. John's",
]
COLUMN_CENTERS = [125.9 + 35.8 * i for i in range(len(TERMINALS))]
PRICE_RE = re.compile(r"^\d{2,3}\.\d{2}$")
DATE_RE = re.compile(r"\b(20\d{2}-\d{2}-\d{2})\b")
TIME_RE = re.compile(r"\b(\d{1,2}:\d{2}:\d{2}\s+[AP]M)\b")


def download_pdf(url: str = SOURCE_URL, attempts: int = 3) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "valero-rack-price-tracker/1.0 (+GitHub Actions)"},
    )
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = response.read()
            if not payload.startswith(b"%PDF"):
                raise ValueError("downloaded file is not a PDF")
            return payload
        except Exception as exc:  # network errors differ by platform
            last_error = exc
            if attempt + 1 < attempts:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"unable to download source PDF: {last_error}")


def nearest_terminal(x_center: float) -> str | None:
    index = min(range(len(COLUMN_CENTERS)), key=lambda i: abs(COLUMN_CENTERS[i] - x_center))
    return TERMINALS[index] if abs(COLUMN_CENTERS[index] - x_center) <= 8 else None


def parse_pdf(payload: bytes) -> dict:
    with pdfplumber.open(io.BytesIO(payload)) as pdf:
        if not pdf.pages:
            raise ValueError("PDF has no pages")
        page = pdf.pages[0]
        text = page.extract_text() or ""
        words = page.extract_words(use_text_flow=False, keep_blank_chars=False)

    date_match = DATE_RE.search(text)
    if not date_match:
        raise ValueError("effective date not found")
    effective_date = date_match.group(1)
    time_match = TIME_RE.search(text)
    effective_time = time_match.group(1) if time_match else "12:00:00 AM"

    row_tops: list[float] = []
    for word in words:
        if 90 <= word["top"] <= 430 and word["x1"] < 105:
            top = float(word["top"])
            if not any(abs(existing - top) <= 1.0 for existing in row_tops):
                row_tops.append(top)

    prices: list[dict] = []
    products: list[str] = []
    for top in sorted(row_tops):
        same_row = [word for word in words if abs(float(word["top"]) - top) <= 1.0]
        product_words = sorted(
            (word for word in same_row if word["x1"] < 105), key=lambda word: word["x0"]
        )
        product = " ".join(word["text"] for word in product_words).strip()
        if not product:
            continue
        products.append(product)
        for word in same_row:
            if not PRICE_RE.fullmatch(word["text"]):
                continue
            terminal = nearest_terminal((float(word["x0"]) + float(word["x1"])) / 2)
            if terminal:
                prices.append(
                    {"product": product, "terminal": terminal, "price": float(word["text"])}
                )

    if len(set(products)) < 20 or len(prices) < 50:
        raise ValueError(
            f"parser sanity check failed: {len(set(products))} products, {len(prices)} prices"
        )
    invalid = [row for row in prices if not math.isfinite(row["price"]) or not 50 <= row["price"] <= 300]
    if invalid:
        raise ValueError(f"implausible price values: {invalid[:3]}")

    e10_prices = [row for row in prices if row["product"] == "E10"]
    if len(e10_prices) < 10:
        raise ValueError(f"E10 sanity check failed: only {len(e10_prices)} terminal quotes")

    return {
        "date": effective_date,
        "effective_time": effective_time,
        "unit": "CAD cents/litre before tax",
        "product": "E10",
        "prices": e10_prices,
    }


def write_snapshot(parsed: dict, payload: bytes, output_dir: Path) -> bool:
    output_dir.mkdir(parents=True, exist_ok=True)
    daily_dir = output_dir / "daily"
    daily_dir.mkdir(exist_ok=True)
    digest = hashlib.sha256(payload).hexdigest()
    destination = daily_dir / f"{parsed['date']}.json"

    snapshot = {
        **parsed,
        "collected_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "source_url": SOURCE_URL,
        "source_sha256": digest,
    }
    if destination.exists():
        previous = json.loads(destination.read_text(encoding="utf-8"))
        is_e10_only = all(row.get("product") == "E10" for row in previous.get("prices", []))
        if previous.get("source_sha256") == digest and is_e10_only:
            rebuild_history(output_dir)
            return False

    destination.write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    rebuild_history(output_dir)
    return True


def rebuild_history(output_dir: Path) -> None:
    snapshots = []
    for path in sorted((output_dir / "daily").glob("*.json")):
        snapshot = json.loads(path.read_text(encoding="utf-8"))
        snapshot["product"] = "E10"
        snapshot["prices"] = [row for row in snapshot.get("prices", []) if row.get("product") == "E10"]
        path.write_text(
            json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        snapshots.append(snapshot)
    history = {
        "schema_version": 1,
        "source_url": SOURCE_URL,
        "snapshots": snapshots,
    }
    (output_dir / "history.json").write_text(
        json.dumps(history, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, help="use a local PDF instead of downloading")
    parser.add_argument("--output-dir", type=Path, default=Path("docs/data"))
    parser.add_argument("--archive-pdf", action="store_true", help="store the source PDF by date")
    args = parser.parse_args()

    payload = args.pdf.read_bytes() if args.pdf else download_pdf()
    parsed = parse_pdf(payload)
    changed = write_snapshot(parsed, payload, args.output_dir)
    if args.archive_pdf:
        archive = args.output_dir / "pdf" / f"{parsed['date']}.pdf"
        archive.parent.mkdir(parents=True, exist_ok=True)
        archive.write_bytes(payload)
    print(
        json.dumps(
            {"date": parsed["date"], "prices": len(parsed["prices"]), "changed": changed}
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
