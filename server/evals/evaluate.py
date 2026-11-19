"""Evaluate action-item recall on 12 synthetic meetings; no real transcripts are logged.

Run from server/: python -m evals.evaluate --mock
For a real model (billable): load .env privately, then python -m evals.evaluate --live.
"""

import argparse
import asyncio
import json
from pathlib import Path

from app.config import Settings
from app.summarizer.client import NotesClient
from app.summarizer.models import Notes
from app.summarizer.prompts import build_messages


def score(expected: list[dict], actual: list[dict]) -> tuple[int, int]:
    used = set()
    matches = 0
    for target in expected:
        for index, item in enumerate(actual):
            combined = (item.get("task", "") + " " + (item.get("due") or "")).lower()
            if (
                index not in used
                and item.get("owner", "").lower() == target["owner"].lower()
                and all(word.lower() in combined for word in target["keywords"])
                and (not target["due"] or target["due"].lower() in combined)
            ):
                used.add(index)
                matches += 1
                break
    return matches, len(actual) - len(used)


async def run(live: bool):
    fixtures = json.loads(Path(__file__).with_name("meetings.json").read_text())
    settings = Settings.from_env() if live else None
    matched = total = extras = failures = 0
    for sample in fixtures:
        try:
            if live:
                notes = await NotesClient(settings).generate(
                    build_messages(None, sample["transcript"], True), final=True
                )
            else:
                notes = Notes(
                    summary="Synthetic scorer self-check",
                    decisions=[],
                    actionItems=[
                        {
                            "owner": row["owner"],
                            "task": " ".join(row["keywords"]),
                            "due": row["due"],
                        }
                        for row in sample["expected"]
                    ],
                )
            hit, extra = score(sample["expected"], [row.model_dump() for row in notes.actionItems])
            matched += hit
            extras += extra
            print(
                json.dumps(
                    {
                        "case": sample["id"],
                        "matched": hit,
                        "expected": len(sample["expected"]),
                        "extra": extra,
                    }
                )
            )
        except Exception:
            failures += 1
            print(json.dumps({"case": sample["id"], "failed": True}))
        total += len(sample["expected"])
    print(
        json.dumps(
            {
                "mode": "live model" if live else "scorer self-check, not model quality",
                "recall": matched / total if total else 1,
                "extra_items": extras,
                "failed_cases": failures,
                "cases": len(fixtures),
            }
        )
    )
    return failures


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--live", action="store_true")
    mode.add_argument("--mock", action="store_true")
    args = parser.parse_args()
    raise SystemExit(bool(asyncio.run(run(args.live))))
