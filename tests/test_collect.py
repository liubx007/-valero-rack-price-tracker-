import unittest

from scripts.collect import TERMINALS, nearest_terminal


class ColumnMappingTests(unittest.TestCase):
    def test_exact_column_centers(self):
        for index, terminal in enumerate(TERMINALS):
            self.assertEqual(nearest_terminal(125.9 + 35.8 * index), terminal)

    def test_rejects_non_price_columns(self):
        self.assertIsNone(nearest_terminal(90))
        self.assertIsNone(nearest_terminal(770))


if __name__ == "__main__":
    unittest.main()

