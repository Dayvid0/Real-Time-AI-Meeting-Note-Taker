import asyncio
import contextlib
import secrets
import time

from fastapi import WebSocket, WebSocketDisconnect
from websockets.exceptions import ConnectionClosed

from app.asr.deepgram_client import DeepgramClient, ProviderError
from app.config import Settings
from app.protocol import End, ProtocolError, Start, parse_control, validate_frame
from app.summarizer.session import MeetingSummarizer
from app.telemetry import log_event


async def _receive(ws: WebSocket) -> dict:
    message = await ws.receive()
    if message["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(message.get("code", 1000))
    return message


async def relay_session(ws: WebSocket, settings: Settings):
    tasks: list[asyncio.Task] = []
    rolling = None
    send_lock = asyncio.Lock()
    session_id = secrets.token_hex(6)
    started = time.monotonic()
    audio_frames = 0
    transcript_events = 0
    final_transcripts = 0
    outcome = "disconnected"
    failure_code = ""

    async def send(message):
        async with send_lock:
            await ws.send_json(message)

    try:
        async with asyncio.timeout(10):
            first = await _receive(ws)
        if first.get("text") is None:
            raise ProtocolError("First message must be start")
        control = parse_control(first["text"])
        if not isinstance(control, Start):
            raise ProtocolError("First message must be start")
        summarizer = MeetingSummarizer(
            settings,
            send,
            context=[line.model_dump() for line in control.notesContext],
            partial=control.notesPartial,
            budget=control.notesBudget,
        )
        queue: asyncio.Queue[bytes | None] = asyncio.Queue(settings.audio_queue_frames)
        ending = asyncio.Event()
        async with DeepgramClient(settings) as provider:
            await send({"type": "ready", "sampleRate": 16000, "channels": 2})
            rolling = asyncio.create_task(summarizer.rolling())

            async def receive_audio():
                nonlocal audio_frames
                while True:
                    message = await _receive(ws)
                    frame = message.get("bytes")
                    if frame is not None:
                        validate_frame(frame)
                    elif message.get("text") is not None:
                        if not isinstance(parse_control(message["text"]), End):
                            raise ProtocolError("Only end is allowed after start")
                        ending.set()
                        frame = None
                    else:
                        raise ProtocolError("Expected audio or end")
                    try:
                        async with asyncio.timeout(1):
                            await queue.put(frame)
                    except TimeoutError as exc:
                        raise ProtocolError("Audio backpressure limit reached") from exc
                    if frame is None:
                        return
                    audio_frames += 1

            async def forward_audio():
                while (frame := await queue.get()) is not None:
                    await provider.send(frame)
                await provider.close_stream()

            async def forward_results():
                nonlocal transcript_events, final_transcripts
                async for result in provider.results():
                    transcript_events += 1
                    final_transcripts += int(result["final"])
                    await send(result)
                    summarizer.add(result)

            incoming = asyncio.create_task(receive_audio())
            outgoing = asyncio.create_task(forward_audio())
            results = asyncio.create_task(forward_results())
            heartbeat = asyncio.create_task(provider.keepalive())
            tasks = [incoming, outgoing, results, heartbeat]
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                task.result()
            if not ending.is_set():
                raise ProviderError("Transcription connection ended early")
            # Drain queued audio and let Deepgram emit final Results before closing downstream.
            heartbeat.cancel()
            async with asyncio.timeout(settings.provider_timeout_seconds):
                await incoming
                await outgoing
                await results
            rolling.cancel()
            await asyncio.gather(rolling, return_exceptions=True)
            # ASR has fully drained. Notes can fail independently after all transcripts are sent.
            try:
                async with asyncio.timeout(30):
                    await summarizer.update(final=True)
            except TimeoutError:
                await send(
                    {
                        "type": "summary_status",
                        "kind": "final",
                        "status": "unavailable",
                        "reason": "timeout",
                    }
                )
            await send({"type": "complete"})
            outcome = "complete"
            await ws.close(code=1000)
    except WebSocketDisconnect:
        pass
    except ProtocolError as exc:
        outcome = "failed"
        failure_code = "invalid_message"
        await _fail(ws, "invalid_message", str(exc), 1008)
    except (ProviderError, ConnectionClosed, TimeoutError, OSError):
        outcome = "failed"
        failure_code = "asr_unavailable"
        await _fail(ws, "asr_unavailable", "Transcription connection unavailable; try again", 1011)
    except Exception:
        # Do not include upstream errors, tokens, audio or transcript content in logs/responses.
        outcome = "failed"
        failure_code = "session_failed"
        await _fail(ws, "session_failed", "The transcription session could not continue", 1011)
    finally:
        if rolling is not None:
            tasks.append(rolling)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        log_event(
            "relay_session",
            session_id=session_id,
            outcome=outcome,
            code=failure_code,
            duration_ms=round((time.monotonic() - started) * 1000),
            audio_frames=audio_frames,
            transcript_events=transcript_events,
            final_transcripts=final_transcripts,
        )


async def _fail(ws: WebSocket, code: str, message: str, close_code: int):
    with contextlib.suppress(WebSocketDisconnect, RuntimeError, OSError):
        await ws.send_json({"type": "error", "code": code, "message": message})
        await ws.close(code=close_code)
