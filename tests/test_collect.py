import unittest
import json
import tempfile
from pathlib import Path

from scripts.collect import TERMINALS, nearest_terminal, rebuild_history


class ColumnMappingTests(unittest.TestCase):
    def test_exact_column_centers(self):
        for index, terminal in enumerate(TERMINALS):
            self.assertEqual(nearest_terminal(125.9 + 35.8 * index), terminal)

    def test_rejects_non_price_columns(self):
        self.assertIsNone(nearest_terminal(90))
        self.assertIsNone(nearest_terminal(770))


class E10HistoryTests(unittest.TestCase):
    def test_rebuild_history_keeps_only_e10(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            daily = output / "daily"
            daily.mkdir()
            snapshot = {
                "date": "2026-01-01",
                "prices": [
                    {"product": "E10", "terminal": "Halifax", "price": 130.0},
                    {"product": "RUL", "terminal": "Halifax", "price": 140.0},
                ],
            }
            (daily / "2026-01-01.json").write_text(json.dumps(snapshot), encoding="utf-8")

            rebuild_history(output)

            history = json.loads((output / "history.json").read_text(encoding="utf-8"))
            rebuilt = history["snapshots"][0]
            self.assertEqual(rebuilt["product"], "E10")
            self.assertEqual([row["product"] for row in rebuilt["prices"]], ["E10"])


if __name__ == "__main__":
    unittest.main()
