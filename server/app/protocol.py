import json
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.summarizer.models import ContextLine

SAMPLE_RATE = 16_000
CHANNELS = 2
MAX_FRAME_BYTES = 6_400  # 100 ms of interleaved stereo PCM16.
MAX_CONTROL_BYTES = 32_768


class ProtocolError(Exception):
    pass


class Start(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["start"]
    sampleRate: Literal[16000]
    channels: Literal[2] = 2
    meetingTitle: str | None = Field(default=None, max_length=200)
    notesContext: list[ContextLine] = Field(default_factory=list, max_length=300)
    notesPartial: bool = False
    notesBudget: int | None = Field(default=None, ge=0, le=1000000)


class End(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    type: Literal["end"]


def parse_control(text: str) -> Start | End:
    if len(text.encode()) > MAX_CONTROL_BYTES:
        raise ProtocolError("Control message exceeds 32768 bytes")
    try:
        data = json.loads(text)
        if not isinstance(data, dict):
            raise ValueError
        # Literal integer validation also accepts floats in some Pydantic versions.
        if data.get("type") == "start":
            if type(data.get("sampleRate")) is not int or type(data.get("channels", 2)) is not int:
                raise ValueError
            return Start.model_validate(data)
        if data.get("type") == "end":
            return End.model_validate(data)
        raise ValueError
    except (ValueError, ValidationError) as exc:
        raise ProtocolError("Invalid control message") from exc


def validate_frame(frame: bytes) -> None:
    if not frame or len(frame) > MAX_FRAME_BYTES or len(frame) % (CHANNELS * 2):
        raise ProtocolError("Audio must be 1–1600 stereo PCM16 samples (4–6400 bytes)")
