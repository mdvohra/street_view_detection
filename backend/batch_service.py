"""Async batch polygon detection jobs with cooperative cancel."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from pathlib import Path

import detector
import mapillary_batch
import storage

logger = logging.getLogger(__name__)

BATCH_CONCURRENCY = int(os.getenv("BATCH_CONCURRENCY", "3"))

_cancel_events: dict[str, asyncio.Event] = {}
_running_tasks: dict[str, asyncio.Task] = {}


def _register_cancel(job_id: str) -> asyncio.Event:
    ev = asyncio.Event()
    _cancel_events[job_id] = ev
    return ev


def _unregister_cancel(job_id: str) -> None:
    _cancel_events.pop(job_id, None)


def is_cancelled(job_id: str) -> bool:
    ev = _cancel_events.get(job_id)
    return ev is not None and ev.is_set()


def request_cancel(job_id: str) -> bool:
    """Signal job to stop; returns False if job not active."""
    job = storage.get_job(job_id)
    if not job:
        return False
    if job["status"] in ("completed", "cancelled", "failed"):
        return True
    ev = _cancel_events.get(job_id)
    if ev:
        ev.set()
    storage.update_job(job_id, status="cancelling")
    return True


def _save_annotated_jpeg(data_url: str, path: Path) -> None:
    payload = data_url.split(",", 1)[1] if "," in data_url else data_url
    path.write_bytes(base64.b64decode(payload))


async def run_batch_job(job_id: str) -> None:
    cancel_ev = _cancel_events.get(job_id) or _register_cancel(job_id)

    def should_cancel() -> bool:
        return cancel_ev.is_set()

    try:
        job = storage.get_job(job_id)
        if not job:
            return

        polygon = job["polygon"]
        storage.update_job(job_id, status="discovering")

        images, mly_err = await mapillary_batch.fetch_images_in_polygon(
            polygon, should_cancel=should_cancel
        )

        if should_cancel():
            storage.update_job(
                job_id,
                status="cancelled",
                finished_at=storage._now_iso(),
                cancelled_at=storage._now_iso(),
                total=len(images),
            )
            return

        if mly_err:
            storage.update_job(
                job_id,
                status="failed",
                finished_at=storage._now_iso(),
                error_message=mly_err,
                total=0,
            )
            return

        total = len(images)
        storage.update_job(job_id, status="running", total=total)

        if total == 0:
            storage.update_job(job_id, status="completed", finished_at=storage._now_iso())
            return

        sem = asyncio.Semaphore(BATCH_CONCURRENCY)
        aggregate: dict = {}
        processed = 0
        failed = 0
        counter_lock = asyncio.Lock()

        async def process_one(img: dict) -> None:
            nonlocal processed, failed, aggregate  # noqa: PLW0603
            if should_cancel():
                return
            image_id = img["image_id"]
            async with sem:
                if should_cancel():
                    return
                try:
                    result = await detector.detect_from_url(img["thumb_url"])
                except Exception as exc:
                    logger.warning("Batch detect failed for %s: %s", image_id, exc)
                    async with counter_lock:
                        failed += 1
                        f, p = failed, processed
                        storage.insert_result(
                            job_id,
                            image_id,
                            lat=img["image_lat"],
                            lng=img["image_lng"],
                            captured_at=str(img.get("captured_at", "")),
                            thumb_url=img["thumb_url"],
                            counts={},
                            detections=[],
                            annotated_path=None,
                            error=str(exc),
                        )
                        storage.update_job(job_id, processed=p, failed=f)
                    return

            if should_cancel():
                return

            jdir = storage.job_dir(job_id)
            ann_path = jdir / f"{image_id}.jpg"
            _save_annotated_jpeg(result["annotated_image_b64"], ann_path)

            async with counter_lock:
                aggregate = storage.merge_counts(aggregate, result.get("counts", {}))
                processed += 1
                p, f = processed, failed
                storage.insert_result(
                    job_id,
                    image_id,
                    lat=img["image_lat"],
                    lng=img["image_lng"],
                    captured_at=str(img.get("captured_at", "")),
                    thumb_url=img["thumb_url"],
                    counts=result.get("counts", {}),
                    detections=result.get("detections", []),
                    annotated_path=str(ann_path),
                )
                storage.update_job(
                    job_id,
                    processed=p,
                    failed=f,
                    aggregate_counts_json=json.dumps(aggregate),
                )

        tasks = []
        for img in images:
            if should_cancel():
                break
            tasks.append(asyncio.create_task(process_one(img)))
            if len(tasks) >= BATCH_CONCURRENCY:
                await asyncio.gather(*tasks)
                tasks = []
                if should_cancel():
                    break
        if tasks and not should_cancel():
            await asyncio.gather(*tasks)

        if should_cancel():
            storage.update_job(
                job_id,
                status="cancelled",
                finished_at=storage._now_iso(),
                cancelled_at=storage._now_iso(),
                processed=processed,
                failed=failed,
            )
        else:
            storage.update_job(
                job_id,
                status="completed",
                finished_at=storage._now_iso(),
                processed=processed,
                failed=failed,
            )
    except Exception as exc:
        logger.exception("Batch job %s failed", job_id)
        storage.update_job(
            job_id,
            status="failed",
            finished_at=storage._now_iso(),
            error_message=str(exc),
        )
    finally:
        _unregister_cancel(job_id)
        _running_tasks.pop(job_id, None)


def start_batch_job(job_id: str) -> None:
    task = asyncio.create_task(run_batch_job(job_id))
    _running_tasks[job_id] = task


def job_to_response(job: dict) -> dict:
    return {
        "job_id": job["job_id"],
        "status": job["status"],
        "polygon": job["polygon"],
        "created_at": job["created_at"],
        "finished_at": job.get("finished_at"),
        "cancelled_at": job.get("cancelled_at"),
        "total": job["total"],
        "processed": job["processed"],
        "failed": job["failed"],
        "aggregate_counts": job.get("aggregate_counts", {}),
        "error_message": job.get("error_message"),
        "results_count": storage.count_results(job["job_id"]),
    }
