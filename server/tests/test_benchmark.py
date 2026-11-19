import unittest

from benchmarks.report import percentile, summarize


class BenchmarkReportTests(unittest.TestCase):
    def test_percentiles_and_hourly_cost_are_computed_from_observed_runs(self):
        report = summarize(
            latencies_ms=[120, 300, 500, 900, 2000],
            audio_seconds=600,
            transcription_cost=0.01,
            notes_cost=0.0,
        )
        self.assertEqual(percentile([1, 2, 3, 4], 50), 2.5)
        self.assertEqual(report["latency_ms"]["p50"], 500)
        self.assertEqual(report["latency_ms"]["p95"], 1780)
        self.assertAlmostEqual(report["estimated_cost_per_hour_usd"], 0.06)
        self.assertTrue(report["latency_target_met"])
        self.assertTrue(report["cost_target_met"])

    def test_empty_or_invalid_observations_are_rejected(self):
        with self.assertRaises(ValueError):
            summarize([], 60, 0, 0)
        with self.assertRaises(ValueError):
            summarize([100], 0, 0, 0)
