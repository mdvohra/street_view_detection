"""Imagery-derived geolocation: bearing from bbox + optional LOB endpoints."""

from __future__ import annotations

import math
import os
from copy import deepcopy
from typing import Any

HORIZONTAL_FOV_DEG = float(os.getenv("HORIZONTAL_FOV_DEG", "90"))
_gsv_hfov_raw = os.getenv("GSV_HORIZONTAL_FOV_DEG", "").strip()
GSV_HORIZONTAL_FOV_DEG = float(_gsv_hfov_raw) if _gsv_hfov_raw else None
HFOV_SCALE = float(os.getenv("HFOV_SCALE", "1.0"))
COMPASS_BEARING_OFFSET_DEG = float(os.getenv("COMPASS_BEARING_OFFSET_DEG", "0"))
DEFAULT_OBJECT_DISTANCE_M = float(os.getenv("DEFAULT_OBJECT_DISTANCE_M", "15"))
MIN_OBJECT_DISTANCE_M = float(os.getenv("MIN_OBJECT_DISTANCE_M", "3"))
LOB_MAX_LENGTH_M = float(os.getenv("LOB_MAX_LENGTH_M", "50"))
GEOLOCATE_MIN_BBOX_WIDTH_PX = int(os.getenv("GEOLOCATE_MIN_BBOX_WIDTH_PX", "8"))
USE_3D_CAMERA_RAY = os.getenv("USE_3D_CAMERA_RAY", "true").lower() not in ("0", "false", "no")
CAMERA_ALTITUDE_M = float(os.getenv("CAMERA_ALTITUDE_M", "2.5"))

ASSUMED_POLE_HEIGHT_M = float(os.getenv("ASSUMED_POLE_HEIGHT_M", "8"))
ASSUMED_STREET_LIGHT_HEIGHT_M = float(os.getenv("ASSUMED_STREET_LIGHT_HEIGHT_M", "6"))
ASSUMED_TRAFFIC_SIGNAL_HEIGHT_M = float(os.getenv("ASSUMED_TRAFFIC_SIGNAL_HEIGHT_M", "5"))
ASSUMED_TRAFFIC_SIGNAL_HEAD_HEIGHT_M = float(os.getenv("ASSUMED_TRAFFIC_SIGNAL_HEAD_HEIGHT_M", "1.2"))
ASSUMED_TRAFFIC_SIGNAL_MOUNT_HEIGHT_M = float(os.getenv("ASSUMED_TRAFFIC_SIGNAL_MOUNT_HEIGHT_M", "5.5"))
TRAFFIC_SIGNAL_POLE_EXTEND_RATIO = float(os.getenv("TRAFFIC_SIGNAL_POLE_EXTEND_RATIO", "2.0"))
GEOLOCATE_MIN_BBOX_WIDTH_FOR_QUALITY = int(os.getenv("GEOLOCATE_MIN_BBOX_WIDTH_FOR_QUALITY", "12"))

STATIC_GROUND_CLASSES = frozenset({"Pole", "Street Light", "Traffic Signal", "Traffic Sign"})
POLE_BASE_ANCHOR_CLASSES = frozenset({"Pole", "Street Light"})
SIGNAL_HEAD_ANCHOR_CLASSES = frozenset({"Traffic Signal", "Traffic Sign"})

ASSUMED_OBJECT_HEIGHT_M: dict[str, float] = {
    "Pole": ASSUMED_POLE_HEIGHT_M,
    "Street Light": ASSUMED_STREET_LIGHT_HEIGHT_M,
    "Traffic Signal": ASSUMED_TRAFFIC_SIGNAL_HEAD_HEIGHT_M,
    "Traffic Sign": ASSUMED_TRAFFIC_SIGNAL_HEAD_HEIGHT_M,
}

def geo_accuracy_label(method: str | None, confidence: int | None = None) -> str:
    """Human-readable location quality for dashboard users."""
    if method == "lob_triangulation":
        views = int(confidence or 0)
        if views >= 3:
            return f"High accuracy ({views} street views)"
        if views >= 2:
            return f"Good accuracy ({views} street views)"
        return "Multi-view estimate"
    if method == "camera_ray_3d":
        return "Estimated from photo (camera model)"
    if method == "bearing_size":
        return "Estimated from photo and object size"
    if method == "bearing_single":
        return "Estimated from photo"
    if method == "gsv_horizon_ray":
        return "Estimated from photo (horizon ray)"
    if method == "road_edge_snap":
        return "Snapped to road edge"
    if method == "intersection_corner_snap":
        return "Snapped to intersection corner"
    if method == "gsv_lob_triangulation":
        views = int(confidence or 0)
        return f"Multi-location estimate ({views} drive positions)" if views else "Multi-location estimate"
    return "Location pending"


