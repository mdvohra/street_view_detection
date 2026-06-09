"""GSV panorama fusion: per-location dedup, cross-location LOB, official object counts."""

from __future__ import annotations

import os
import statistics
import uuid
from typing import Any

import geolocation as geo

GSV_LOC_CLUSTER_RADIUS_M = float(os.getenv("GSV_LOC_CLUSTER_RADIUS_M", "12"))
GSV_SESSION_CLUSTER_RADIUS_M = float(os.getenv("GSV_SESSION_CLUSTER_RADIUS_M", "10"))
GSV_LOB_ANGLE_THRESHOLD_DEG = float(os.getenv("GSV_LOB_ANGLE_THRESHOLD_DEG", "3"))
GSV_FUSION_BEARING_AGREE_DEG = float(os.getenv("GSV_FUSION_BEARING_AGREE_DEG", "5"))
GEOLOCATE_MIN_BBOX_WIDTH_FOR_QUALITY = int(os.getenv("GEOLOCATE_MIN_BBOX_WIDTH_FOR_QUALITY", "12"))
GSV_OFFICIAL_STATIC_ONLY = os.getenv("GSV_OFFICIAL_STATIC_ONLY", "false").lower() not in (
    "0",
    "false",
    "no",
)
GSV_EXCLUDE_BEARING_SINGLE = os.getenv("GSV_EXCLUDE_BEARING_SINGLE", "true").lower() not in (
    "0",
    "false",
    "no",
)

_METHOD_RANK = {
    "gsv_lob_triangulation": 0,
    "intersection_corner_snap": 1,
    "road_edge_snap": 1,
    "lob_triangulation": 1,
    "camera_ray_3d": 2,
    "gsv_horizon_ray": 2,
    "bearing_size": 3,
    "bearing_single": 4,
}


def _method_rank(method: str | None) -> int:
    return _METHOD_RANK.get(method or "", 99)


def _det_geo_point(det: dict) -> tuple[float, float] | None:
    lat, lng = det.get("geo_lat"), det.get("geo_lng")
    if lat is None or lng is None:
        return None
    return float(lat), float(lng)


def _bbox_height(det: dict) -> int:
    return geo.bbox_height_px(det)


def _pick_best_detection(cluster: list[dict]) -> dict:
    def sort_key(d: dict) -> tuple:
        return (
            _method_rank(d.get("geo_method")),
            -(d.get("confidence") or 0),
            -_bbox_height(d),
        )

    return min(cluster, key=sort_key)


def _cluster_detections_by_geo(
    detections: list[dict],
    radius_m: float,
) -> list[list[dict]]:
    geo_dets = [d for d in detections if _det_geo_point(d)]
    if not geo_dets:
        return []

    clusters: list[list[dict]] = []
    for det in geo_dets:
        pt = _det_geo_point(det)
        assert pt is not None
        placed = False
        for cluster in clusters:
            rep = cluster[0]
            rep_pt = _det_geo_point(rep)
            if rep_pt and geo.haversine_m(pt[0], pt[1], rep_pt[0], rep_pt[1]) <= radius_m:
                cluster.append(det)
                placed = True
                break
        if not placed:
            clusters.append([det])
    return clusters


def _bearings_agree(cluster: list[dict], threshold_deg: float = GSV_FUSION_BEARING_AGREE_DEG) -> bool:
    bearings = [float(d["bearing_deg"]) for d in cluster if d.get("bearing_deg") is not None]
    if len(bearings) < 2:
        return False
    ref = bearings[0]
    return all(geo.lob_angle_difference(ref, b) <= threshold_deg for b in bearings[1:])


def _median_distance(cluster: list[dict]) -> float | None:
    dists = [
        float(d["geo_distance_m"])
        for d in cluster
        if d.get("geo_distance_m") is not None
    ]
    if not dists:
        return None
    return float(statistics.median(dists))


