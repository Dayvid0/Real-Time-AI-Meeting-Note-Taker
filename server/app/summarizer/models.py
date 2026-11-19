from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field


class ActionItem(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    owner: str = Field(min_length=1, max_length=200)
    task: str = Field(min_length=1, max_length=2000)
    due: str | None = Field(default=None, max_length=200)


class Notes(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    summary: str = Field(max_length=6000)
    decisions: list[Annotated[str, Field(max_length=2000)]] = Field(max_length=100)
    actionItems: list[ActionItem] = Field(max_length=100)


class ContextLine(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    speaker: str = Field(pattern=r"^(local|remote)$")
    text: str = Field(max_length=8000)
