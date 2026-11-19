import json
import unittest

from app.telemetry import event_record


class TelemetryTests(unittest.TestCase):
    def test_structured_events_allow_only_metrics_and_never_transcript_or_credentials(self):
        record = event_record(
            "session_failed",
            session_id="abc123",
            code="asr_unavailable",
            outcome="failed",
            duration_ms=1200,
            audio_frames=7,
            transcript="private meeting words",
            token="private-token",
            provider_error="private provider detail",
        )
        parsed = json.loads(record)
        self.assertEqual(parsed["event"], "session_failed")
        self.assertEqual(parsed["code"], "asr_unavailable")
        self.assertEqual(parsed["audio_frames"], 7)
        self.assertNotIn("transcript", parsed)
        self.assertNotIn("token", parsed)
        self.assertNotIn("provider_error", parsed)
        self.assertNotIn("private", record)

    def test_invalid_or_oversized_log_fields_are_omitted(self):
        parsed = json.loads(event_record("session", code="x" * 200, duration_ms=-1))
        self.assertNotIn("code", parsed)
        self.assertNotIn("duration_ms", parsed)
