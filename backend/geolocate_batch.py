"""Post-batch LOB triangulation and object clustering (thesis-style subset)."""

from __future__ import annotations

import logging
import math
import os
import uuid
from collections import defaultdict
from dataclasses import dataclass

from pathlib import Path

import httpx
from dotenv import load_dotenv

import geolocation as geo
import mapillary
import storage

load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

logger = logging.getLogger(__name__)

LOB_CLUSTER_RADIUS_M = float(os.getenv("LOB_CLUSTER_RADIUS_M", "10"))
LOB_MIN_VIEWS = int(os.getenv("LOB_MIN_VIEWS", "3"))
LOB_MIN_VIEWS_STATIC = int(os.getenv("LOB_MIN_VIEWS_STATIC", "2"))
LOB_ANGLE_THRESHOLD_DEG = float(os.getenv("LOB_ANGLE_THRESHOLD_DEG", "3"))
LOB_ASSOCIATE_MAX_M = float(os.getenv("LOB_ASSOCIATE_MAX_M", "12"))
MAPILLARY_BASE = "https://graph.mapillary.com"

_BACKFILL_FIELDS = (
    "sequence,computed_compass_angle,compass_angle,"
    "width,height,camera_parameters,camera_type,computed_rotation"
)


def _min_views_for(class_name: str) -> int:
    if class_name in geo.STATIC_GROUND_CLASSES:
        return LOB_MIN_VIEWS_STATIC
    return LOB_MIN_VIEWS


def _backfill_mapillary_metadata(job_id: str, results: list[dict]) -> int:
    """
    Re-fetch sequence, compass, and camera intrinsics for batch rows.
    Returns count of rows updated.
    """
    token = os.getenv("MAPILLARY_ACCESS_TOKEN")
    if not token:
        return 0

    updated = 0
    with httpx.Client(timeout=15) as client:
        for row in results:
            image_id = row["image_id"]
            try:
                resp = client.get(
                    f"{MAPILLARY_BASE}/{image_id}",
                    params={"access_token": token, "fields": _BACKFILL_FIELDS},
                )
                if resp.status_code != 200:
                    continue
                image = resp.json()
            except Exception:
                logger.warning("Mapillary metadata backfill failed for %s", image_id, exc_info=True)
                continue

            seq = mapillary.sequence_from_image(image)
            compass = mapillary.compass_from_image(image)
            meta = mapillary.camera_metadata_from_image(image)

            prev_seq = str(row.get("sequence_id") or "").strip()
            prev_compass = float(row.get("compass_angle") or 0)
            prev_focal = row.get("camera_focal_px")
            changed = (
                seq != prev_seq
                or abs(compass - prev_compass) >= 0.01
                or meta.get("camera_focal_px") != prev_focal
                or not row.get("computed_rotation")
            )
            if not changed:
                continue

            row["sequence_id"] = seq
            row["compass_angle"] = compass
            row["camera_focal_px"] = meta.get("camera_focal_px")
            row["camera_type"] = meta.get("camera_type")
            row["computed_rotation"] = meta.get("computed_rotation")
            row["source_width"] = meta.get("source_width")
            row["source_height"] = meta.get("source_height")

            storage.update_result_metadata(
                job_id,
                image_id,
                sequence_id=seq,
                compass_angle=compass,
                camera_focal_px=meta.get("camera_focal_px"),
                camera_type=meta.get("camera_type"),
                computed_rotation=meta.get("computed_rotation"),
                source_width=meta.get("source_width"),
                source_height=meta.get("source_height"),
            )
            updated += 1
    return updated


@dataclass
class Lob:
    image_id: str
    detection_index: int
    class_name: str
    camera_lat: float
    camera_lng: float
    bearing_deg: float
    sequence_id: str
    captured_at: str


