"""Snap traffic signal pins to intersection corners via OSM or GSV nav graph."""

from __future__ import annotations

import logging
import math
import os
from typing import Any

import httpx

import geolocation as geo
import gsv_continued_service

logger = logging.getLogger(__name__)

SNAP_SEARCH_RADIUS_M = float(os.getenv("SNAP_SEARCH_RADIUS_M", "40"))
INTERSECTION_CORNER_OFFSET_M = float(os.getenv("INTERSECTION_CORNER_OFFSET_M", "8"))
SNAP_MAX_DISPLACEMENT_M = float(os.getenv("SNAP_MAX_DISPLACEMENT_M", "25"))
SNAP_ROADSIDE_MAX_DISPLACEMENT_M = float(os.getenv("SNAP_ROADSIDE_MAX_DISPLACEMENT_M", "35"))
ROAD_EDGE_OFFSET_M = float(os.getenv("ROAD_EDGE_OFFSET_M", "7"))
ROAD_PROXIMITY_MAX_M = float(os.getenv("ROAD_PROXIMITY_MAX_M", "25"))
ROADSIDE_ACCEPT_MAX_M = float(os.getenv("ROADSIDE_ACCEPT_MAX_M", "12"))
SNAP_USE_GEOMETRIC_FALLBACK = os.getenv("SNAP_USE_GEOMETRIC_FALLBACK", "true").lower() not in (
    "0",
    "false",
    "no",
)
SNAP_OSM_ENABLED = os.getenv("SNAP_OSM_ENABLED", "true").lower() not in ("0", "false", "no")
SNAP_OSM_WAYS_ENABLED = os.getenv("SNAP_OSM_WAYS_ENABLED", "true").lower() not in ("0", "false", "no")
SNAP_OSM_TIMEOUT_S = float(os.getenv("SNAP_OSM_TIMEOUT_S", "8"))
OVERPASS_URLS = [
    u.strip()
    for u in os.getenv(
        "OVERPASS_URLS",
        "https://overpass.kumi.systems/api/interpreter,https://overpass-api.de/api/interpreter",
    ).split(",")
    if u.strip()
]
SNAP_CLASSES = frozenset({"Traffic Signal", "Traffic Sign"})
SNAP_ROADSIDE_CLASSES = frozenset(
    c.strip()
    for c in os.getenv("SNAP_ROADSIDE_CLASSES", "Street Light,Pole").split(",")
    if c.strip()
)

_intersection_cache: dict[str, list[tuple[float, float]]] = {}
_road_way_cache: dict[str, list[tuple[tuple[float, float], tuple[float, float]]]] = {}


def _bearing_delta(a: float, b: float) -> float:
    return abs((b - a + 180.0) % 360.0 - 180.0)


def _offset_point(lat: float, lng: float, bearing_deg: float, distance_m: float) -> tuple[float, float]:
    return geo.destination_point(lat, lng, bearing_deg, distance_m)


def _nav_degree(nav: dict) -> int:
    return sum(1 for k in ("forward", "backward", "left", "right") if nav.get(k) is not None)


def _is_intersection_nav(nav: dict) -> bool:
    return nav.get("left") is not None and nav.get("right") is not None


def _gsv_intersection_center(location_id: int) -> tuple[float, float, float] | None:
    """Return (lat, lng, road_bearing) from GSV nav graph, or None."""
    try:
        loc = gsv_continued_service.get_location(location_id)
    except (FileNotFoundError, ValueError):
        return None

    nav = loc.get("nav") or {}
    if not _is_intersection_nav(nav) and _nav_degree(nav) < 3:
        return None

    compass = float(loc.get("compass") or 0)
    road_bearing = gsv_continued_service.normalize_compass(compass)
    return float(loc["lat"]), float(loc["lng"]), road_bearing


def _gsv_road_bearing(location_id: int) -> tuple[float, float, float] | None:
    """Return (cam_lat, cam_lng, road_bearing) for any GSV location."""
    try:
        loc = gsv_continued_service.get_location(location_id)
    except (FileNotFoundError, ValueError):
        return None
    compass = float(loc.get("compass") or 0)
    return float(loc["lat"]), float(loc["lng"]), gsv_continued_service.normalize_compass(compass)


def _gsv_forward_anchor(location_id: int, road_bearing: float) -> tuple[float, float] | None:
    """Use forward nav node as intersection-ahead anchor when signal faces down-road."""
    try:
        loc = gsv_continued_service.get_location(location_id)
        fwd_id = (loc.get("nav") or {}).get("forward")
        if fwd_id is None:
            return None
        fwd = gsv_continued_service.get_location(int(fwd_id))
        return float(fwd["lat"]), float(fwd["lng"])
    except (FileNotFoundError, ValueError, TypeError):
        return None