def _fused_coordinates(cluster: list[dict], best: dict) -> tuple[float, float, float | None]:
    lat = float(best["geo_lat"])
    lng = float(best["geo_lng"])
    distance_m = best.get("geo_distance_m")

    if len(cluster) > 1 and _bearings_agree(cluster):
        med_dist = _median_distance(cluster)
        bearing = best.get("bearing_deg")
        cam_lat = best.get("camera_lat")
        cam_lng = best.get("camera_lng")
        if med_dist and bearing is not None and cam_lat is not None and cam_lng is not None:
            lat, lng = geo.destination_point(
                float(cam_lat),
                float(cam_lng),
                float(bearing),
                med_dist,
            )
            distance_m = med_dist
    return lat, lng, distance_m


def _fuse_cluster(cluster: list[dict], location_id: int) -> dict:
    best = _pick_best_detection(cluster)
    views = sorted({int(d.get("view") or 0) for d in cluster if d.get("view") is not None})
    lat, lng, distance_m = _fused_coordinates(cluster, best)

    quality = best.get("geo_quality") or _infer_geo_quality(best)
    return {
        "object_id": str(uuid.uuid4())[:12],
        "location_id": location_id,
        "class": best.get("class", ""),
        "geo_lat": round(float(lat), 7),
        "geo_lng": round(float(lng), 7),
        "bearing_deg": best.get("bearing_deg"),
        "geo_method": best.get("geo_method"),
        "geo_distance_m": round(float(distance_m), 2) if distance_m is not None else best.get("geo_distance_m"),
        "geo_quality": quality,
        "confidence": best.get("confidence"),
        "support_views": views,
        "support_count": len(cluster),
        "camera_lat": best.get("camera_lat"),
        "camera_lng": best.get("camera_lng"),
        "ray_end_lat": best.get("ray_end_lat"),
        "ray_end_lng": best.get("ray_end_lng"),
        "geo_anchor_x": best.get("geo_anchor_x"),
        "tier": "official" if quality == "high" else "estimated",
        "placement_confidence": "verified" if quality == "high" else "estimated",
    }


def _infer_geo_quality(det: dict) -> str:
    if det.get("geo_lat") is None:
        return "skipped"
    method = det.get("geo_method")
    if method in (
        "gsv_lob_triangulation",
        "intersection_corner_snap",
        "road_edge_snap",
        "lob_triangulation",
        "gsv_horizon_ray",
    ):
        return "high"
    if method == "bearing_size" and geo.bbox_width_px(det) >= GEOLOCATE_MIN_BBOX_WIDTH_FOR_QUALITY:
        return "high"
    if method == "bearing_single":
        return "low"
    return "high" if method == "bearing_size" else "low"


def _include_in_official_objects(obj: dict) -> bool:
    cls = obj.get("class", "")
    if GSV_OFFICIAL_STATIC_ONLY and cls not in geo.STATIC_GROUND_CLASSES:
        return False
    if GSV_EXCLUDE_BEARING_SINGLE and cls in geo.STATIC_GROUND_CLASSES:
        if obj.get("geo_method") == "bearing_single":
            return False
        if obj.get("placement_confidence") == "rejected":
            return False
    return obj.get("geo_lat") is not None


def fuse_location_objects(
    location_id: int,
    detections: list[dict],
    *,
    cluster_radius_m: float = GSV_LOC_CLUSTER_RADIUS_M,
) -> list[dict]:
    """Dedupe per-view detections at one GSV location into official objects."""
    by_class: dict[str, list[dict]] = {}
    for det in detections:
        if _det_geo_point(det) is None:
            continue
        by_class.setdefault(det.get("class", ""), []).append(det)

    official: list[dict] = []
    for _cls, class_dets in by_class.items():
        for cluster in _cluster_detections_by_geo(class_dets, cluster_radius_m):
            obj = _fuse_cluster(cluster, location_id)
            if _include_in_official_objects(obj):
                official.append(obj)
    return official