def bbox_center_x(det: dict) -> int:
    if det.get("x_center") is not None:
        return int(det["x_center"])
    bbox = det.get("bbox") or []
    if len(bbox) >= 4:
        return int((bbox[0] + bbox[2]) / 2)
    return 0


def bbox_width_px(det: dict) -> int:
    bbox = det.get("bbox") or []
    if len(bbox) >= 4:
        return max(0, int(bbox[2] - bbox[0]))
    return 0


def bbox_height_px(det: dict) -> int:
    bbox = det.get("bbox") or []
    if len(bbox) >= 4:
        return max(0, int(bbox[3] - bbox[1]))
    return 0


def geo_anchor_pixel(det: dict, class_name: str) -> tuple[int, int]:
    """Ground-contact pixel for vertical objects; signal head extrapolated below bbox."""
    bbox = det.get("bbox") or []
    xc = bbox_center_x(det)
    if len(bbox) >= 4 and class_name in SIGNAL_HEAD_ANCHOR_CLASSES:
        head_h = max(1, int(bbox[3] - bbox[1]))
        y = int(bbox[3] + TRAFFIC_SIGNAL_POLE_EXTEND_RATIO * head_h)
    elif len(bbox) >= 4 and class_name in POLE_BASE_ANCHOR_CLASSES:
        y = int(bbox[3])
    elif det.get("y_center") is not None:
        y = int(det["y_center"])
    elif len(bbox) >= 4:
        y = int((bbox[1] + bbox[3]) / 2)
    else:
        y = 0
    return xc, y


def infer_geo_quality(det: dict) -> str:
    """Quality tier for a geo-enriched detection."""
    if det.get("geo_lat") is None:
        return "skipped"
    method = det.get("geo_method")
    if method in (
        "gsv_lob_triangulation",
        "intersection_corner_snap",
        "road_edge_snap",
        "lob_triangulation",
        "camera_ray_3d",
    ):
        return "high"
    if method == "gsv_horizon_ray":
        return "high"
    if method == "bearing_size" and bbox_width_px(det) >= GEOLOCATE_MIN_BBOX_WIDTH_FOR_QUALITY:
        return "high"
    if method == "bearing_single":
        return "low"
    return "high" if method == "bearing_size" else "low"


def horizontal_fov_deg(focal_px: float, image_width: int) -> float:
    if focal_px <= 0 or image_width <= 0:
        return HORIZONTAL_FOV_DEG
    return math.degrees(2 * math.atan(image_width / (2 * focal_px)))


def gsv_effective_h_fov_deg() -> float:
    """Horizontal FOV for PitOrlManh GSV tiles (env override optional)."""
    base = GSV_HORIZONTAL_FOV_DEG if GSV_HORIZONTAL_FOV_DEG is not None else HORIZONTAL_FOV_DEG
    return base * HFOV_SCALE


def focal_px_from_hfov(image_width: int, h_fov_deg: float) -> float:
    """Pinhole focal length in pixels from image width and horizontal FOV."""
    if image_width <= 0 or h_fov_deg <= 0:
        return 0.0
    half = math.radians(h_fov_deg / 2.0)
    return (image_width / 2.0) / math.tan(half)


def scaled_focal_px(
    focal_px: float,
    source_width: int | None,
    detection_width: int,
) -> float:
    if not focal_px or detection_width <= 0:
        return focal_px
    if source_width and source_width > 0:
        return focal_px * (detection_width / source_width)
    return focal_px


def effective_h_fov_deg(
    *,
    detection_width: int,
    camera_focal_px: float | None = None,
    source_width: int | None = None,
) -> float:
    if camera_focal_px and detection_width > 0:
        sw = source_width or detection_width
        focal = scaled_focal_px(camera_focal_px, sw, detection_width)
        return horizontal_fov_deg(focal, detection_width) * HFOV_SCALE
    return HORIZONTAL_FOV_DEG * HFOV_SCALE


def pixel_to_bearing_delta(x_center: int, image_width: int, h_fov_deg: float) -> float:
    """Degrees east-positive from image center (thesis GSV formula)."""
    if image_width <= 0:
        return 0.0
    center = image_width / 2.0
    deg_per_pixel = h_fov_deg / image_width
    return (x_center - center) * deg_per_pixel


def normalize_bearing(deg: float) -> float:
    return deg % 360.0