def _geometric_intersection_center(
    obj: dict,
    *,
    location_id: int,
    compass_raw: float,
    road_bearing: float,
) -> tuple[float, float] | None:
    """
    Offline fallback: project along detection bearing, or use forward nav node when
    the signal lies ahead along the travel axis (typical intersection mast-arm).
    """
    try:
        loc = gsv_continued_service.get_location(location_id)
    except (FileNotFoundError, ValueError):
        return None

    cam_lat = float(obj.get("camera_lat") or loc["lat"])
    cam_lng = float(obj.get("camera_lng") or loc["lng"])
    det_bearing = float(obj.get("bearing_deg") or road_bearing)
    dist = float(obj.get("geo_distance_m") or geo.DEFAULT_OBJECT_DISTANCE_M)

    if _bearing_delta(road_bearing, det_bearing) <= 55:
        fwd_pt = _gsv_forward_anchor(location_id, road_bearing)
        if fwd_pt:
            return fwd_pt

    return geo.destination_point(cam_lat, cam_lng, det_bearing, dist)


def _pick_corner(
    center_lat: float,
    center_lng: float,
    road_bearing: float,
    detection_bearing: float,
    lateral_sign: int,
    offset_m: float = INTERSECTION_CORNER_OFFSET_M,
) -> tuple[float, float]:
    """Offset from road center to intersection corner quadrant."""
    delta = _bearing_delta(road_bearing, detection_bearing)
    if delta <= 50:
        corner_brg = (road_bearing + (45.0 if lateral_sign > 0 else -45.0)) % 360.0
        dist = offset_m * 1.2
    elif delta <= 130:
        corner_brg = (road_bearing + (90.0 if lateral_sign > 0 else -90.0)) % 360.0
        dist = offset_m
    else:
        corner_brg = (road_bearing + (135.0 if lateral_sign > 0 else -135.0)) % 360.0
        dist = offset_m * 1.1
    return _offset_point(center_lat, center_lng, corner_brg, dist)


def _cache_key(lat: float, lng: float) -> str:
    return f"{round(lat, 4)}:{round(lng, 4)}"


def _parse_osm_elements(data: dict) -> list[tuple[float, float]]:
    nodes: list[tuple[float, float]] = []
    for el in data.get("elements") or []:
        if el.get("type") != "node":
            continue
        tags = el.get("tags") or {}
        hw = tags.get("highway", "")
        if hw in ("traffic_signals", "stop", "crossing", "mini_roundabout", "turning_circle"):
            nodes.append((float(el["lat"]), float(el["lon"])))
        elif tags.get("junction") or tags.get("traffic_signals"):
            nodes.append((float(el["lat"]), float(el["lon"])))
    return nodes


def _parse_osm_way_segments(data: dict) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    segments: list[tuple[tuple[float, float], tuple[float, float]]] = []
    for el in data.get("elements") or []:
        if el.get("type") != "way":
            continue
        geom = el.get("geometry") or []
        if len(geom) < 2:
            continue
        for i in range(len(geom) - 1):
            a = geom[i]
            b = geom[i + 1]
            segments.append(
                ((float(a["lat"]), float(a["lon"])), (float(b["lat"]), float(b["lon"])))
            )
    return segments


def _query_overpass(query: str) -> dict | None:
    if not SNAP_OSM_ENABLED:
        return None
    for url in OVERPASS_URLS:
        try:
            with httpx.Client(timeout=SNAP_OSM_TIMEOUT_S) as client:
                resp = client.post(url, data={"data": query})
                if resp.status_code == 200:
                    return resp.json()
        except Exception:
            logger.debug("Overpass query failed for %s", url, exc_info=True)
    return None


def _query_osm_intersections(lat: float, lng: float, radius_m: float) -> list[tuple[float, float]]:
    key = _cache_key(lat, lng)
    if key in _intersection_cache:
        return _intersection_cache[key]

    around_q = (
        f'[out:json][timeout:25];'
        f'('
        f'node["highway"="traffic_signals"](around:{int(radius_m)},{lat},{lng});'
        f'node["highway"="crossing"](around:{int(radius_m)},{lat},{lng});'
        f'node["junction"](around:{int(radius_m)},{lat},{lng});'
        f');out body;'
    )

    data = _query_overpass(around_q)
    nodes = _parse_osm_elements(data or {})
    _intersection_cache[key] = nodes
    return nodes


