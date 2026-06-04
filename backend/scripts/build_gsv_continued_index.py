#!/usr/bin/env python3
"""Build gsv_continued_index.json from GPS_Long_Lat_Compass.mat and part*/ image folders."""

from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path

MIN_NAV_DIST_M = 3.0
MAX_NAV_DIST_M = 45.0
FORWARD_CONE_DEG = 35.0
BACKWARD_CONE_DEG = 145.0
LEFT_MIN_DEG = 55.0
LEFT_MAX_DEG = 125.0
RIGHT_MIN_DEG = 235.0
RIGHT_MAX_DEG = 305.0

try:
    import scipy.io
except ImportError as exc:
    raise SystemExit("Install scipy: pip install scipy") from exc

_FILENAME_RE = re.compile(r"^(\d{6})_(\d)\.jpg$", re.IGNORECASE)
_GPS_MAT = "GPS_Long_Lat_Compass.mat"
_GPS_VAR = "GPS_Compass"
_IMAGES_DIR = "zipped images"
_INDEX_NAME = "gsv_continued_index.json"


def _resolve_root() -> Path:
    env = os.getenv("GSV_CONTINUED_ROOT", "").strip()
    if env:
        return Path(env).resolve()
    here = Path(__file__).resolve()
    return (here.parents[2] / "Dataset_PitOrlManh").resolve()


def _load_gps(root: Path) -> list[tuple[float, float, float]]:
    mat_path = root / _GPS_MAT
    if not mat_path.is_file():
        raise FileNotFoundError(f"Missing {_GPS_MAT} under {root}")
    data = scipy.io.loadmat(str(mat_path))
    if _GPS_VAR not in data:
        raise KeyError(f"{_GPS_VAR} not found in {_GPS_MAT}")
    gps = data[_GPS_VAR]
    rows = []
    for i in range(gps.shape[0]):
        rows.append((float(gps[i, 0]), float(gps[i, 1]), float(gps[i, 2])))
    return rows


def _scan_images(root: Path) -> dict[int, dict]:
    images_root = root / _IMAGES_DIR
    if not images_root.is_dir():
        raise FileNotFoundError(f"Missing {_IMAGES_DIR} under {root}")

    by_id: dict[int, dict] = {}
    parts_seen: set[str] = set()

    for part_dir in sorted(images_root.iterdir()):
        if not part_dir.is_dir() or not part_dir.name.lower().startswith("part"):
            continue
        part_name = part_dir.name
        for path in part_dir.glob("*.jpg"):
            m = _FILENAME_RE.match(path.name)
            if not m:
                continue
            loc_id = int(m.group(1))
            view = int(m.group(2))
            entry = by_id.setdefault(
                loc_id,
                {"views": set(), "part": part_name},
            )
            entry["views"].add(view)
            entry["part"] = part_name
            parts_seen.add(part_name)

    return by_id


def _dist_m(a: dict, b: dict) -> float:
    dlat = (b["lat"] - a["lat"]) * 111320.0
    dlng = (b["lng"] - a["lng"]) * 111320.0 * math.cos(math.radians(a["lat"]))
    return math.hypot(dlat, dlng)


def _bearing_deg(a: dict, b: dict) -> float:
    dlat = b["lat"] - a["lat"]
    dlng = (b["lng"] - a["lng"]) * math.cos(math.radians(a["lat"]))
    return (math.degrees(math.atan2(dlng, dlat)) + 360.0) % 360.0


def _bearing_delta(from_compass: float, bearing: float) -> float:
    return abs((bearing - from_compass + 180.0) % 360.0 - 180.0)


def _compute_nav_links(locations: list[dict]) -> None:
    by_id = {loc["id"]: loc for loc in locations}
    for loc in locations:
        compass = float(loc["compass"])
        candidates: dict[str, list[tuple[float, int]]] = {
            "forward": [],
            "backward": [],
            "left": [],
            "right": [],
        }
        for other in locations:
            if other["id"] == loc["id"]:
                continue
            dist = _dist_m(loc, other)
            if dist < MIN_NAV_DIST_M or dist > MAX_NAV_DIST_M:
                continue
            brg = _bearing_deg(loc, other)
            delta = _bearing_delta(compass, brg)
            if delta <= FORWARD_CONE_DEG:
                candidates["forward"].append((dist, other["id"]))
            elif delta >= BACKWARD_CONE_DEG:
                candidates["backward"].append((dist, other["id"]))
            elif LEFT_MIN_DEG <= delta <= LEFT_MAX_DEG:
                candidates["left"].append((dist, other["id"]))
            elif RIGHT_MIN_DEG <= delta <= RIGHT_MAX_DEG:
                candidates["right"].append((dist, other["id"]))

        nav: dict[str, int | None] = {}
        for direction, items in candidates.items():
            nav[direction] = min(items, key=lambda x: x[0])[1] if items else None
        loc["nav"] = nav


def build_index(root: Path) -> dict:
    gps_rows = _load_gps(root)
    total_in_mat = len(gps_rows)
    image_index = _scan_images(root)

    locations = []
    for loc_id in sorted(image_index.keys()):
        if loc_id < 1 or loc_id > total_in_mat:
            print(f"WARNING: image location_id {loc_id} outside mat rows 1..{total_in_mat}")
            continue
        lat, lng, compass = gps_rows[loc_id - 1]
        info = image_index[loc_id]
        locations.append(
            {
                "id": loc_id,
                "lat": lat,
                "lng": lng,
                "compass": compass,
                "views": sorted(info["views"]),
                "part": info["part"],
            }
        )

    print(f"Computing navigation links for {len(locations)} locations…")
    _compute_nav_links(locations)

    parts = sorted({loc["part"] for loc in locations})
    return {
        "total_locations_in_mat": total_in_mat,
        "parts": parts,
        "views_per_location": 6,
        "locations": locations,
    }


def main() -> None:
    root = _resolve_root()
    print(f"Building index from {root}")
    index = build_index(root)
    out_path = root / _INDEX_NAME
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(index, fh, separators=(",", ":"))
    print(
        f"Wrote {out_path} — {len(index['locations'])} locations "
        f"(of {index['total_locations_in_mat']} in mat), parts: {index['parts']}"
    )


if __name__ == "__main__":
    main()
