"""SQLite persistence and on-disk annotated images for batch jobs."""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

import geolocation

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

            CREATE TABLE IF NOT EXISTS batch_object_locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id TEXT NOT NULL,
                object_id TEXT NOT NULL,
                lat REAL NOT NULL,
                lng REAL NOT NULL,
                class TEXT NOT NULL,
                support_count INTEGER NOT NULL DEFAULT 1,
                geo_method TEXT NOT NULL DEFAULT 'lob_triangulation',
                detection_refs_json TEXT NOT NULL DEFAULT '[]',
                UNIQUE(job_id, object_id),
                FOREIGN KEY (job_id) REFERENCES batch_jobs(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_batch_object_locations_job
                ON batch_object_locations(job_id);
            """
        )
        _migrate_db(conn)


def _migrate_db(conn: sqlite3.Connection) -> None:
    """Add columns/tables for older databases."""
    cols = {row[1] for row in conn.execute("PRAGMA table_info(batch_results)").fetchall()}
    additions = [
        ("compass_angle", "REAL"),
        ("sequence_id", "TEXT"),
        ("image_width", "INTEGER"),
        ("image_height", "INTEGER"),
        ("camera_focal_px", "REAL"),
        ("camera_type", "TEXT"),
        ("computed_rotation_json", "TEXT"),
        ("source_width", "INTEGER"),
        ("source_height", "INTEGER"),
    ]
    for name, col_type in additions:
        if name not in cols:
            conn.execute(f"ALTER TABLE batch_results ADD COLUMN {name} {col_type}")


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
    compass_angle: float | None = None,
    sequence_id: str | None = None,
    image_width: int | None = None,
    image_height: int | None = None,
    camera_focal_px: float | None = None,
    camera_type: str | None = None,
    computed_rotation: list | None = None,
    source_width: int | None = None,
    source_height: int | None = None,
) -> None:
    validate_job_id(job_id)
    validate_image_id(image_id)
    rotation_json = json.dumps(computed_rotation) if computed_rotation else None
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO batch_results (
                job_id, image_id, lat, lng, captured_at, thumb_url,
                counts_json, detections_json, annotated_path, error,
                compass_angle, sequence_id, image_width, image_height,
                camera_focal_px, camera_type, computed_rotation_json,
                source_width, source_height
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                compass_angle,
                sequence_id or "",
                image_width,
                image_height,
                camera_focal_px,
                camera_type or "",
                rotation_json,
                source_width,
                source_height,
            ),
        )


def update_result_metadata(
    job_id: str,
    image_id: str,
    *,
    sequence_id: str | None = None,
    compass_angle: float | None = None,
    camera_focal_px: float | None = None,
    camera_type: str | None = None,
    computed_rotation: list | None = None,
    source_width: int | None = None,
    source_height: int | None = None,
) -> None:
    validate_job_id(job_id)
    validate_image_id(image_id)
    rotation_json = json.dumps(computed_rotation) if computed_rotation is not None else None
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            UPDATE batch_results
            SET sequence_id = COALESCE(?, sequence_id),
                compass_angle = COALESCE(?, compass_angle),
                camera_focal_px = COALESCE(?, camera_focal_px),
                camera_type = COALESCE(?, camera_type),
                computed_rotation_json = COALESCE(?, computed_rotation_json),
                source_width = COALESCE(?, source_width),
                source_height = COALESCE(?, source_height)
            WHERE job_id = ? AND image_id = ?
            """,
            (
                sequence_id,
                compass_angle,
                camera_focal_px,
                camera_type,
                rotation_json,
                source_width,
                source_height,
                job_id,
                image_id,
            ),
        )


def update_result_detections(job_id: str, image_id: str, detections: list) -> None:
    validate_job_id(job_id)
    validate_image_id(image_id)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            UPDATE batch_results SET detections_json = ?
            WHERE job_id = ? AND image_id = ?
            """,
            (json.dumps(detections), job_id, image_id),
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


def _parse_rotation_json(raw: str | None) -> list | None:
    if not raw:
        return None
    try:
        val = json.loads(raw)
        return val if isinstance(val, list) else None
    except json.JSONDecodeError:
        return None


def _row_to_result(row: dict) -> dict:
    return {
        "image_id": row["image_id"],
        "lat": row["lat"],
        "lng": row["lng"],
        "captured_at": row["captured_at"],
        "thumb_url": row["thumb_url"],
        "compass_angle": row.get("compass_angle"),
        "sequence_id": row.get("sequence_id") or "",
        "image_width": row.get("image_width"),
        "image_height": row.get("image_height"),
        "camera_focal_px": row.get("camera_focal_px"),
        "camera_type": row.get("camera_type") or "",
        "computed_rotation": _parse_rotation_json(row.get("computed_rotation_json")),
        "source_width": row.get("source_width"),
        "source_height": row.get("source_height"),
        "counts": json.loads(row["counts_json"] or "{}"),
        "detections": json.loads(row["detections_json"] or "[]"),
        "annotated_url": f"/batch/{row['job_id']}/images/{row['image_id']}/annotated"
        if row.get("annotated_path")
        else None,
    }


def get_results_for_geolocate(job_id: str) -> list[dict]:
    """Full rows needed for LOB post-processing."""
    validate_job_id(job_id)
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT * FROM batch_results
            WHERE job_id = ? AND error IS NULL
            ORDER BY id ASC
            """,
            (job_id,),
        ).fetchall()
    return [_row_to_result(dict(r)) for r in rows]


