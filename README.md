# Rackline E10

Rackline E10 archives the daily [Valero Canadian terminal rack price PDF](https://valeroapps.valero.com/public/rpt_Terminal_Rack_Prices.pdf) and publishes a focused E10 price dashboard. Halifax is the primary reference terminal.

> Prices are Canadian cents per litre, before tax, EXW. This independent project is not affiliated with Valero. Official Valero price confirmations take precedence if values differ.

## Features

- Daily collection through GitHub Actions at 10:20 UTC
- Coordinate-based extraction from the source PDF's sparse terminal matrix
- E10-only historical snapshots with source SHA-256 provenance
- Halifax E10 as the primary headline and default trend series
- Terminal market average, range, coverage and exact quote comparisons
- Responsive, dependency-free GitHub Pages dashboard
- Automatic deployment after every update to `main`

## Local development

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python scripts/collect.py
python -m http.server 8000 --directory docs
```

Open <http://localhost:8000>.

To parse an already downloaded PDF:

```bash
python scripts/collect.py --pdf path/to/rpt_Terminal_Rack_Prices.pdf
```

## GitHub Pages setup

1. Push the repository to `main`.
2. Open **Settings → Pages**.
3. Select **GitHub Actions** under **Build and deployment → Source**.
4. Open **Settings → Actions → General** and enable **Read and write permissions**.
5. Run **Collect daily rack prices** once from the Actions tab.

The same workflow collects data, commits source changes and deploys the `docs` directory.

## Data layout

- `docs/data/daily/YYYY-MM-DD.json`: one complete E10 snapshot per effective date
- `docs/data/history.json`: merged history consumed by the dashboard
- `source_sha256`: source PDF fingerprint for change detection and auditability

Source PDFs are not committed by default, avoiding roughly 80 MB of repository growth per year. To archive the binary source files, run:

```bash
python scripts/collect.py --archive-pdf
```

## Parsing safeguards

The source PDF has a text layer, but ordinary extraction loses empty table cells. The parser maps values to 18 fixed terminal columns using page coordinates, validates the full source matrix, then retains E10 quotes only. If the PDF layout changes materially, collection fails rather than publishing questionable data.

## License

MIT
