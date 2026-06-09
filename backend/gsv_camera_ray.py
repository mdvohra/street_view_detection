"""GSV side-view horizon ray: ground distance from anchor pixel without OpenSfM rotation."""

from __future__ import annotations

import math
from typing import Any

import geolocation as geo


def ground_hit_from_horizon(
    *,
    anchor_x: float,
    anchor_y: float,
    camera_lat: float,
    camera_lng: float,
    compass_angle: float,
    image_width: int,
    image_height: int,
    focal_px: float,
    camera_alt_m: float | None = None,
    h_fov_deg: float | None = None,
) -> dict[str, Any] | None:
    """
    Intersect a sight ray with flat ground assuming GSV side tiles are near-level.
    Horizon approximated at image vertical center; depression angle from anchor below horizon.
    """
    if focal_px <= 0 or image_width < 1 or image_height < 1:
        return None

    alt_m = camera_alt_m if camera_alt_m is not None else geo.CAMERA_ALTITUDE_M
    hfov = h_fov_deg if h_fov_deg is not None else geo.gsv_effective_h_fov_deg()
    cy = image_height / 2.0
    dy_px = anchor_y - cy
    if dy_px <= 1.0:
        return None

    depression_rad = math.atan(dy_px / focal_px)
    if depression_rad <= 0.01:
        return None

    distance_m = alt_m / math.tan(depression_rad)
    if distance_m < geo.MIN_OBJECT_DISTANCE_M or distance_m > geo.LOB_MAX_LENGTH_M:
        return None

    delta_x = geo.pixel_to_bearing_delta(int(anchor_x), image_width, hfov)
    bearing = geo.normalize_bearing(float(compass_angle) + delta_x + geo.COMPASS_BEARING_OFFSET_DEG)
    geo_lat, geo_lng = geo.destination_point(camera_lat, camera_lng, bearing, distance_m)
    ray_end_lat, ray_end_lng = geo.lob_endpoint(camera_lat, camera_lng, bearing, geo.LOB_MAX_LENGTH_M)

    return {
        "bearing_deg": round(bearing, 2),
        "geo_lat": round(geo_lat, 7),
        "geo_lng": round(geo_lng, 7),
        "geo_distance_m": round(distance_m, 2),
        "geo_method": "gsv_horizon_ray",
        "ray_end_lat": round(ray_end_lat, 7),
        "ray_end_lng": round(ray_end_lng, 7),
    }
