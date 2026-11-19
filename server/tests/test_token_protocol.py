import json
import unittest

from app.asr.deepgram_client import ProviderError, map_result
from app.auth.token import TokenLimiter, issue_token, validate_token
from app.config import Settings
from app.protocol import End, ProtocolError, Start, parse_control, validate_frame

SECRET = "test-only-secret-" * 4


class TokenTests(unittest.TestCase):
    def test_valid_expired_future_wrong_secret_tampering(self):
        token = issue_token(SECRET, now=100)
        self.assertTrue(validate_token(token, SECRET, now=100))
        self.assertTrue(validate_token(token, SECRET, now=159))
        for now in (99, 160, 161):
            self.assertFalse(validate_token(token, SECRET, now=now))
        self.assertFalse(validate_token(token, "wrong", now=100))
        self.assertFalse(validate_token("x" + token[1:], SECRET, now=100))
        self.assertFalse(validate_token(issue_token(SECRET, ttl=600, now=100), SECRET, now=100))

    def test_malformed_tokens_and_unique_nonce(self):
        for token in ("", "x", "a.b.c", "x.y", "x" * 513, "💡.x"):
            self.assertFalse(validate_token(token, SECRET))
        self.assertNotEqual(issue_token(SECRET), issue_token(SECRET))

    def test_rate_limit_and_bounded_ip_memory(self):
        limiter = TokenLimiter(2, max_clients=2)
        self.assertTrue(limiter.allow("one", now=0))
        self.assertTrue(limiter.allow("one", now=1))
        self.assertFalse(limiter.allow("one", now=2))
        self.assertTrue(limiter.allow("two", now=2))
        self.assertFalse(limiter.allow("three", now=3))
        self.assertTrue(limiter.allow("three", now=62))
        self.assertEqual(len(limiter.clients), 1)

    def test_secrets_are_required(self):
        for secret, key in (("change-me", "test"), (SECRET, "")):
            with self.assertRaises(ValueError):
                Settings(token_secret=secret, deepgram_key=key)

    def test_production_requires_one_exact_extension_origin_and_short_tokens(self):
        origin = "chrome-extension://" + "a" * 32
        settings = Settings(
            token_secret=SECRET,
            deepgram_key="mock",
            environment="production",
            allowed_origins=(origin,),
            token_ttl=60,
        )
        self.assertEqual(settings.allowed_origins, (origin,))
        for origins in ((), (origin, "chrome-extension://" + "b" * 32), ("https://example.com",)):
            with self.subTest(origins=origins), self.assertRaises(ValueError):
                Settings(
                    token_secret=SECRET,
                    deepgram_key="mock",
                    environment="production",
                    allowed_origins=origins,
                )
        for ttl in (0, 61):
            with self.subTest(ttl=ttl), self.assertRaises(ValueError):
                Settings(token_secret=SECRET, deepgram_key="mock", token_ttl=ttl)


class ProtocolTests(unittest.TestCase):
    def test_control_validation(self):
        self.assertIsInstance(parse_control('{"type":"start","sampleRate":16000}'), Start)
        self.assertIsInstance(parse_control('{"type":"end"}'), End)
        cases = [
            {},
            [],
            {"type": "other"},
            {"type": "end", "extra": 1},
            {"type": "start", "sampleRate": 8000},
            {"type": "start", "sampleRate": "16000"},
            {"type": "start", "sampleRate": 16000.0},
            {"type": "start", "sampleRate": 16000, "channels": 1},
            {"type": "start", "sampleRate": 16000, "meetingTitle": "x" * 201},
        ]
        for value in cases:
            with self.subTest(value=value), self.assertRaises(ProtocolError):
                parse_control(json.dumps(value))
        for value in ("bad-json", " " * 32769):
            with self.assertRaises(ProtocolError):
                parse_control(value)

    def test_frame_size_and_stereo_alignment(self):
        for size in (4, 400, 6400):
            validate_frame(bytes(size))
        for size in (0, 1, 2, 3, 5, 6399, 6404):
            with self.subTest(size=size), self.assertRaises(ProtocolError):
                validate_frame(bytes(size))

    def test_speaker_mapping_timestamps_and_blank_results(self):
        message = {
            "type": "Results",
            "channel_index": [0, 2],
            "channel": {"alternatives": [{"transcript": "hello"}]},
            "start": 1.25,
            "duration": 0.5,
            "is_final": True,
        }
        self.assertEqual(
            map_result(message, 9),
            {
                "type": "transcript",
                "seq": 9,
                "speaker": "local",
                "text": "hello",
                "startMs": 1250,
                "endMs": 1750,
                "final": True,
            },
        )
        message["channel_index"] = [1, 2]
        self.assertEqual(map_result(message, 10)["speaker"], "remote")
        message["channel"]["alternatives"][0]["transcript"] = "  "
        self.assertIsNone(map_result(message, 11))
        self.assertIsNone(map_result({"type": "Metadata"}, 12))
        with self.assertRaises(ProviderError):
            map_result({"type": "Error", "description": "private upstream text"}, 1)
        message["start"] = float("nan")
        with self.assertRaises(ProviderError):
            map_result(message, 1)
