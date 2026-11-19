import asyncio

from app.config import Settings
from app.summarizer.client import NotesClient, SummaryUnavailable
from app.summarizer.models import Notes
from app.summarizer.prompts import build_messages


class MeetingSummarizer:
    def __init__(
        self,
        settings: Settings,
        send,
        context: list[dict] | None = None,
        partial: bool = False,
        budget: int | None = None,
    ):
        self.settings = settings
        self.send = send
        self.client = NotesClient(settings)
        if budget is not None:
            self.client.remaining = min(budget, self.client.remaining)
        self.pending: list[dict] = list(context or [])
        self.pending_bytes = sum(len(row["text"].encode()) for row in self.pending)
        self.previous: Notes | None = None
        self.partial = partial
        self.at_ms = 0
        self.lock = asyncio.Lock()
        self.disabled = not settings.llm_key
        self.failure_reported = False

    def add(self, result: dict):
        if not result["final"]:
            return
        self.at_ms = max(self.at_ms, result["endMs"])
        size = len(result["text"].encode())
        if size + self.pending_bytes > 20000 or len(self.pending) >= 300:
            self.partial = True
            return
        self.pending.append({"speaker": result["speaker"], "text": result["text"]})
        self.pending_bytes += size

    async def unavailable(self, kind: str, reason: str):
        await self.send(
            {"type": "summary_status", "kind": kind, "status": "unavailable", "reason": reason}
        )

    async def update(self, final: bool = False):
        async with self.lock:
            if self.disabled:
                if final or not self.failure_reported:
                    await self.unavailable("final" if final else "rolling", "not_configured")
                    self.failure_reported = True
                return
            if not self.pending and not final:
                return
            if not self.pending and self.previous is None:
                if final:
                    await self.send(
                        {
                            "type": "notes",
                            "kind": "final",
                            "summary": "No finalized speech was captured.",
                            "decisions": [],
                            "actionItems": [],
                            "partial": self.partial,
                        }
                    )
                return
            batch = list(self.pending)
            batch_at = self.at_ms

            async def report_budget(remaining):
                await self.send({"type": "notes_budget", "remaining": remaining})

            try:
                notes = await self.client.generate(
                    build_messages(self.previous, batch, final),
                    final=final,
                    on_budget=report_budget,
                )
                self.previous = notes
                del self.pending[: len(batch)]
                self.pending_bytes = sum(len(row["text"].encode()) for row in self.pending)
                if final:
                    await self.send(
                        {
                            "type": "notes",
                            "kind": "final",
                            **notes.model_dump(),
                            "partial": self.partial,
                        }
                    )
                else:
                    await self.send(
                        {
                            "type": "summary",
                            "kind": "rolling",
                            "content": notes.summary,
                            "atMs": batch_at,
                            "partial": self.partial,
                        }
                    )
            except SummaryUnavailable as exc:
                await self.unavailable("final" if final else "rolling", str(exc))
            except Exception:
                await self.unavailable("final" if final else "rolling", "provider_failed")
            finally:
                await self.send({"type": "notes_budget", "remaining": self.client.remaining})

    async def rolling(self):
        while True:
            await asyncio.sleep(self.settings.summary_interval_seconds)
            await self.update()
