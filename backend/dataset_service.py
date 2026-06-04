"""Load local dataset images and coordinates from dataset/coords.csv."""

from __future__ import annotations

import os
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent
COORDS_FILE = "coords.csv"


def _resolve_dataset_root() -> Path:
    env = os.getenv("DATASET_ROOT", "").strip()
    if env:
        return Path(env)

    # Docker mounts ./dataset at /app/dataset; local dev uses repo-root/dataset.
    candidates = (
        _BACKEND_DIR / "dataset",
        _BACKEND_DIR.parent / "dataset",
    )
    for candidate in candidates:
        if (candidate / COORDS_FILE).is_file():
            return candidate
    return _BACKEND_DIR.parent / "dataset"


DATASET_ROOT = _resolve_dataset_root()

_points: list[dict] | None = None
_bounds: dict | None = None


def _parse_coords() -> list[dict]:
    csv_path = DATASET_ROOT / COORDS_FILE
    if not csv_path.is_file():
        raise FileNotFoundError(f"Dataset coords file not found: {csv_path}")

    points: list[dict] = []
    missing_images: list[int] = []

    with csv_path.open(encoding="utf-8") as fh:
        for row_index, line in enumerate(fh, start=1):
            line = line.strip()
            if not line:
                continue
            parts = line.split(",")
            if len(parts) < 2:
                raise ValueError(f"Invalid coords line {row_index}: {line!r}")
            lat = float(parts[0].strip())
            lng = float(parts[1].strip())
            image_id = row_index - 1
            filename = f"{image_id}.png"
            image_path = DATASET_ROOT / filename
            if not image_path.is_file():
                missing_images.append(image_id)
            points.append(
                {
                    "id": image_id,
                    "row": row_index,
                    "lat": lat,
                    "lng": lng,
                    "filename": filename,
                }
            )

    if missing_images:
        sample = missing_images[:5]
        print(
            f"WARNING: dataset missing {len(missing_images)} image(s), "
            f"e.g. ids {sample}{'...' if len(missing_images) > 5 else ''}"
        )

    return points


def _compute_bounds(points: list[dict]) -> dict:
    lats = [p["lat"] for p in points]
    lngs = [p["lng"] for p in points]
    return {
        "south": min(lats),
        "west": min(lngs),
        "north": max(lats),
        "east": max(lngs),
    }


def _ensure_loaded() -> None:
    global _points, _bounds
    if _points is not None:
        return
    _points = _parse_coords()
    _bounds = _compute_bounds(_points)
    print(f"Dataset loaded: {len(_points)} points from {DATASET_ROOT}")


def init() -> None:
    """Parse coords.csv at startup."""
    try:
        _ensure_loaded()
    except FileNotFoundError as exc:
        print(f"WARNING: {exc}")


def get_meta() -> dict:
    _ensure_loaded()
    assert _points is not None and _bounds is not None
    return {"count": len(_points), "bounds": _bounds}


def get_points() -> list[dict]:
    _ensure_loaded()
    assert _points is not None
    return [{"id": p["id"], "row": p["row"], "lat": p["lat"], "lng": p["lng"]} for p in _points]


def get_point(image_id: int) -> dict:
    _ensure_loaded()
    assert _points is not None
    if image_id < 0 or image_id >= len(_points):
        raise ValueError(f"Invalid dataset image id: {image_id}")
    return _points[image_id]


def get_image_path(image_id: int) -> Path:
    point = get_point(image_id)
    path = DATASET_ROOT / point["filename"]
    if not path.is_file():
        raise FileNotFoundError(f"Dataset image not found: {path}")
    resolved = path.resolve()
    root_resolved = DATASET_ROOT.resolve()
    if not str(resolved).startswith(str(root_resolved)):
        raise ValueError("Invalid image path")
    return resolved
