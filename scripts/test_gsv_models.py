#!/usr/bin/env python3
"""Probe all GSV Continued Roboflow models and print a status table."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import detector  # noqa: E402


async def main() -> int:
    server_ok = await detector.health_check()
    print(f"Inference server: {'connected' if server_ok else 'DISCONNECTED'}")
    print(f"URL: {detector.INFERENCE_URL}")
    print()

    try:
        probes = await detector.probe_models()
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}")
        return 1

    header = f"{'model_id':<45} {'status':<8} {'ms':>6} {'preds':>6}"
    print(header)
    print("-" * len(header))

    exit_code = 0
    for row in probes:
        status = row.get("status", "?")
        if status != "ok":
            exit_code = 1
        if row.get("source") == "primary" and status != "ok":
            exit_code = 1
        preds = row.get("prediction_count")
        preds_s = str(preds) if preds is not None else "-"
        latency = row.get("latency_ms")
        latency_s = str(latency) if latency is not None else "-"
        print(
            f"{row.get('model_id', ''):<45} {status:<8} {latency_s:>6} {preds_s:>6}"
        )
        if row.get("error"):
            print(f"  error: {row['error']}")

    ok = sum(1 for p in probes if p.get("status") == "ok")
    failed = sum(1 for p in probes if p.get("status") == "failed")
    print()
    print(f"Summary: {ok}/{len(probes)} ok, {failed} failed")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
