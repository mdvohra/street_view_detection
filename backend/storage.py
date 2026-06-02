"""SQLite persistence and on-disk annotated images for batch jobs."""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

DATA_ROOT = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_ROOT / "batches.db"
BATCHES_DIR = DATA_ROOT / "batches"

_SAFE_ID = re.compile(r"^[a-zA-Z0-9_-]+$")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def init_db() -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    BATCHES_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS batch_jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                polygon_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                finished_at TEXT,
                cancelled_at TEXT,
                total INTEGER NOT NULL DEFAULT 0,
                processed INTEGER NOT NULL DEFAULT 0,
                failed INTEGER NOT NULL DEFAULT 0,
                aggregate_counts_json TEXT NOT NULL DEFAULT '{}',
                error_message TEXT
            );

            CREATE TABLE IF NOT EXISTS batch_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                image_id TEXT NOT NULL,
                lat REAL,
                lng REAL,
                captured_at TEXT,
                thumb_url TEXT,
                counts_json TEXT NOT NULL DEFAULT '{}',
                detections_json TEXT NOT NULL DEFAULT '[]',
                annotated_path TEXT,
                error TEXT,
                UNIQUE(job_id, image_id),
                FOREIGN KEY (job_id) REFERENCES batch_jobs(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_batch_results_job
                ON batch_results(job_id);
            """
        )


def new_job_id() -> str:
    return str(uuid.uuid4())


def validate_job_id(job_id: str) -> None:
    if not _SAFE_ID.match(job_id):
        raise ValueError("Invalid job id")


def validate_image_id(image_id: str) -> None:
    if not _SAFE_ID.match(image_id):
        raise ValueError("Invalid image id")


def job_dir(job_id: str) -> Path:
    validate_job_id(job_id)
    path = BATCHES_DIR / job_id
    path.mkdir(parents=True, exist_ok=True)
    return path


def create_job(polygon: list[list[float]]) -> str:
    job_id = new_job_id()
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT INTO batch_jobs (id, status, polygon_json, created_at)
            VALUES (?, 'queued', ?, ?)
            """,
            (job_id, json.dumps(polygon), _now_iso()),
        )
    job_dir(job_id)
    return job_id


def update_job(job_id: str, **fields) -> None:
    validate_job_id(job_id)
    allowed = {
        "status",
        "total",
        "processed",
        "failed",
        "finished_at",
        "cancelled_at",
        "aggregate_counts_json",
        "error_message",
    }
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return
    cols = ", ".join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [job_id]
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(f"UPDATE batch_jobs SET {cols} WHERE id = ?", vals)


def get_job(job_id: str) -> dict | None:
    validate_job_id(job_id)
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM batch_jobs WHERE id = ?", (job_id,)).fetchone()
    if not row:
        return None
    return _row_to_job(dict(row))


def list_jobs(limit: int = 50) -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT * FROM batch_jobs
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [_row_to_job(dict(r)) for r in rows]


def _row_to_job(row: dict) -> dict:
    agg = row.get("aggregate_counts_json") or "{}"
    try:
        aggregate_counts = json.loads(agg)
    except json.JSONDecodeError:
        aggregate_counts = {}
    return {
        "job_id": row["id"],
        "status": row["status"],
        "polygon": json.loads(row["polygon_json"]),
        "created_at": row["created_at"],
        "finished_at": row.get("finished_at"),
        "cancelled_at": row.get("cancelled_at"),
        "total": row["total"],
        "processed": row["processed"],
        "failed": row["failed"],
        "aggregate_counts": aggregate_counts,
        "error_message": row.get("error_message"),
    }


def insert_result(
    job_id: str,
    image_id: str,
    *,
    lat: float | None,
    lng: float | None,
    captured_at: str,
    thumb_url: str,
    counts: dict,
    detections: list,
    annotated_path: str | None,
    error: str | None = None,
) -> None:
    validate_job_id(job_id)
    validate_image_id(image_id)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO batch_results (
                job_id, image_id, lat, lng, captured_at, thumb_url,
                counts_json, detections_json, annotated_path, error
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                image_id,
                lat,
                lng,
                captured_at,
                thumb_url,
                json.dumps(counts),
                json.dumps(detections),
                annotated_path,
                error,
            ),
        )


def get_results(job_id: str, offset: int = 0, limit: int = 50) -> list[dict]:
    validate_job_id(job_id)
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT * FROM batch_results
            WHERE job_id = ? AND error IS NULL
            ORDER BY id ASC
            LIMIT ? OFFSET ?
            """,
            (job_id, limit, offset),
        ).fetchall()
    return [_row_to_result(dict(r)) for r in rows]


def get_results_geo(job_id: str) -> list[dict]:
    """Lightweight lat/lng (+ counts) for map markers."""
    validate_job_id(job_id)
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT image_id, lat, lng, counts_json
            FROM batch_results
            WHERE job_id = ? AND error IS NULL
              AND lat IS NOT NULL AND lng IS NOT NULL
            ORDER BY id ASC
            """,
            (job_id,),
        ).fetchall()
    out = []
    for r in rows:
        row = dict(r)
        try:
            counts = json.loads(row.get("counts_json") or "{}")
        except json.JSONDecodeError:
            counts = {}
        out.append(
            {
                "image_id": row["image_id"],
                "lat": row["lat"],
                "lng": row["lng"],
                "counts": counts,
            }
        )
    return out


def count_results(job_id: str) -> int:
    validate_job_id(job_id)
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM batch_results WHERE job_id = ? AND error IS NULL",
            (job_id,),
        ).fetchone()
    return row[0] if row else 0


def _row_to_result(row: dict) -> dict:
    return {
        "image_id": row["image_id"],
        "lat": row["lat"],
        "lng": row["lng"],
        "captured_at": row["captured_at"],
        "thumb_url": row["thumb_url"],
        "counts": json.loads(row["counts_json"] or "{}"),
        "detections": json.loads(row["detections_json"] or "[]"),
        "annotated_url": f"/batch/{row['job_id']}/images/{row['image_id']}/annotated"
        if row.get("annotated_path")
        else None,
    }


def annotated_file_path(job_id: str, image_id: str) -> Path | None:
    validate_job_id(job_id)
    validate_image_id(image_id)
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute(
            "SELECT annotated_path FROM batch_results WHERE job_id = ? AND image_id = ?",
            (job_id, image_id),
        ).fetchone()
    if not row or not row[0]:
        return None
    path = Path(row[0])
    if path.is_file():
        return path
    return None


def delete_job(job_id: str) -> None:
    validate_job_id(job_id)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM batch_results WHERE job_id = ?", (job_id,))
        conn.execute("DELETE FROM batch_jobs WHERE id = ?", (job_id,))
    shutil.rmtree(BATCHES_DIR / job_id, ignore_errors=True)


def delete_all_jobs() -> int:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute("SELECT COUNT(*) FROM batch_jobs").fetchone()
        count = row[0] if row else 0
        conn.execute("DELETE FROM batch_results")
        conn.execute("DELETE FROM batch_jobs")
    if BATCHES_DIR.exists():
        shutil.rmtree(BATCHES_DIR, ignore_errors=True)
        BATCHES_DIR.mkdir(parents=True, exist_ok=True)
    return count


def merge_counts(existing: dict, new: dict) -> dict:
    out = dict(existing)
    for cls, n in new.items():
        out[cls] = out.get(cls, 0) + n
    return out
