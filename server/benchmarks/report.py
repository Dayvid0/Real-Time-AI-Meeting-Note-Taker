import argparse
import json


def percentile(values: list[float], percent: float) -> float:
    if not values or not 0 <= percent <= 100:
        raise ValueError("Percentile requires observations and a value from 0 to 100")
    ordered = sorted(values)
    position = (len(ordered) - 1) * percent / 100
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def summarize(
    latencies_ms: list[float],
    audio_seconds: float,
    transcription_cost: float,
    notes_cost: float,
) -> dict:
    if not latencies_ms or audio_seconds <= 0 or transcription_cost < 0 or notes_cost < 0:
        raise ValueError("Positive observations and audio duration are required")
    p50 = round(percentile(latencies_ms, 50))
    p95 = round(percentile(latencies_ms, 95))
    hourly = round((transcription_cost + notes_cost) * 3600 / audio_seconds, 4)
    return {
        "samples": len(latencies_ms),
        "audio_seconds": audio_seconds,
        "latency_ms": {"p50": p50, "p95": p95},
        "latency_target_ms": 5000,
        "latency_target_met": p95 <= 5000,
        "observed_cost_usd": round(transcription_cost + notes_cost, 6),
        "estimated_cost_per_hour_usd": hourly,
        "cost_target_usd_per_hour": 0.10,
        "cost_target_met": hourly < 0.10,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Report capture-to-caption p50/p95 and observed cost per audio hour."
    )
    parser.add_argument("--latency-ms", type=float, nargs="+", required=True)
    parser.add_argument("--audio-seconds", type=float, required=True)
    parser.add_argument("--transcription-cost-usd", type=float, required=True)
    parser.add_argument("--notes-cost-usd", type=float, default=0)
    args = parser.parse_args()
    print(
        json.dumps(
            summarize(
                args.latency_ms,
                args.audio_seconds,
                args.transcription_cost_usd,
                args.notes_cost_usd,
            ),
            indent=2,
        )
    )