def _lob_support_near_point(
    lob: dict,
    point_lat: float,
    point_lng: float,
    max_cross_m: float = 12.0,
) -> bool:
    cam_lat, cam_lng = lob["camera_lat"], lob["camera_lng"]
    ref_lat = cam_lat
    m_lat = 111320.0
    m_lng = 111320.0 * __import__("math").cos(__import__("math").radians(ref_lat))
    px = (point_lng - cam_lng) * m_lng
    py = (point_lat - cam_lat) * m_lat
    dx, dy = geo._bearing_to_unit(lob["bearing_deg"])
    along = px * dx + py * dy
    if along < 0:
        return False
    cross = abs(px * dy - py * dx)
    return cross <= max_cross_m and along <= geo.LOB_MAX_LENGTH_M


def _cross_location_lob_merge(objects: list[dict]) -> list[dict]:
    """Triangulate across different drive locations with same class."""
    by_class: dict[str, list[dict]] = {}
    for obj in objects:
        by_class.setdefault(obj.get("class", ""), []).append(obj)

    merged: list[dict] = []
    for class_name, class_objs in by_class.items():
        used = [False] * len(class_objs)
        for i in range(len(class_objs)):
            if used[i]:
                continue
            group = [class_objs[i]]
            used[i] = True
            for j in range(i + 1, len(class_objs)):
                if used[j]:
                    continue
                oa, ob = class_objs[i], class_objs[j]
                if oa.get("location_id") == ob.get("location_id"):
                    continue
                if geo.haversine_m(oa["geo_lat"], oa["geo_lng"], ob["geo_lat"], ob["geo_lng"]) > GSV_SESSION_CLUSTER_RADIUS_M:
                    continue
                if oa.get("bearing_deg") is None or ob.get("bearing_deg") is None:
                    continue
                if geo.lob_angle_difference(float(oa["bearing_deg"]), float(ob["bearing_deg"])) < GSV_LOB_ANGLE_THRESHOLD_DEG:
                    continue
                if oa.get("camera_lat") is None or ob.get("camera_lat") is None:
                    continue
                pt = geo.intersect_lob_2d(
                    float(oa["camera_lat"]),
                    float(oa["camera_lng"]),
                    float(oa["bearing_deg"]),
                    float(ob["camera_lat"]),
                    float(ob["camera_lng"]),
                    float(ob["bearing_deg"]),
                )
                if not pt:
                    continue
                group.append(class_objs[j])
                used[j] = True

            if len(group) >= 2 and group[0].get("camera_lat") is not None:
                lobs = [
                    {
                        "camera_lat": g["camera_lat"],
                        "camera_lng": g["camera_lng"],
                        "bearing_deg": g["bearing_deg"],
                    }
                    for g in group
                    if g.get("bearing_deg") is not None
                ]
                best_pt = None
                best_support = 0
                for a_idx in range(len(lobs)):
                    for b_idx in range(a_idx + 1, len(lobs)):
                        la, lb = lobs[a_idx], lobs[b_idx]
                        pt = geo.intersect_lob_2d(
                            la["camera_lat"],
                            la["camera_lng"],
                            la["bearing_deg"],
                            lb["camera_lat"],
                            lb["camera_lng"],
                            lb["bearing_deg"],
                        )
                        if not pt:
                            continue
                        support = sum(
                            1
                            for lob in lobs
                            if _lob_support_near_point(lob, pt[0], pt[1])
                        )
                        if support > best_support:
                            best_support = support
                            best_pt = pt
                if best_pt and best_support >= 2:
                    rep = _pick_best_detection(group)
                    views = sorted({v for g in group for v in (g.get("support_views") or [])})
                    merged.append(
                        {
                            **rep,
                            "geo_lat": round(best_pt[0], 7),
                            "geo_lng": round(best_pt[1], 7),
                            "geo_method": "gsv_lob_triangulation",
                            "geo_quality": "high",
                            "tier": "official",
                            "placement_confidence": "verified",
                            "support_count": sum(g.get("support_count", 1) for g in group),
                            "support_views": views,
                            "support_locations": sorted({g["location_id"] for g in group}),
                        }
                    )
                    continue

            rep = _pick_best_detection(group)
            if len(group) > 1:
                lat, lng, distance_m = _fused_coordinates(group, rep)
                rep = {
                    **rep,
                    "geo_lat": round(lat, 7),
                    "geo_lng": round(lng, 7),
                    "geo_distance_m": round(float(distance_m), 2) if distance_m is not None else rep.get("geo_distance_m"),
                    "support_count": sum(g.get("support_count", 1) for g in group),
                    "support_views": sorted({v for g in group for v in (g.get("support_views") or [])}),
                }
            merged.append(rep)
    return merged


