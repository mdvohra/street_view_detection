"""PitOrlManh GSV continued dataset: index-backed coords and on-demand JPG serving."""

from __future__ import annotations

import io
import json
import math
import os
from pathlib import Path

from PIL import Image

_BACKEND_DIR = Path(__file__).resolve().parent
_INDEX_NAME = "gsv_continued_index.json"
_IMAGES_DIR = "zipped images"


def _resolve_root() -> Path:
    env = os.getenv("GSV_CONTINUED_ROOT", "").strip()
    if env:
        return Path(env)
    candidates = (
        _BACKEND_DIR.parent / "Dataset_PitOrlManh",
        _BACKEND_DIR / "Dataset_PitOrlManh",
    )
    for candidate in candidates:
        if (candidate / _INDEX_NAME).is_file() or (candidate / "GPS_Long_Lat_Compass.mat").is_file():
            return candidate
    return _BACKEND_DIR.parent / "Dataset_PitOrlManh"


GSV_CONTINUED_ROOT = _resolve_root()

_index: dict | None = None
_by_id: dict[int, dict] | None = None
_bounds: dict | None = None


def _load_index() -> dict:
    global _index, _by_id, _bounds
    if _index is not None:
        return _index

    index_path = GSV_CONTINUED_ROOT / _INDEX_NAME
    if not index_path.is_file():
        raise FileNotFoundError(
            f"GSV continued index not found: {index_path}. "
            "Run: python backend/scripts/build_gsv_continued_index.py"
        )

    with index_path.open(encoding="utf-8") as fh:
        _index = json.load(fh)

    locations = _index.get("locations") or []
    _by_id = {int(loc["id"]): loc for loc in locations}
    if locations:
        lats = [loc["lat"] for loc in locations]
        lngs = [loc["lng"] for loc in locations]
        _bounds = {
            "south": min(lats),
            "west": min(lngs),
            "north": max(lats),
            "east": max(lngs),
        }
    else:
        _bounds = {"south": 0, "west": 0, "north": 0, "east": 0}

    print(
        f"GSV continued loaded: {len(locations)} locations from {GSV_CONTINUED_ROOT} "
        f"(parts: {_index.get('parts', [])})"
    )
    return _index


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    dlat = lat2 - lat1
    dlng = (lng2 - lng1) * math.cos(math.radians(lat1))
    return (math.degrees(math.atan2(dlng, dlat)) + 360.0) % 360.0


def dist_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    dlat = (lat2 - lat1) * 111320.0
    dlng = (lng2 - lng1) * 111320.0 * math.cos(math.radians(lat1))
    return math.hypot(dlat, dlng)


def view_for_bearing(compass: float, bearing: float) -> int:
    """Map geographic bearing to view index (6 views, 60 deg apart; view 0 = compass)."""
    delta = (bearing - compass) % 360.0
    view = int(round(delta / 60.0)) % 6
    return view


def view_heading(compass: float, view: int) -> float:
    return (compass + view * 60.0) % 360.0


def _default_nav() -> dict[str, int | None]:
    return {"forward": None, "backward": None, "left": None, "right": None}


def get_nav(location_id: int, from_id: int | None = None) -> dict:
    loc = get_location(location_id)
    nav = loc.get("nav") or _default_nav()
    compass = float(loc.get("compass") or 0)
    views = loc.get("views") or [0]

    suggested_view = 0
    if from_id is not None and from_id in (_by_id or {}):
        prev = _by_id[from_id]
        brg = bearing_deg(prev["lat"], prev["lng"], loc["lat"], loc["lng"])
        suggested_view = view_for_bearing(compass, brg)
        if suggested_view not in views:
            suggested_view = views[0]

    return {
        "id": location_id,
        "lat": loc["lat"],
        "lng": loc["lng"],
        "compass": compass,
        "views": views,
        "nav": nav,
        "suggested_view": suggested_view,
        "view_heading": {v: round(view_heading(compass, v), 1) for v in views},
    }


def find_nearest_location(lat: float, lng: float, max_dist_m: float = 25.0) -> dict | None:
    _load_index()
    assert _by_id is not None
    best: tuple[float, int] | None = None
    for loc_id, loc in _by_id.items():
        d = dist_m(lat, lng, loc["lat"], loc["lng"])
        if d > max_dist_m:
            continue
        if best is None or d < best[0]:
            best = (d, loc_id)
    if best is None:
        return None
    loc = _by_id[best[1]]
    return {
        "id": best[1],
        "lat": loc["lat"],
        "lng": loc["lng"],
        "distance_m": round(best[0], 2),
    }


def init() -> None:
    try:
        _load_index()
    except FileNotFoundError as exc:
        print(f"WARNING: {exc}")


def get_meta() -> dict:
    data = _load_index()
    locations = data.get("locations") or []
    assert _bounds is not None
    return {
        "count": len(locations),
        "bounds": _bounds,
        "total_locations_in_mat": data.get("total_locations_in_mat", 0),
        "parts": data.get("parts") or [],
        "views_per_location": data.get("views_per_location", 6),
    }


def get_points() -> list[dict]:
    data = _load_index()
    return [
        {
            "id": loc["id"],
            "lat": loc["lat"],
            "lng": loc["lng"],
            "compass": loc.get("compass"),
            "views": loc.get("views") or [0],
        }
        for loc in data.get("locations") or []
    ]


def get_location(location_id: int) -> dict:
    _load_index()
    assert _by_id is not None
    if location_id not in _by_id:
        raise ValueError(f"Invalid GSV continued location id: {location_id}")
    return _by_id[location_id]


def get_image_path(location_id: int, view: int) -> Path:
    loc = get_location(location_id)
    views = loc.get("views") or []
    if view not in views:
        raise ValueError(f"View {view} not available for location {location_id}")
    part = loc.get("part") or "part1"
    filename = f"{location_id:06d}_{view}.jpg"
    path = GSV_CONTINUED_ROOT / _IMAGES_DIR / part / filename
    if not path.is_file():
        raise FileNotFoundError(f"GSV continued image not found: {path}")
    resolved = path.resolve()
    root_resolved = GSV_CONTINUED_ROOT.resolve()
    if not str(resolved).startswith(str(root_resolved)):
        raise ValueError("Invalid image path")
    return resolved


def read_image_bytes(location_id: int, view: int, max_width: int | None = None) -> bytes:
    path = get_image_path(location_id, view)
    if max_width is None or max_width <= 0:
        return path.read_bytes()

    with Image.open(path) as img:
        img = img.convert("RGB")
        w, h = img.size
        if w <= max_width:
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            return buf.getvalue()
        new_h = int(h * max_width / w)
        resized = img.resize((max_width, new_h), Image.Resampling.LANCZOS)
        buf = io.BytesIO()
        resized.save(buf, format="JPEG", quality=85)
        return buf.getvalue()