def _query_osm_road_segments(
    lat: float,
    lng: float,
    radius_m: float,
) -> list[tuple[tuple[float, float], tuple[float, float]]]:
    key = _cache_key(lat, lng)
    if key in _road_way_cache:
        return _road_way_cache[key]

    if not SNAP_OSM_WAYS_ENABLED:
        _road_way_cache[key] = []
        return []

    around_q = (
        f'[out:json][timeout:25];'
        f'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|'
        f'residential|unclassified|living_street|service)$"]'
        f'(around:{int(radius_m)},{lat},{lng});'
        f'out geom;'
    )
    data = _query_overpass(around_q)
    segments = _parse_osm_way_segments(data or {})
    _road_way_cache[key] = segments
    return segments


def _nearest_osm_node(
    lat: float,
    lng: float,
    nodes: list[tuple[float, float]],
    radius_m: float,
) -> tuple[float, float] | None:
    best: tuple[float, float] | None = None
    best_d = radius_m + 1
    for nlat, nlng in nodes:
        d = geo.haversine_m(lat, lng, nlat, nlng)
        if d < best_d:
            best_d = d
            best = (nlat, nlng)
    return best


def _nearest_segment_projection(
    lat: float,
    lng: float,
    segments: list[tuple[tuple[float, float], tuple[float, float]]],
) -> tuple[float, float, float, float] | None:
    """Return (proj_lat, proj_lng, cross_m, segment_bearing) for nearest segment."""
    best: tuple[float, float, float, float] | None = None
    best_cross = float("inf")
    for (a_lat, a_lng), (b_lat, b_lng) in segments:
        proj_lat, proj_lng, cross = geo.project_point_onto_segment(
            lat, lng, a_lat, a_lng, b_lat, b_lng
        )
        if cross < best_cross:
            best_cross = cross
            best = (proj_lat, proj_lng, cross, geo.segment_bearing_deg(a_lat, a_lng, b_lat, b_lng))
    return best


def _gsv_centerline_segment(
    location_id: int,
) -> tuple[tuple[float, float], tuple[float, float], float] | None:
    """Approximate local centerline from camera to forward/backward nav nodes."""
    try:
        loc = gsv_continued_service.get_location(location_id)
    except (FileNotFoundError, ValueError):
        return None

    cam = (float(loc["lat"]), float(loc["lng"]))
    nav = loc.get("nav") or {}
    road_bearing = gsv_continued_service.normalize_compass(float(loc.get("compass") or 0))
    endpoints: list[tuple[float, float]] = []

    for key in ("forward", "backward"):
        node_id = nav.get(key)
        if node_id is None:
            continue
        try:
            node = gsv_continued_service.get_location(int(node_id))
            endpoints.append((float(node["lat"]), float(node["lng"])))
        except (FileNotFoundError, ValueError, TypeError):
            continue

    if len(endpoints) >= 2:
        return endpoints[0], endpoints[1], road_bearing
    if len(endpoints) == 1:
        far = geo.destination_point(cam[0], cam[1], road_bearing, 40.0)
        return cam, far, road_bearing
    far = geo.destination_point(cam[0], cam[1], road_bearing, 40.0)
    back = geo.destination_point(cam[0], cam[1], (road_bearing + 180.0) % 360.0, 40.0)
    return back, far, road_bearing


def _lateral_sign_from_detection(obj: dict, image_width: int, h_fov_deg: float) -> int:
    anchor_x = obj.get("geo_anchor_x")
    if anchor_x is None:
        anchor_x = geo.bbox_center_x(obj)
    delta = geo.pixel_to_bearing_delta(int(anchor_x), image_width, h_fov_deg)
    if delta > 1.0:
        return 1
    if delta < -1.0:
        return -1
    return 1 if int(anchor_x) >= image_width // 2 else -1


def _offset_perpendicular_to_road(
    center_lat: float,
    center_lng: float,
    road_bearing: float,
    lateral_sign: int,
    offset_m: float = ROAD_EDGE_OFFSET_M,
) -> tuple[float, float]:
    side_bearing = (road_bearing + (90.0 if lateral_sign > 0 else -90.0)) % 360.0
    return _offset_point(center_lat, center_lng, side_bearing, offset_m)