def detection_bearing(
    compass_angle: float,
    x_center: int,
    image_width: int,
    h_fov_deg: float = HORIZONTAL_FOV_DEG,
) -> float:
    """Absolute bearing from north (Mapillary compass_angle + horizontal offset)."""
    delta = pixel_to_bearing_delta(x_center, image_width, h_fov_deg)
    return normalize_bearing(float(compass_angle) + delta + COMPASS_BEARING_OFFSET_DEG)


def estimate_distance_from_bbox(
    det: dict,
    class_name: str,
    focal_px: float,
    image_height: int,
) -> float | None:
    """Pinhole distance from assumed object height and bbox height in pixels."""
    height_px = bbox_height_px(det)
    if height_px < GEOLOCATE_MIN_BBOX_WIDTH_PX or focal_px <= 0:
        return None
    assumed_h = ASSUMED_OBJECT_HEIGHT_M.get(class_name)
    if not assumed_h:
        return None
    distance_m = (assumed_h * focal_px) / height_px
    return max(MIN_OBJECT_DISTANCE_M, min(distance_m, LOB_MAX_LENGTH_M))


def destination_point(lat: float, lng: float, bearing_deg: float, distance_m: float) -> tuple[float, float]:
    """Haversine forward: return (lat, lng)."""
    if distance_m <= 0:
        return lat, lng
    earth_radius_m = 6371000.0
    brg = math.radians(bearing_deg)
    lat1 = math.radians(lat)
    lng1 = math.radians(lng)
    lat2 = math.asin(
        math.sin(lat1) * math.cos(distance_m / earth_radius_m)
        + math.cos(lat1) * math.sin(distance_m / earth_radius_m) * math.cos(brg)
    )
    lng2 = lng1 + math.atan2(
        math.sin(brg) * math.sin(distance_m / earth_radius_m) * math.cos(lat1),
        math.cos(distance_m / earth_radius_m) - math.sin(lat1) * math.sin(lat2),
    )
    return math.degrees(lat2), math.degrees(lng2)


def lob_endpoint(
    camera_lat: float,
    camera_lng: float,
    bearing_deg: float,
    max_m: float = LOB_MAX_LENGTH_M,
) -> tuple[float, float]:
    return destination_point(camera_lat, camera_lng, bearing_deg, max_m)


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius_m = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return earth_radius_m * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing_to_unit(bearing_deg: float) -> tuple[float, float]:
    """East, north unit vector."""
    brg = math.radians(bearing_deg)
    return math.sin(brg), math.cos(brg)


def intersect_lob_2d(
    lat1: float,
    lng1: float,
    bearing1: float,
    lat2: float,
    lng2: float,
    bearing2: float,
    max_distance_m: float = LOB_MAX_LENGTH_M,
) -> tuple[float, float] | None:
    """
    Intersect two ground LOB rays in a local tangent plane.
    Returns None if parallel or intersection beyond max_distance from both cameras.
    """
    ref_lat = (lat1 + lat2) / 2.0
    ref_lng = (lng1 + lng2) / 2.0
    m_per_deg_lat = 111320.0
    m_per_deg_lng = 111320.0 * math.cos(math.radians(ref_lat))

    x1 = (lng1 - ref_lng) * m_per_deg_lng
    y1 = (lat1 - ref_lat) * m_per_deg_lat
    x2 = (lng2 - ref_lng) * m_per_deg_lng
    y2 = (lat2 - ref_lat) * m_per_deg_lat

    dx1, dy1 = _bearing_to_unit(bearing1)
    dx2, dy2 = _bearing_to_unit(bearing2)

    denom = dx1 * dy2 - dy1 * dx2
    if abs(denom) < 1e-10:
        return None

    t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / denom
    s = ((x2 - x1) * dy1 - (y2 - y1) * dx1) / denom
    if t < 0 or s < 0:
        return None

    ix = x1 + t * dx1
    iy = y1 + t * dy1

    out_lat = ref_lat + iy / m_per_deg_lat
    out_lng = ref_lng + ix / m_per_deg_lng

    if haversine_m(lat1, lng1, out_lat, out_lng) > max_distance_m:
        return None
    if haversine_m(lat2, lng2, out_lat, out_lng) > max_distance_m:
        return None
    return out_lat, out_lng


def _camera_kwargs(
    *,
    camera_focal_px: float | None = None,
    source_width: int | None = None,
    computed_rotation: list | None = None,
) -> dict[str, Any]:
    return {
        "camera_focal_px": camera_focal_px,
        "source_width": source_width,
        "computed_rotation": computed_rotation,
    }


