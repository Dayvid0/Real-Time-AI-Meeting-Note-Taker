import asyncio
import unittest
from unittest.mock import patch

from app.config import Settings
from app.ws.session import relay_session


class SlowProvider:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        pass

    async def send(self, _frame):
        await asyncio.Event().wait()

    async def close_stream(self):
        pass

    async def keepalive(self):
        await asyncio.Event().wait()

    async def results(self):
        await asyncio.Event().wait()
        if False:
            yield {}


class FloodingSocket:
    def __init__(self):
        self.received = 0
        self.sent = []
        self.close_code = None

    async def receive(self):
        self.received += 1
        if self.received == 1:
            return {"type": "websocket.receive", "text": '{"type":"start","sampleRate":16000}'}
        return {"type": "websocket.receive", "bytes": bytes(6400)}

    async def send_json(self, message):
        self.sent.append(message)

    async def close(self, code):
        self.close_code = code


class BackpressureTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_provider_bounds_consumption_and_closes_instead_of_buffering(self):
        ws = FloodingSocket()
        config = Settings(
            token_secret="test-secret-" * 4, deepgram_key="mock", audio_queue_frames=2
        )
        with patch("app.ws.session.DeepgramClient", return_value=SlowProvider()):
            async with asyncio.timeout(3):
                await relay_session(ws, config)
        self.assertEqual(ws.sent[0]["type"], "ready")
        self.assertEqual(ws.sent[-1]["code"], "invalid_message")
        self.assertIn("backpressure", ws.sent[-1]["message"])
        self.assertEqual(ws.close_code, 1008)
        # Start + two queued frames + one in provider.send + one waiting to enqueue.
        self.assertLessEqual(ws.received, 5)