def _filter_official_list(objects: list[dict]) -> list[dict]:
    return [o for o in objects if _include_in_official_objects(o)]


def official_counts_from_objects(objects: list[dict], *, verified_only: bool = False) -> dict[str, int]:
    counts: dict[str, int] = {}
    for obj in objects:
        if verified_only and obj.get("tier") != "official":
            continue
        if obj.get("geo_quality") == "low" and verified_only:
            continue
        cls = obj.get("class", "")
        counts[cls] = counts.get(cls, 0) + 1
    return counts


def refine_session_locations(
    location_results: list[dict],
) -> dict[str, Any]:
    """
    Re-fuse and cross-location LOB across all locations in a map session.
    Each item: {id, lat, lng, compass, detections}.
    """
    all_loc_objects: list[dict] = []
    per_location: dict[int, list[dict]] = {}
    import road_snap

    hfov = geo.gsv_effective_h_fov_deg()

    for loc_result in location_results:
        loc_id = int(loc_result["id"])
        dets = loc_result.get("detections") or []
        loc_objs = fuse_location_objects(loc_id, dets)
        compass = float(loc_result.get("compass") or 0)
        iw = int(loc_result.get("image_width") or 1280)

        loc_objs = road_snap.snap_official_objects(
            loc_objs,
            location_id=loc_id,
            compass_raw=compass,
            image_width=iw,
            h_fov_deg=hfov,
        )
        per_location[loc_id] = loc_objs
        all_loc_objects.extend(loc_objs)

    official = _cross_location_lob_merge(all_loc_objects)

    refined: list[dict] = []
    for obj in official:
        loc_id = int(obj.get("location_id") or 0)
        loc_result = next((l for l in location_results if int(l["id"]) == loc_id), None)
        compass = float((loc_result or {}).get("compass") or 0)
        iw = int((loc_result or {}).get("image_width") or 1280)
        snapped = road_snap.snap_official_object(
            obj,
            location_id=loc_id,
            compass_raw=compass,
            image_width=iw,
            h_fov_deg=hfov,
        )
        refined.append(road_snap.apply_road_proximity_gate(snapped, location_id=loc_id))
    official = _filter_official_list(refined)
    return {
        "official_objects": official,
        "official_counts": official_counts_from_objects(official),
        "verified_counts": official_counts_from_objects(official, verified_only=True),
        "per_location": per_location,
    }


def process_panorama_official_objects(
    location_id: int,
    detections: list[dict],
    *,
    session_objects: list[dict] | None = None,
) -> dict[str, Any]:
    """
    Fuse raw panorama detections into official_objects for one location.
    Optionally merge with prior session objects for cross-location LOB.
    """
    loc_objects = fuse_location_objects(location_id, detections)
    if session_objects:
        combined = [o for o in session_objects if o.get("location_id") != location_id] + loc_objects
        official = _cross_location_lob_merge(combined)
    else:
        official = loc_objects

    official = _filter_official_list(official)
    return {
        "official_objects": official,
        "official_counts": official_counts_from_objects(official),
        "verified_counts": official_counts_from_objects(official, verified_only=True),
    }