def enrich_detection_geo(
    det: dict,
    *,
    camera_lat: float,
    camera_lng: float,
    compass_angle: float,
    image_width: int,
    image_height: int,
    h_fov_deg: float | None = None,
    default_distance_m: float = DEFAULT_OBJECT_DISTANCE_M,
    camera_focal_px: float | None = None,
    source_width: int | None = None,
    computed_rotation: list | None = None,
    gsv_mode: bool = False,
) -> dict:
    """Add bearing and geo estimate to one detection dict."""
    out = deepcopy(det)
    out["camera_lat"] = camera_lat
    out["camera_lng"] = camera_lng

    if image_width < 1 or compass_angle is None:
        return out

    width_px = bbox_width_px(out)
    if width_px < GEOLOCATE_MIN_BBOX_WIDTH_PX:
        return out

    class_name = out.get("class", "")
    anchor_x, anchor_y = geo_anchor_pixel(out, class_name)
    out["geo_anchor_x"] = anchor_x
    out["geo_anchor_y"] = anchor_y

    focal_thumb = None
    if camera_focal_px:
        focal_thumb = scaled_focal_px(camera_focal_px, source_width, image_width)

    # 3D ray requires Mapillary computed_rotation; GSV tiles lack it and extrapolated
    # signal anchors otherwise land on the road centerline a few metres ahead.
    if USE_3D_CAMERA_RAY and computed_rotation and focal_thumb and focal_thumb > 0:
        import camera_ray

        ray_result = camera_ray.detection_geo_from_camera_ray(
            anchor_x=float(anchor_x),
            anchor_y=float(anchor_y),
            camera_lat=camera_lat,
            camera_lng=camera_lng,
            compass_angle=float(compass_angle),
            image_width=image_width,
            image_height=image_height or image_width,
            focal_px=focal_thumb,
            computed_rotation=computed_rotation,
            camera_alt_m=CAMERA_ALTITUDE_M,
        )
        if ray_result:
            out.update(ray_result)
            out["geo_anchor_x"] = anchor_x
            out["geo_anchor_y"] = anchor_y
            out["geo_quality"] = infer_geo_quality(out)
            return out

    hfov = h_fov_deg if h_fov_deg is not None else effective_h_fov_deg(
        detection_width=image_width,
        camera_focal_px=camera_focal_px,
        source_width=source_width,
    )

    if gsv_mode and focal_thumb and focal_thumb > 0 and image_height > 0:
        import gsv_camera_ray

        horizon = gsv_camera_ray.ground_hit_from_horizon(
            anchor_x=float(anchor_x),
            anchor_y=float(anchor_y),
            camera_lat=camera_lat,
            camera_lng=camera_lng,
            compass_angle=float(compass_angle),
            image_width=image_width,
            image_height=image_height or image_width,
            focal_px=focal_thumb,
            h_fov_deg=hfov,
        )
        if horizon:
            out.update(horizon)
            out["geo_anchor_x"] = anchor_x
            out["geo_anchor_y"] = anchor_y
            out["geo_quality"] = infer_geo_quality(out)
            return out

    brg = detection_bearing(compass_angle, anchor_x, image_width, hfov)

    distance_m = default_distance_m
    geo_method = "bearing_single"
    if focal_thumb and class_name in ASSUMED_OBJECT_HEIGHT_M:
        est = estimate_distance_from_bbox(out, class_name, focal_thumb, image_height)
        if est is not None:
            distance_m = est
            geo_method = "bearing_size"
    if class_name in SIGNAL_HEAD_ANCHOR_CLASSES and geo_method == "bearing_size":
        mount_h = ASSUMED_TRAFFIC_SIGNAL_MOUNT_HEIGHT_M
        head_h = ASSUMED_OBJECT_HEIGHT_M.get(class_name, mount_h)
        if head_h > 0 and mount_h > head_h:
            distance_m = min(
                LOB_MAX_LENGTH_M,
                max(MIN_OBJECT_DISTANCE_M, distance_m * (mount_h / head_h)),
            )

    geo_lat, geo_lng = destination_point(camera_lat, camera_lng, brg, distance_m)
    ray_end_lat, ray_end_lng = lob_endpoint(camera_lat, camera_lng, brg, LOB_MAX_LENGTH_M)

    out["bearing_deg"] = round(brg, 2)
    out["geo_lat"] = round(geo_lat, 7)
    out["geo_lng"] = round(geo_lng, 7)
    out["geo_method"] = geo_method
    out["geo_distance_m"] = round(distance_m, 2)
    out["ray_end_lat"] = round(ray_end_lat, 7)
    out["ray_end_lng"] = round(ray_end_lng, 7)
    out["h_fov_deg"] = round(hfov, 2)
    out["geo_quality"] = infer_geo_quality(out)
    return out