def snap_roadside_object(
    obj: dict,
    *,
    location_id: int,
    compass_raw: float,
    image_width: int = 1280,
    h_fov_deg: float | None = None,
) -> dict:
    """Snap Street Light / Pole to nearest road edge offset."""
    out = dict(obj)
    if out.get("class") not in SNAP_ROADSIDE_CLASSES:
        return out
    if out.get("geo_lat") is None or out.get("geo_lng") is None:
        return out

    est_lat = float(out["geo_lat"])
    est_lng = float(out["geo_lng"])
    hfov = h_fov_deg if h_fov_deg is not None else geo.gsv_effective_h_fov_deg()
    lateral = _lateral_sign_from_detection(out, image_width, hfov)

    proj_lat, proj_lng, road_bearing = est_lat, est_lng, gsv_continued_service.normalize_compass(compass_raw)
    snap_source = None

    segments = _query_osm_road_segments(est_lat, est_lng, SNAP_SEARCH_RADIUS_M)
    nearest = _nearest_segment_projection(est_lat, est_lng, segments)
    if nearest:
        proj_lat, proj_lng, _, road_bearing = nearest
        snap_source = "osm_way"
    else:
        gsv_seg = _gsv_centerline_segment(location_id)
        if gsv_seg:
            a, b, road_bearing = gsv_seg
            proj_lat, proj_lng, _ = geo.project_point_onto_segment(
                est_lat, est_lng, a[0], a[1], b[0], b[1]
            )
            snap_source = "gsv_nav"

    if not snap_source:
        out["geo_quality"] = "low"
        out["tier"] = "estimated"
        return out

    edge_lat, edge_lng = _offset_perpendicular_to_road(
        proj_lat, proj_lng, road_bearing, lateral, ROAD_EDGE_OFFSET_M
    )
    displacement = geo.haversine_m(est_lat, est_lng, edge_lat, edge_lng)
    if displacement > SNAP_ROADSIDE_MAX_DISPLACEMENT_M:
        out["geo_quality"] = "low"
        out["tier"] = "estimated"
        out["snap_rejected"] = True
        out["snap_displacement_m"] = round(displacement, 2)
        return out

    out["geo_lat"] = round(edge_lat, 7)
    out["geo_lng"] = round(edge_lng, 7)
    out["geo_method"] = "road_edge_snap"
    out["geo_quality"] = "high"
    out["tier"] = "official"
    out["snap_source"] = snap_source
    out["snap_displacement_m"] = round(displacement, 2)
    det_bearing = float(out.get("bearing_deg") or road_bearing)
    cam_lat = out.get("camera_lat") or proj_lat
    cam_lng = out.get("camera_lng") or proj_lng
    ray_end_lat, ray_end_lng = geo.lob_endpoint(cam_lat, cam_lng, det_bearing)
    out["ray_end_lat"] = round(ray_end_lat, 7)
    out["ray_end_lng"] = round(ray_end_lng, 7)
    return out


def _snap_intersection_corner(
    obj: dict,
    *,
    location_id: int,
    compass_raw: float,
    image_width: int,
    h_fov_deg: float,
) -> dict:
    """Snap Traffic Signal/Sign to intersection corner."""
    out = dict(obj)
    if out.get("class") not in SNAP_CLASSES:
        return out
    if out.get("geo_lat") is None or out.get("geo_lng") is None:
        return out

    est_lat = float(out["geo_lat"])
    est_lng = float(out["geo_lng"])
    road_bearing = gsv_continued_service.normalize_compass(compass_raw)
    det_bearing = float(out.get("bearing_deg") or road_bearing)
    lateral = _lateral_sign_from_detection(out, image_width, h_fov_deg)

    center_lat, center_lng = est_lat, est_lng
    snap_source = None

    osm_nodes = _query_osm_intersections(est_lat, est_lng, SNAP_SEARCH_RADIUS_M)
    osm_pt = _nearest_osm_node(est_lat, est_lng, osm_nodes, SNAP_SEARCH_RADIUS_M)
    if osm_pt:
        center_lat, center_lng = osm_pt
        snap_source = "osm"
    else:
        gsv_pt = _gsv_intersection_center(location_id)
        if gsv_pt:
            center_lat, center_lng, road_bearing = gsv_pt
            snap_source = "gsv_nav"
        elif SNAP_USE_GEOMETRIC_FALLBACK:
            geom_pt = _geometric_intersection_center(
                out,
                location_id=location_id,
                compass_raw=compass_raw,
                road_bearing=road_bearing,
            )
            if geom_pt:
                center_lat, center_lng = geom_pt
                snap_source = "geometric"

    if not snap_source:
        out["geo_quality"] = "low"
        out["tier"] = "estimated"
        return out

    corner_lat, corner_lng = _pick_corner(
        center_lat,
        center_lng,
        road_bearing,
        det_bearing,
        lateral,
    )

    displacement = geo.haversine_m(est_lat, est_lng, corner_lat, corner_lng)
    if displacement > SNAP_MAX_DISPLACEMENT_M:
        out["geo_quality"] = "low"
        out["tier"] = "estimated"
        out["snap_rejected"] = True
        out["snap_displacement_m"] = round(displacement, 2)
        return out

    out["geo_lat"] = round(corner_lat, 7)
    out["geo_lng"] = round(corner_lng, 7)
    out["geo_method"] = "intersection_corner_snap"
    out["geo_quality"] = "high"
    out["tier"] = "official"
    out["snap_source"] = snap_source
    out["snap_displacement_m"] = round(displacement, 2)
    cam_lat = out.get("camera_lat") or center_lat
    cam_lng = out.get("camera_lng") or center_lng
    ray_end_lat, ray_end_lng = geo.lob_endpoint(cam_lat, cam_lng, det_bearing)
    out["ray_end_lat"] = round(ray_end_lat, 7)
    out["ray_end_lng"] = round(ray_end_lng, 7)
    return out


