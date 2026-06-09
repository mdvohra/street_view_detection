#!/usr/bin/env python3
"""Audit GSV map session geo quality: duplicates, bearing_single rate, centerline distance."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

import geolocation as geo

CENTERLINE_THRESHOLD_M = 3.0
DUPLICATE_CLUSTER_M = 15.0
ROADSIDE_ACCEPT_MAX_M = float(__import__("os").getenv("ROADSIDE_ACCEPT_MAX_M", "12"))
STATIC_CLASSES = geo.STATIC_GROUND_CLASSES


def _dist_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    return geo.haversine_m(lat1, lng1, lat2, lng2)


def _trail_segments(locations: list[dict]) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    sorted_locs = sorted(locations, key=lambda l: l.get("order", l.get("id", 0)))
    segs = []
    for i in range(len(sorted_locs) - 1):
        a = sorted_locs[i]
        b = sorted_locs[i + 1]
        segs.append(((a["lat"], a["lng"]), (b["lat"], b["lng"])))
    return segs


def _min_trail_distance_m(
    plat: float,
    plng: float,
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
) -> float | None:
    if not segments:
        return None
    return min(
        geo.point_to_segment_m(plat, plng, a[0], a[1], b[0], b[1])
        for a, b in segments
    )


def _dedupe_count(detections: list[dict], class_name: str, radius_m: float) -> int:
    pts = [
        (d["lat"], d["lng"])
        for d in detections
        if d.get("class") == class_name and d.get("lat") is not None
    ]
    clusters = geo.cluster_points(pts, radius_m)
    return len(clusters)


def _static_detections(detections: list[dict]) -> list[dict]:
    return [d for d in detections if d.get("class") in STATIC_CLASSES]


def audit_session(session: dict) -> dict:
    detections = session.get("detections") or []
    static_dets = _static_detections(detections)
    locations = session.get("locations") or []
    segments = _trail_segments(locations)

    by_class: dict[str, list] = {}
    for d in detections:
        by_class.setdefault(d.get("class", "Unknown"), []).append(d)

    signal_dets = [d for d in detections if d.get("class") == "Traffic Signal"]
    signal_raw = len(signal_dets)
    signal_deduped = _dedupe_count(detections, "Traffic Signal", DUPLICATE_CLUSTER_M)
    inflation = (signal_raw / signal_deduped) if signal_deduped else float(signal_raw or 0)

    bearing_single = sum(1 for d in static_dets if d.get("geo_method") == "bearing_single")
    bearing_single_pct = (100.0 * bearing_single / len(static_dets)) if static_dets else 0.0

    snap_rejected = sum(1 for d in detections if d.get("snap_rejected"))
    road_edge_snap = sum(1 for d in detections if d.get("geo_method") == "road_edge_snap")

    on_centerline = 0
    roadside_ok = 0
    pole_light_roadside = 0
    pole_light_total = 0

    for d in detections:
        if d.get("lat") is None:
            continue
        dist = _min_trail_distance_m(d["lat"], d["lng"], segments)
        if dist is not None and dist < CENTERLINE_THRESHOLD_M:
            on_centerline += 1
        if dist is not None and dist <= ROADSIDE_ACCEPT_MAX_M:
            roadside_ok += 1
        if d.get("class") in ("Street Light", "Pole"):
            pole_light_total += 1
            if dist is not None and dist <= ROADSIDE_ACCEPT_MAX_M:
                pole_light_roadside += 1

    centerline_pct = (100.0 * on_centerline / len(detections)) if detections else 0.0
    roadside_pct = (100.0 * roadside_ok / len(detections)) if detections else 0.0
    pole_light_roadside_pct = (
        100.0 * pole_light_roadside / pole_light_total if pole_light_total else 0.0
    )

    signal_on_centerline = 0
    for d in signal_dets:
        dist = _min_trail_distance_m(d["lat"], d["lng"], segments)
        if dist is not None and dist < CENTERLINE_THRESHOLD_M:
            signal_on_centerline += 1
    signal_off_centerline_pct = (
        100.0 * (signal_raw - signal_on_centerline) / signal_raw if signal_raw else 0.0
    )

    return {
        "session_id": session.get("sessionId", ""),
        "total_detections": len(detections),
        "static_detections": len(static_dets),
        "traffic_signal_raw": signal_raw,
        "traffic_signal_deduped": signal_deduped,
        "traffic_signal_inflation_ratio": round(inflation, 2),
        "bearing_single_count": bearing_single,
        "bearing_single_pct": round(bearing_single_pct, 1),
        "snap_rejected_count": snap_rejected,
        "road_edge_snap_count": road_edge_snap,
        "pins_on_centerline": on_centerline,
        "centerline_pct": round(centerline_pct, 1),
        "roadside_ok_pct": round(roadside_pct, 1),
        "pole_light_roadside_pct": round(pole_light_roadside_pct, 1),
        "traffic_signal_off_centerline_pct": round(signal_off_centerline_pct, 1),
        "aggregate_counts": session.get("aggregate_counts") or {},
        "official_counts": session.get("official_counts") or {},
        "pass_government_gate": (
            inflation < 1.2
            and signal_off_centerline_pct >= 80.0
            if signal_raw
            else True
        ),
        "pass_static_gate": (
            bearing_single_pct < 5.0
            and pole_light_roadside_pct >= 70.0
            if pole_light_total
            else bearing_single_pct < 5.0
        ),
    }


def audit_detections_csv_rows(session: dict) -> list[dict]:
    locations = session.get("locations") or []
    loc_by_id = {l["id"]: l for l in locations}
    segments = _trail_segments(locations)
    rows = []
    for d in session.get("detections") or []:
        dist = _min_trail_distance_m(d.get("lat"), d.get("lng"), segments) if d.get("lat") else None
        loc = loc_by_id.get(d.get("location_id"))
        rows.append(
            {
                "session_id": session.get("sessionId"),
                "detection_id": d.get("detection_id"),
                "location_id": d.get("location_id"),
                "class": d.get("class"),
                "view": d.get("view"),
                "geo_method": d.get("geo_method"),
                "geo_quality": d.get("geo_quality"),
                "tier": d.get("tier"),
                "snap_rejected": d.get("snap_rejected"),
                "centerline_distance_m": d.get("centerline_distance_m", ""),
                "lat": d.get("lat"),
                "lng": d.get("lng"),
                "trail_distance_m": round(dist, 2) if dist is not None else "",
                "on_centerline": dist is not None and dist < CENTERLINE_THRESHOLD_M,
                "roadside_ok": dist is not None and dist <= ROADSIDE_ACCEPT_MAX_M,
                "camera_lat": loc["lat"] if loc else "",
                "camera_lng": loc["lng"] if loc else "",
            }
        )
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit GSV map session geo quality")
    parser.add_argument("session_json", type=Path, help="Path to session JSON file")
    parser.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="Write per-detection CSV report to this path",
    )
    args = parser.parse_args()

    with args.session_json.open(encoding="utf-8") as fh:
        session = json.load(fh)

    summary = audit_session(session)
    print(json.dumps(summary, indent=2))

    if args.csv:
        rows = audit_detections_csv_rows(session)
        if rows:
            with args.csv.open("w", newline="", encoding="utf-8") as fh:
                writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
                writer.writeheader()
                writer.writerows(rows)
            print(f"Wrote {args.csv}")


if __name__ == "__main__":
    main()