def enrich_detections_with_geo(
    detections: list[dict],
    *,
    camera_lat: float,
    camera_lng: float,
    compass_angle: float,
    image_width: int,
    image_height: int,
    camera_focal_px: float | None = None,
    source_width: int | None = None,
    source_height: int | None = None,
    computed_rotation: list | None = None,
    gsv_mode: bool = False,
) -> list[dict]:
    if camera_lat is None or camera_lng is None or not image_width:
        return detections
    try:
        compass = float(compass_angle)
    except (TypeError, ValueError):
        return detections

    hfov = effective_h_fov_deg(
        detection_width=int(image_width),
        camera_focal_px=camera_focal_px,
        source_width=source_width,
    )

    return [
        enrich_detection_geo(
            d,
            camera_lat=float(camera_lat),
            camera_lng=float(camera_lng),
            compass_angle=compass,
            image_width=int(image_width),
            image_height=int(image_height or 0),
            h_fov_deg=hfov,
            camera_focal_px=camera_focal_px,
            source_width=source_width,
            computed_rotation=computed_rotation,
            gsv_mode=gsv_mode,
        )
        for d in detections
    ]


def cluster_points(
    points: list[tuple[float, float]],
    radius_m: float,
) -> list[list[tuple[float, float]]]:
    """Simple single-linkage clustering by haversine distance."""
    if not points:
        return []
    clusters: list[list[tuple[float, float]]] = []
    for pt in points:
        placed = False
        for cluster in clusters:
            if any(haversine_m(pt[0], pt[1], c[0], c[1]) <= radius_m for c in cluster):
                cluster.append(pt)
                placed = True
                break
        if not placed:
            clusters.append([pt])
    return clusters


def cluster_centroid(cluster: list[tuple[float, float]]) -> tuple[float, float]:
    return (
        sum(p[0] for p in cluster) / len(cluster),
        sum(p[1] for p in cluster) / len(cluster),
    )


def lob_angle_difference(b1: float, b2: float) -> float:
    d = abs(b1 - b2) % 360.0
    return min(d, 360.0 - d)


def point_to_segment_m(
    plat: float,
    plng: float,
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
) -> float:
    """Approximate cross-track distance from point to segment AB (local plane)."""
    ref_lat = (a_lat + b_lat) / 2.0
    m_lat = 111320.0
    m_lng = 111320.0 * math.cos(math.radians(ref_lat))

    bx = (b_lng - a_lng) * m_lng
    by = (b_lat - a_lat) * m_lat
    px = (plng - a_lng) * m_lng
    py = (plat - a_lat) * m_lat

    seg_len_sq = bx * bx + by * by
    if seg_len_sq < 1e-6:
        return math.hypot(px, py)

    t = max(0.0, min(1.0, (px * bx + py * by) / seg_len_sq))
    cx = t * bx
    cy = t * by
    return math.hypot(px - cx, py - cy)


def project_point_onto_segment(
    plat: float,
    plng: float,
    a_lat: float,
    a_lng: float,
    b_lat: float,
    b_lng: float,
) -> tuple[float, float, float]:
    """Return projected (lat, lng) on segment AB and cross-track distance in metres."""
    ref_lat = (a_lat + b_lat) / 2.0
    m_lat = 111320.0
    m_lng = 111320.0 * math.cos(math.radians(ref_lat))

    bx = (b_lng - a_lng) * m_lng
    by = (b_lat - a_lat) * m_lat
    px = (plng - a_lng) * m_lng
    py = (plat - a_lat) * m_lat

    seg_len_sq = bx * bx + by * by
    if seg_len_sq < 1e-6:
        return a_lat, a_lng, math.hypot(px, py)

    t = max(0.0, min(1.0, (px * bx + py * by) / seg_len_sq))
    proj_lng = a_lng + (t * bx) / m_lng
    proj_lat = a_lat + (t * by) / m_lat
    cross = math.hypot(px - t * bx, py - t * by)
    return proj_lat, proj_lng, cross


def segment_bearing_deg(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    """Bearing from A to B in degrees from north."""
    d_lng = math.radians(b_lng - a_lng)
    lat1 = math.radians(a_lat)
    lat2 = math.radians(b_lat)
    y = math.sin(d_lng) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(d_lng)
    return normalize_bearing(math.degrees(math.atan2(y, x)))


def row_camera_kwargs(row: dict) -> dict[str, Any]:
    """Extract camera metadata dict from a batch result row."""
    return {
        "camera_focal_px": row.get("camera_focal_px"),
        "source_width": row.get("source_width"),
        "computed_rotation": row.get("computed_rotation"),
    }
