import json
import logging
import time

logger = logging.getLogger("meeting_notes.events")

ALLOWED_FIELDS = {
    "session_id": str,
    "code": str,
    "outcome": str,
    "duration_ms": int,
    "audio_frames": int,
    "transcript_events": int,
    "final_transcripts": int,
    "reconnects": int,
    "partial": bool,
}


def event_record(event: str, **fields) -> str:
    record: dict[str, object] = {
        "timestamp": int(time.time()),
        "event": event[:80] if isinstance(event, str) else "invalid_event",
    }
    for key, expected in ALLOWED_FIELDS.items():
        value = fields.get(key)
        if expected is bool:
            if type(value) is bool:
                record[key] = value
        elif expected is int:
            if type(value) is int and value >= 0:
                record[key] = value
        elif isinstance(value, str) and value and len(value) <= 120:
            record[key] = value
    return json.dumps(record, separators=(",", ":"), sort_keys=True)


def log_event(event: str, **fields) -> None:
    logger.info(event_record(event, **fields))
