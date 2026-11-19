import json
import struct
import threading
import unittest
from dataclasses import replace
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import httpx
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from websockets.sync.server import serve

from app.auth.token import issue_token
from app.config import Settings
from app.main import create_app

SECRET = "test-only-secret-" * 4
ORIGIN = "chrome-extension://" + "a" * 32


def result(channel, text, final):
    return json.dumps(
        {
            "type": "Results",
            "channel_index": [channel, 2],
            "channel": {"alternatives": [{"transcript": text}]},
            "start": 0,
            "duration": 0.1,
            "is_final": final,
        }
    )


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.frames = []
        self.requests = []
        self.controls = []
        self.provider_connections = 0
        self.provider_fail = False
        self.keepalive = threading.Event()

        def upstream(ws):
            self.provider_connections += 1
            self.requests.append(ws.request)
            if self.provider_fail:
                ws.send(json.dumps({"type": "Error", "description": "sensitive provider details"}))
                return
            try:
                for message in ws:
                    if isinstance(message, bytes):
                        self.frames.append(message)
                        ws.send(result(0, "local interim", False))
                        ws.send(result(1, "remote interim", False))
                    else:
                        control = json.loads(message)
                        self.controls.append(control)
                        if control["type"] == "KeepAlive":
                            self.keepalive.set()
                        if control["type"] == "CloseStream":
                            ws.send(result(0, "local final", True))
                            ws.send(result(1, "remote final", True))
                            return
            except Exception:
                return  # Client intentionally closes the mock on validation errors.

        self.server = serve(upstream, "127.0.0.1", 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        port = self.server.socket.getsockname()[1]
        self.settings = Settings(
            token_secret=SECRET,
            deepgram_key="mock-key-only",
            deepgram_url=f"ws://127.0.0.1:{port}",
            allowed_origins=(ORIGIN,),
            keepalive_seconds=0.05,
            provider_timeout_seconds=1,
        )
        self.client = TestClient(create_app(self.settings))
        self.client.__enter__()

    def tearDown(self):
        self.client.__exit__(None, None, None)
        self.server.shutdown()
        self.thread.join(timeout=2)

    def connect(self, token=None):
        if token is None:
            token = self.client.post("/v1/token", headers={"Origin": ORIGIN}).json()["token"]
        return self.client.websocket_connect(
            "/v1/session",
            subprotocols=["meeting-notes.v1", f"auth.{token}"],
            headers={"Origin": ORIGIN},
        )

    def test_token_endpoint_rate_limit_and_origin(self):
        self.assertEqual(
            self.client.post("/v1/token", headers={"Origin": "https://evil.test"}).status_code, 403
        )
        response = self.client.post("/v1/token", headers={"Origin": ORIGIN})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(response.json()["expiresIn"], 60)
        for _ in range(9):
            self.assertEqual(self.client.post("/v1/token").status_code, 200)
        self.assertEqual(self.client.post("/v1/token").status_code, 429)

    def test_production_requires_the_exact_browser_origin_for_tokens(self):
        with TestClient(create_app(replace(self.settings, environment="production"))) as client:
            self.assertEqual(client.post("/v1/token").status_code, 403)
            self.assertEqual(
                client.post(
                    "/v1/token", headers={"Origin": "chrome-extension://" + "b" * 32}
                ).status_code,
                403,
            )
            self.assertEqual(client.post("/v1/token", headers={"Origin": ORIGIN}).status_code, 200)

    def test_production_websocket_rejects_missing_origin_before_provider(self):
        with TestClient(create_app(replace(self.settings, environment="production"))) as client:
            token = client.post("/v1/token", headers={"Origin": ORIGIN}).json()["token"]
            with self.assertRaises(WebSocketDisconnect):
                with client.websocket_connect(
                    "/v1/session", subprotocols=["meeting-notes.v1", f"auth.{token}"]
                ):
                    self.fail("Production WebSocket accepted without Origin")
        self.assertEqual(self.provider_connections, 0)

    def test_invalid_token_rejected_before_accept_and_before_provider(self):
        for token in ("invalid", issue_token(SECRET, now=1)):
            with self.assertRaises(WebSocketDisconnect):
                with self.connect(token):
                    self.fail("Unauthenticated upgrade accepted")
        self.assertEqual(self.provider_connections, 0)

    def test_audio_relay_speakers_and_final_drain(self):
        pcm = struct.pack("<hhhh", 1234, -2345, 32767, -32768)
        with self.connect() as ws:
            ws.send_json({"type": "start", "sampleRate": 16000, "channels": 2})
            self.assertEqual(ws.receive_json()["type"], "ready")
            ws.send_bytes(pcm)
            interim = [ws.receive_json(), ws.receive_json()]
            ws.send_json({"type": "end"})
            final = [ws.receive_json(), ws.receive_json()]
            self.assertEqual(ws.receive_json()["type"], "summary_status")
            self.assertEqual(ws.receive_json(), {"type": "complete"})
        self.assertEqual(self.frames, [pcm])
        self.assertEqual([m["speaker"] for m in interim + final], ["local", "remote"] * 2)
        self.assertEqual([m["seq"] for m in interim + final], [1, 2, 3, 4])
        self.assertEqual([m["final"] for m in interim + final], [False, False, True, True])
        query = parse_qs(urlparse(self.requests[0].path).query)
        for key, expected in {
            "model": "nova-3",
            "encoding": "linear16",
            "sample_rate": "16000",
            "channels": "2",
            "multichannel": "true",
            "diarize": "true",
            "interim_results": "true",
            "smart_format": "true",
            "endpointing": "300",
        }.items():
            self.assertEqual(query[key], [expected])
        self.assertEqual(self.requests[0].headers["Authorization"], "Token mock-key-only")

    def test_keepalive_when_no_audio(self):
        with self.connect() as ws:
            ws.send_json({"type": "start", "sampleRate": 16000})
            self.assertEqual(ws.receive_json()["type"], "ready")
            self.assertTrue(self.keepalive.wait(2))
            ws.send_json({"type": "end"})
            while ws.receive_json()["type"] != "complete":
                pass

    def test_invalid_controls_and_frames(self):
        for first in ([], {"type": "end"}, {"type": "start", "sampleRate": 8000}):
            with self.connect() as ws:
                ws.send_json(first)
                self.assertEqual(ws.receive_json()["code"], "invalid_message")
        for frame in (b"", b"xx", bytes(6404)):
            with self.connect() as ws:
                ws.send_json({"type": "start", "sampleRate": 16000})
                self.assertEqual(ws.receive_json()["type"], "ready")
                ws.send_bytes(frame)
                self.assertEqual(ws.receive_json()["code"], "invalid_message")
        with self.connect() as ws:
            ws.send_json({"type": "start", "sampleRate": 16000})
            ws.receive_json()
            ws.send_json({"type": "start", "sampleRate": 16000})
            self.assertEqual(ws.receive_json()["code"], "invalid_message")
        self.assertFalse(self.frames)

    def test_provider_failure_is_sanitized(self):
        self.provider_fail = True
        with self.connect() as ws:
            ws.send_json({"type": "start", "sampleRate": 16000})
            self.assertEqual(ws.receive_json()["type"], "ready")
            error = ws.receive_json()
            self.assertEqual(error["code"], "asr_unavailable")
            self.assertNotIn("sensitive", error["message"])


class NotesIntegrationTests(unittest.TestCase):
    setUp = SessionTests.setUp
    tearDown = SessionTests.tearDown
    connect = SessionTests.connect

    def test_model_failure_does_not_drop_final_transcripts_or_completion(self):
        from dataclasses import replace

        self.client.__exit__(None, None, None)
        self.client = TestClient(create_app(replace(self.settings, llm_key="mock-only")))
        self.client.__enter__()
        actual = httpx.AsyncClient
        with patch(
            "app.summarizer.client.httpx.AsyncClient",
            side_effect=lambda **kwargs: actual(
                transport=httpx.MockTransport(lambda _request: httpx.Response(503)), **kwargs
            ),
        ):
            with self.connect() as ws:
                ws.send_json({"type": "start", "sampleRate": 16000})
                ws.receive_json()
                ws.send_bytes(bytes(6400))
                ws.receive_json()
                ws.receive_json()
                ws.send_json({"type": "end"})
                events = []
                while True:
                    event = ws.receive_json()
                    events.append(event)
                    if event["type"] == "complete":
                        break
        self.assertEqual(
            [event["speaker"] for event in events if event["type"] == "transcript"],
            ["local", "remote"],
        )
        self.assertEqual(
            next(event for event in events if event["type"] == "summary_status")["reason"],
            "provider_failed",
        )
        self.assertEqual(events[-1]["type"], "complete")

    def test_final_notes_follow_transcript_drain_and_precede_complete(self):
        from dataclasses import replace

        self.client.__exit__(None, None, None)
        self.client = TestClient(create_app(replace(self.settings, llm_key="mock-only")))
        self.client.__enter__()
        captured = []

        def handler(request):
            captured.append(json.loads(request.content))
            return httpx.Response(
                200,
                json={
                    "choices": [
                        {
                            "finish_reason": "stop",
                            "message": {
                                "content": json.dumps(
                                    {"summary": "Ready", "decisions": [], "actionItems": []}
                                )
                            },
                        }
                    ]
                },
            )

        actual = httpx.AsyncClient
        with patch(
            "app.summarizer.client.httpx.AsyncClient",
            side_effect=lambda **kwargs: actual(transport=httpx.MockTransport(handler), **kwargs),
        ):
            with self.connect() as ws:
                ws.send_json({"type": "start", "sampleRate": 16000})
                ws.receive_json()
                ws.send_json({"type": "end"})
                events = []
                while True:
                    event = ws.receive_json()
                    events.append(event)
                    if event["type"] == "complete":
                        break
        types = [event["type"] for event in events]
        self.assertLess(types.index("transcript"), types.index("notes"))
        self.assertLess(types.index("notes"), types.index("complete"))
        payload = json.loads(captured[0]["messages"][1]["content"].splitlines()[2])
        self.assertEqual(len(payload["new_transcript"]), 2)