def _point_near_lob(
    camera_lat: float,
    camera_lng: float,
    bearing_deg: float,
    point_lat: float,
    point_lng: float,
    max_cross_track_m: float = LOB_ASSOCIATE_MAX_M,
) -> bool:
    """True if point lies near the forward LOB ray from the camera."""
    ref_lat = camera_lat
    ref_lng = camera_lng
    m_per_deg_lat = 111320.0
    m_per_deg_lng = 111320.0 * math.cos(math.radians(ref_lat))

    px = (point_lng - ref_lng) * m_per_deg_lng
    py = (point_lat - ref_lat) * m_per_deg_lat
    dx, dy = geo._bearing_to_unit(bearing_deg)

    along = px * dx + py * dy
    if along < 0:
        return False
    cross = abs(px * dy - py * dx)
    return cross <= max_cross_track_m and along <= geo.LOB_MAX_LENGTH_M


def _build_lobs(results: list[dict]) -> list[Lob]:
    lobs: list[Lob] = []
    cam_kw = geo.row_camera_kwargs
    for row in results:
        cam_lat, cam_lng = row.get("lat"), row.get("lng")
        if cam_lat is None or cam_lng is None:
            continue
        compass = row.get("compass_angle")
        width = row.get("image_width") or 0
        if compass is None or width < 1:
            continue
        kwargs = cam_kw(row)
        for idx, det in enumerate(row.get("detections") or []):
            enriched = geo.enrich_detection_geo(
                det,
                camera_lat=float(cam_lat),
                camera_lng=float(cam_lng),
                compass_angle=float(compass),
                image_width=int(width),
                image_height=int(row.get("image_height") or 0),
                **kwargs,
            )
            brg = enriched.get("bearing_deg")
            if brg is None:
                continue
            lobs.append(
                Lob(
                    image_id=row["image_id"],
                    detection_index=idx,
                    class_name=det.get("class", ""),
                    camera_lat=float(cam_lat),
                    camera_lng=float(cam_lng),
                    bearing_deg=float(brg),
                    sequence_id=row.get("sequence_id") or "",
                    captured_at=str(row.get("captured_at") or ""),
                )
            )
    return lobs


def _find_intersections(seq_lobs: list[Lob]) -> list[tuple[float, float, list[Lob]]]:
    """Pairwise intersections with enough supporting LOBs (class-dependent min views)."""
    hits: list[tuple[float, float, list[Lob]]] = []
    n = len(seq_lobs)
    for i in range(n):
        for j in range(i + 1, n):
            a, b = seq_lobs[i], seq_lobs[j]
            if a.image_id == b.image_id or a.class_name != b.class_name:
                continue
            if geo.lob_angle_difference(a.bearing_deg, b.bearing_deg) < LOB_ANGLE_THRESHOLD_DEG:
                continue
            pt = geo.intersect_lob_2d(
                a.camera_lat,
                a.camera_lng,
                a.bearing_deg,
                b.camera_lat,
                b.camera_lng,
                b.bearing_deg,
            )
            if not pt:
                continue
            support = [a, b]
            for k in range(n):
                if k in (i, j):
                    continue
                c = seq_lobs[k]
                if c.class_name != a.class_name:
                    continue
                if c.image_id in (a.image_id, b.image_id):
                    continue
                if _point_near_lob(c.camera_lat, c.camera_lng, c.bearing_deg, pt[0], pt[1]):
                    support.append(c)
            if len(support) >= _min_views_for(a.class_name):
                hits.append((pt[0], pt[1], support))
    return hits


def _re_enrich_results(results: list[dict]) -> None:
    """Refresh per-detection geo using stored camera metadata."""
    for row in results:
        cam_lat, cam_lng = row.get("lat"), row.get("lng")
        compass = row.get("compass_angle")
        width = row.get("image_width") or 0
        if cam_lat is None or cam_lng is None or compass is None or width < 1:
            continue
        kwargs = geo.row_camera_kwargs(row)
        dets = row.get("detections") or []
        for idx, det in enumerate(dets):
            if det.get("geo_method") == "lob_triangulation":
                continue
            dets[idx] = geo.enrich_detection_geo(
                det,
                camera_lat=float(cam_lat),
                camera_lng=float(cam_lng),
                compass_angle=float(compass),
                image_width=int(width),
                image_height=int(row.get("image_height") or 0),
                **kwargs,
            )


