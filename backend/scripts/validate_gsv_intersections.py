#!/usr/bin/env python3
"""List PitOrlManh GSV locations suitable for intersection validation (nav left+right)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import gsv_continued_service


def main() -> None:
    gsv_continued_service.init()
    index = gsv_continued_service._load_index()
    locations = index.get("locations") or []

    intersections = []
    for loc in locations:
        nav = loc.get("nav") or {}
        if nav.get("left") is not None and nav.get("right") is not None:
            intersections.append(
                {
                    "id": loc["id"],
                    "lat": loc["lat"],
                    "lng": loc["lng"],
                    "compass": loc.get("compass"),
                    "nav": nav,
                }
            )

    intersections.sort(key=lambda x: x["id"])
    sample = intersections[:10]
    print(f"Found {len(intersections)} intersection-like locations (left+right nav)")
    print("Suggested manual validation set (first 5):")
    for loc in sample[:5]:
        print(f"  location_id={loc['id']} lat={loc['lat']:.6f} lng={loc['lng']:.6f}")

    out_path = Path(__file__).resolve().parents[2] / "data" / "gsv_intersection_validation.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump({"total": len(intersections), "sample_ids": [l["id"] for l in sample[:5]], "locations": sample[:5]}, fh, indent=2)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