def get_detections_geo(job_id: str) -> list[dict]:
    """Flat detection markers with estimated object coordinates."""
    validate_job_id(job_id)
    results = get_results_for_geolocate(job_id)
    out: list[dict] = []
    for row in results:
        image_id = row["image_id"]
        for idx, det in enumerate(row.get("detections") or []):
            geo_lat = det.get("geo_lat")
            geo_lng = det.get("geo_lng")
            if geo_lat is None or geo_lng is None:
                continue
            out.append(
                {
                    "detection_id": f"{image_id}:{idx}",
                    "image_id": image_id,
                    "detection_index": idx,
                    "class": det.get("class"),
                    "lat": geo_lat,
                    "lng": geo_lng,
                    "bearing_deg": det.get("bearing_deg"),
                    "geo_method": det.get("geo_method", "bearing_single"),
                    "geo_accuracy": geolocation.geo_accuracy_label(
                        det.get("geo_method"), det.get("geo_confidence")
                    ),
                    "geo_confidence": det.get("geo_confidence"),
                    "geo_distance_m": det.get("geo_distance_m"),
                    "geo_anchor_x": det.get("geo_anchor_x"),
                    "geo_anchor_y": det.get("geo_anchor_y"),
                    "ray_end_lat": det.get("ray_end_lat"),
                    "ray_end_lng": det.get("ray_end_lng"),
                    "confidence": det.get("confidence"),
                    "camera_lat": det.get("camera_lat", row.get("lat")),
                    "camera_lng": det.get("camera_lng", row.get("lng")),
                }
            )
    return out


def clear_object_locations(job_id: str) -> None:
    validate_job_id(job_id)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM batch_object_locations WHERE job_id = ?", (job_id,))


def insert_object_location(
    job_id: str,
    object_id: str,
    *,
    lat: float,
    lng: float,
    class_name: str,
    support_count: int,
    geo_method: str,
    detection_refs: list,
) -> None:
    validate_job_id(job_id)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO batch_object_locations (
                job_id, object_id, lat, lng, class, support_count,
                geo_method, detection_refs_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id,
                object_id,
                lat,
                lng,
                class_name,
                support_count,
                geo_method,
                json.dumps(detection_refs),
            ),
        )


def get_objects_geo(job_id: str) -> list[dict]:
    validate_job_id(job_id)
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT object_id, lat, lng, class, support_count, geo_method, detection_refs_json
            FROM batch_object_locations
            WHERE job_id = ?
            ORDER BY id ASC
            """,
            (job_id,),
        ).fetchall()
    out = []
    for r in rows:
        row = dict(r)
        try:
            refs = json.loads(row.get("detection_refs_json") or "[]")
        except json.JSONDecodeError:
            refs = []
        out.append(
            {
                "object_id": row["object_id"],
                "lat": row["lat"],
                "lng": row["lng"],
                "class": row["class"],
                "support_count": row["support_count"],
                "geo_method": row["geo_method"],
                "detection_refs": refs,
            }
        )
    return out


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
        conn.execute("DELETE FROM batch_object_locations WHERE job_id = ?", (job_id,))
        conn.execute("DELETE FROM batch_results WHERE job_id = ?", (job_id,))
        conn.execute("DELETE FROM batch_jobs WHERE id = ?", (job_id,))
    shutil.rmtree(BATCHES_DIR / job_id, ignore_errors=True)


def delete_all_jobs() -> int:
    with sqlite3.connect(DB_PATH) as conn:
        row = conn.execute("SELECT COUNT(*) FROM batch_jobs").fetchone()
        count = row[0] if row else 0
        conn.execute("DELETE FROM batch_object_locations")
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
