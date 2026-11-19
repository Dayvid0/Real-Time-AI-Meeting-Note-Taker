import json

import httpx
from pydantic import ValidationError

from app.config import Settings
from app.summarizer.models import Notes


class SummaryUnavailable(Exception):
    pass


class NotesClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.remaining = settings.llm_token_budget

    async def generate(self, messages: list[dict], final: bool = False, on_budget=None) -> Notes:
        if not self.settings.llm_key:
            raise SummaryUnavailable("not_configured")
        # UTF-8 bytes conservatively bound input tokens; reserve output before every attempt.
        # Retries are charged too, including failed requests. This is a guard, not a billing meter.
        charge = len(json.dumps(messages, ensure_ascii=False).encode()) + 1600 + 256
        reserve = 0 if final else min(20000, self.settings.llm_token_budget // 3)
        for attempt in range(2):
            if self.remaining - charge < reserve:
                raise SummaryUnavailable("budget_exhausted")
            self.remaining -= charge
            if on_budget is not None:
                await on_budget(self.remaining)
            try:
                async with httpx.AsyncClient(
                    timeout=self.settings.llm_timeout_seconds, trust_env=False
                ) as client:
                    async with client.stream(
                        "POST",
                        self.settings.llm_base_url.rstrip("/") + "/chat/completions",
                        headers={"Authorization": "Bearer " + self.settings.llm_key},
                        json={
                            "model": self.settings.llm_model,
                            "messages": messages,
                            "response_format": {"type": "json_object"},
                            "max_tokens": 1600,
                        },
                    ) as response:
                        response.raise_for_status()
                        raw = bytearray()
                        async for chunk in response.aiter_bytes():
                            raw.extend(chunk)
                            if len(raw) > 262144:
                                raise SummaryUnavailable("provider_failed")
                data = json.loads(raw)
                choice = data["choices"][0]
                if choice.get("finish_reason") != "stop":
                    raise ValueError("Incomplete result")
                content = choice["message"]["content"]
                return Notes.model_validate_json(content)
            except (ValidationError, ValueError, KeyError, IndexError, TypeError):
                if attempt:
                    raise SummaryUnavailable("invalid_response") from None
                # One retry of the same bounded data prompt; never feed raw provider errors back.
            except httpx.HTTPError:
                raise SummaryUnavailable("provider_failed") from None
        raise SummaryUnavailable("invalid_response")
