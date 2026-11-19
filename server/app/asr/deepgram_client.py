import asyncio
import json
import math
import time
from urllib.parse import urlencode

from websockets.asyncio.client import connect

from app.config import Settings


class ProviderError(Exception):
    pass


def map_result(message: dict, seq: int) -> dict | None:
    if message.get("type") == "Error":
        raise ProviderError("Transcription provider returned an error")
    if message.get("type") != "Results":
        return None
    try:
        channel = message["channel_index"][0]
        text = message["channel"]["alternatives"][0]["transcript"]
        start, duration = message["start"], message["duration"]
        final = message["is_final"]
        if (
            type(channel) is not int
            or channel not in (0, 1)
            or not isinstance(text, str)
            or type(final) is not bool
            or type(start) not in (int, float)
            or type(duration) not in (int, float)
            or not math.isfinite(start)
            or not math.isfinite(duration)
            or start < 0
            or duration < 0
        ):
            raise ValueError
        if not text.strip():
            return None
        return {
            "type": "transcript",
            "seq": seq,
            "speaker": "local" if channel == 0 else "remote",
            "text": text,
            "startMs": round(start * 1000),
            "endMs": round((start + duration) * 1000),
            "final": final,
        }
    except (KeyError, IndexError, TypeError, ValueError) as exc:
        raise ProviderError("Invalid transcription provider response") from exc


class DeepgramClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.socket = None
        self.last_audio = time.monotonic()
        self.send_lock = asyncio.Lock()

    async def __aenter__(self):
        query = urlencode(
            {
                "model": "nova-3",
                "encoding": "linear16",
                "sample_rate": "16000",
                "channels": "2",
                "multichannel": "true",
                "diarize": "true",
                "interim_results": "true",
                "smart_format": "true",
                "endpointing": "300",
            }
        )
        self.socket = await connect(
            f"{self.settings.deepgram_url}?{query}",
            additional_headers={"Authorization": f"Token {self.settings.deepgram_key}"},
            open_timeout=self.settings.provider_timeout_seconds,
            close_timeout=2,
            max_size=1_048_576,
            max_queue=16,
            proxy=None,
        )
        return self

    async def __aexit__(self, *_):
        if self.socket is not None:
            await self.socket.close()

    async def send(self, value: bytes | str):
        async with self.send_lock:
            await self.socket.send(value)
            if isinstance(value, bytes):
                self.last_audio = time.monotonic()

    async def close_stream(self):
        await self.send(json.dumps({"type": "CloseStream"}))

    async def keepalive(self):
        while True:
            await asyncio.sleep(self.settings.keepalive_seconds)
            if time.monotonic() - self.last_audio >= self.settings.keepalive_seconds:
                await self.send(json.dumps({"type": "KeepAlive"}))

    async def results(self):
        seq = 0
        async for raw in self.socket:
            try:
                message = json.loads(raw)
                if not isinstance(message, dict):
                    raise ValueError
            except (ValueError, UnicodeError) as exc:
                raise ProviderError("Invalid transcription provider response") from exc
            mapped = map_result(message, seq + 1)
            if mapped is not None:
                seq += 1
                yield mapped
