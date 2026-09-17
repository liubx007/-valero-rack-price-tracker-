import unittest

from scripts.collect_regulated import find_breakdown_url


class BreakdownLinkTests(unittest.TestCase):
    def test_finds_current_breakdown_pdf(self):
        page = b'''<a href="/files/current.pdf">Breakdown - Gasoline prices</a>'''
        self.assertEqual(
            find_breakdown_url(page),
            "https://nserbt.ca/files/current.pdf",
        )

    def test_rejects_page_without_breakdown(self):
        with self.assertRaises(ValueError):
            find_breakdown_url(b"<html><body>No file</body></html>")


if __name__ == "__main__":
    unittest.main()