def run_geolocate_job(job_id: str) -> dict:
    """
    Triangulate detections using multi-view LOB intersection + clustering.
    Updates detections_json and batch_object_locations.
    """
    results = storage.get_results_for_geolocate(job_id)
    backfilled = _backfill_mapillary_metadata(job_id, results)
    if backfilled:
        logger.info("Backfilled Mapillary metadata for %d images in job %s", backfilled, job_id)
    backfilled = _backfill_mapillary_metadata(job_id, results)
    if backfilled:
        logger.info("Backfilled Mapillary metadata for %d images in job %s", backfilled, job_id)

    _re_enrich_results(results)
    results_by_image = {r["image_id"]: r for r in results}
    for image_id, row in results_by_image.items():
        storage.update_result_detections(job_id, image_id, row["detections"])

    lobs = _build_lobs(results)
    if not lobs:
        return {"objects": 0, "updated_detections": 0, "re_enriched": True}

    by_seq: dict[str, list[Lob]] = defaultdict(list)
    for lob in lobs:
        key = lob.sequence_id or f"_img_{lob.image_id}"
        by_seq[key].append(lob)

    intersection_points: list[tuple[float, float, str, list[Lob]]] = []
    for _seq_id, seq_lobs in by_seq.items():
        intersection_points.extend(
            (lat, lng, support[0].class_name, support)
            for lat, lng, support in _find_intersections(seq_lobs)
        )

    if not intersection_points:
        return {"objects": 0, "updated_detections": 0, "re_enriched": True}

    clusters = geo.cluster_points(
        [(p[0], p[1]) for p in intersection_points],
        LOB_CLUSTER_RADIUS_M,
    )

    cluster_meta: list[dict] = []
    for cluster_pts in clusters:
        members: list[tuple[float, float, str, list[Lob]]] = []
        for rec in intersection_points:
            lat, lng, cls, support = rec
            if any(geo.haversine_m(lat, lng, c[0], c[1]) <= LOB_CLUSTER_RADIUS_M for c in cluster_pts):
                members.append(rec)
        if not members:
            continue
        cen_lat, cen_lng = geo.cluster_centroid(cluster_pts)
        all_support: dict[tuple[str, int], Lob] = {}
        for _lat, _lng, _cls, support in members:
            for lob in support:
                all_support[(lob.image_id, lob.detection_index)] = lob
        cluster_meta.append(
            {
                "lat": cen_lat,
                "lng": cen_lng,
                "class": members[0][2],
                "support": list(all_support.values()),
            }
        )

    storage.clear_object_locations(job_id)

    results_by_image = {r["image_id"]: r for r in results}
    updated_count = 0

    for cluster in cluster_meta:
        object_id = str(uuid.uuid4())[:12]
        refs = []
        for lob in cluster["support"]:
            refs.append(
                {
                    "image_id": lob.image_id,
                    "detection_index": lob.detection_index,
                    "bearing_deg": lob.bearing_deg,
                }
            )
            row = results_by_image.get(lob.image_id)
            if not row:
                continue
            dets = row["detections"]
            if lob.detection_index >= len(dets):
                continue
            det = dets[lob.detection_index]
            det["geo_lat"] = round(cluster["lat"], 7)
            det["geo_lng"] = round(cluster["lng"], 7)
            det["geo_method"] = "lob_triangulation"
            det["geo_confidence"] = len(cluster["support"])
            det["bearing_deg"] = lob.bearing_deg
            ray_end_lat, ray_end_lng = geo.lob_endpoint(
                lob.camera_lat, lob.camera_lng, lob.bearing_deg, geo.LOB_MAX_LENGTH_M
            )
            det["ray_end_lat"] = round(ray_end_lat, 7)
            det["ray_end_lng"] = round(ray_end_lng, 7)
            updated_count += 1

        storage.insert_object_location(
            job_id,
            object_id,
            lat=cluster["lat"],
            lng=cluster["lng"],
            class_name=cluster["class"],
            support_count=len(cluster["support"]),
            geo_method="lob_triangulation",
            detection_refs=refs,
        )

    for image_id, row in results_by_image.items():
        storage.update_result_detections(job_id, image_id, row["detections"])

    logger.info(
        "Geolocated job %s: %d objects, %d detection updates",
        job_id,
        len(cluster_meta),
        updated_count,
    )
    return {"objects": len(cluster_meta), "updated_detections": updated_count}
