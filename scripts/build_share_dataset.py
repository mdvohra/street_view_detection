#!/usr/bin/env python3
"""Build share dataset folder with sample points for manager review."""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

import gsv_continued_service  # noqa: E402

GSV = ROOT / "Dataset_PitOrlManh"
DATASET = ROOT / "dataset"
OUT = ROOT / "share dataset"
GSV_IMAGES = GSV / "zipped images"

GSV_PICK_IDS = [1, 200, 400, 600, 800]
DATASET_PICK_IDS = [0, 2500, 5000, 7500, 9999]


def build_gsv_samples() -> list[dict]:
    index = json.loads((GSV / "gsv_continued_index.json").read_text(encoding="utf-8"))
    by_id = {int(loc["id"]): loc for loc in index["locations"]}
    manifest_locations: list[dict] = []

    for loc_id in GSV_PICK_IDS:
        loc = by_id[loc_id]
        part = loc["part"]
        folder = OUT / f"location_{loc_id:06d}"
        folder.mkdir(parents=True, exist_ok=True)
        views_copied: list[int] = []

        for view in sorted(loc["views"]):
            src = GSV_IMAGES / part / f"{loc_id:06d}_{view}.jpg"
            if not src.is_file():
                continue
            shutil.copy2(src, folder / f"view_{view}.jpg")
            views_copied.append(view)

        compass = float(loc.get("compass") or 0)
        view_heading_deg = {}
        for v in views_copied:
            h = gsv_continued_service.view_heading(compass, v)
            if h is not None:
                view_heading_deg[str(v)] = round(h, 1)
        meta = {
            "id": loc_id,
            "lat": loc["lat"],
            "lng": loc["lng"],
            "compass": compass,
            "views": views_copied,
            "part": part,
            "nav": loc.get("nav"),
            "view_heading_deg": view_heading_deg,
            "filenames": {str(v): f"view_{v}.jpg" for v in views_copied},
        }
        (folder / "metadata.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
        manifest_locations.append(meta)

    return manifest_locations


def build_dataset_samples() -> list[dict]:
    out_dir = OUT / "single_view_from_dataset"
    out_dir.mkdir(parents=True, exist_ok=True)

    coords: list[dict] = []
    with (DATASET / "coords.csv").open(encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            line = line.strip()
            if not line:
                continue
            parts = line.split(",")
            coords.append(
                {
                    "id": i,
                    "row": i + 1,
                    "lat": float(parts[0].strip()),
                    "lng": float(parts[1].strip()),
                }
            )

    subset: list[dict] = []
    for pid in DATASET_PICK_IDS:
        if pid >= len(coords):
            continue
        point = coords[pid]
        folder = out_dir / f"point_{pid:05d}"
        folder.mkdir(parents=True, exist_ok=True)
        src_img = DATASET / f"{pid}.png"
        filename = f"{pid}.png"
        if src_img.is_file():
            shutil.copy2(src_img, folder / filename)
        meta = {**point, "filename": filename}
        (folder / "metadata.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
        subset.append(point)

    with (out_dir / "coords.csv").open("w", encoding="utf-8") as fh:
        for row in subset:
            fh.write(f"{row['lat']},{row['lng']}\n")

    (out_dir / "README.md").write_text(
        "Single-view samples from repo `dataset/` (one PNG + lat/lng per point).\n"
        f"Point IDs: {DATASET_PICK_IDS}\n",
        encoding="utf-8",
    )
    return subset


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True)

    gsv_locations = build_gsv_samples()
    dataset_points = build_dataset_samples()

    manifest = {
        "description": "Share package for manager review",
        "multi_view_locations": {
            "source": str(GSV),
            "count": len(gsv_locations),
            "location_ids": GSV_PICK_IDS,
            "views_per_location": 6,
            "folders": [f"location_{i:06d}" for i in GSV_PICK_IDS],
        },
        "single_view_points": {
            "source": str(DATASET),
            "count": len(dataset_points),
            "point_ids": DATASET_PICK_IDS,
            "folder": "single_view_from_dataset",
        },
        "locations": gsv_locations,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    readme = f"""# Share Dataset

Sample data package for review.

## Multi-view street locations (6 sides each)

**5 locations** from `Dataset_PitOrlManh` — full 360° coverage (V0–V5, 60° apart).

| Location ID | Folder |
|-------------|--------|
{chr(10).join(f'| {i} | `location_{i:06d}/` |' for i in GSV_PICK_IDS)}

Each folder contains:
- `view_0.jpg` … `view_5.jpg` — images for all sides
- `metadata.json` — lat, lng, compass, nav links, per-view heading

## Single-view points (from `dataset/`)

**5 points** in `single_view_from_dataset/` — one PNG + coords per point (IDs: {DATASET_PICK_IDS}).

## Files
- `manifest.json` — full summary for all samples
"""
    (OUT / "README.md").write_text(readme, encoding="utf-8")
    print(f"Created: {OUT}")
    print(f"GSV locations: {GSV_PICK_IDS} ({len(gsv_locations) * 6} images)")
    print(f"Dataset points: {DATASET_PICK_IDS}")


if __name__ == "__main__":
    main()