def apply_road_proximity_gate(
    obj: dict,
    *,
    location_id: int,
) -> dict:
    """Downgrade pins implausibly far from the local road centerline."""
    out = dict(obj)
    if out.get("class") not in geo.STATIC_GROUND_CLASSES:
        return out
    if out.get("geo_lat") is None or out.get("geo_lng") is None:
        return out

    lat, lng = float(out["geo_lat"]), float(out["geo_lng"])
    centerline_dist: float | None = None

    segments = _query_osm_road_segments(lat, lng, SNAP_SEARCH_RADIUS_M)
    nearest = _nearest_segment_projection(lat, lng, segments)
    if nearest:
        centerline_dist = nearest[2]
    else:
        gsv_seg = _gsv_centerline_segment(location_id)
        if gsv_seg:
            a, b, _ = gsv_seg
            centerline_dist = geo.point_to_segment_m(lat, lng, a[0], a[1], b[0], b[1])

    if centerline_dist is None:
        return out

    out["centerline_distance_m"] = round(centerline_dist, 2)
    out["roadside_ok"] = centerline_dist <= ROADSIDE_ACCEPT_MAX_M

    if centerline_dist > ROAD_PROXIMITY_MAX_M:
        out["geo_quality"] = "low"
        out["tier"] = "estimated"
        out["placement_confidence"] = "rejected"
    elif out.get("geo_quality") == "high":
        out["placement_confidence"] = "verified"
    else:
        out["placement_confidence"] = "estimated"
    return out


def snap_official_object(
    obj: dict,
    *,
    location_id: int,
    compass_raw: float,
    image_width: int = 1280,
    h_fov_deg: float | None = None,
) -> dict:
    """Snap one official object: corner snap for signals/signs, road edge for poles/lights."""
    hfov = h_fov_deg if h_fov_deg is not None else geo.gsv_effective_h_fov_deg()
    cls = obj.get("class")

    if cls in SNAP_CLASSES:
        out = _snap_intersection_corner(
            obj,
            location_id=location_id,
            compass_raw=compass_raw,
            image_width=image_width,
            h_fov_deg=hfov,
        )
        if out.get("snap_rejected") and cls in SNAP_ROADSIDE_CLASSES:
            out = snap_roadside_object(
                obj,
                location_id=location_id,
                compass_raw=compass_raw,
                image_width=image_width,
                h_fov_deg=hfov,
            )
        elif out.get("geo_method") != "intersection_corner_snap" and cls in SNAP_ROADSIDE_CLASSES:
            out = snap_roadside_object(
                out,
                location_id=location_id,
                compass_raw=compass_raw,
                image_width=image_width,
                h_fov_deg=hfov,
            )
    elif cls in SNAP_ROADSIDE_CLASSES:
        out = snap_roadside_object(
            obj,
            location_id=location_id,
            compass_raw=compass_raw,
            image_width=image_width,
            h_fov_deg=hfov,
        )
    else:
        out = dict(obj)

    return apply_road_proximity_gate(out, location_id=location_id)


def snap_official_objects(
    objects: list[dict],
    *,
    location_id: int,
    compass_raw: float,
    image_width: int = 1280,
    h_fov_deg: float | None = None,
) -> list[dict]:
    return [
        snap_official_object(
            obj,
            location_id=location_id,
            compass_raw=compass_raw,
            image_width=image_width,
            h_fov_deg=h_fov_deg,
        )
        for obj in objects
    ]
