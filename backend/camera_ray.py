"""3D camera ray to ground-plane intersection using Mapillary OpenSfM metadata."""

from __future__ import annotations

import math
from typing import Any

import geolocation as geo


def _axis_angle_to_matrix(axis_angle: list[float]) -> list[list[float]]:
    """Rodrigues: OpenSfM computed_rotation as axis-angle vector."""
    ax, ay, az = (float(axis_angle[i]) for i in range(3))
    angle = math.sqrt(ax * ax + ay * ay + az * az)
    if angle < 1e-12:
        return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]]
    ux, uy, uz = ax / angle, ay / angle, az / angle
    c = math.cos(angle)
    s = math.sin(angle)
    t = 1.0 - c
    return [
        [t * ux * ux + c, t * ux * uy - s * uz, t * ux * uz + s * uy],
        [t * ux * uy + s * uz, t * uy * uy + c, t * uy * uz - s * ux],
        [t * ux * uz - s * uy, t * uy * uz + s * ux, t * uz * uz + c],
    ]


def _mat_vec(m: list[list[float]], v: tuple[float, float, float]) -> tuple[float, float, float]:
    return (
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    )


def _normalize(v: tuple[float, float, float]) -> tuple[float, float, float]:
    n = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    if n < 1e-12:
        return (0.0, 0.0, 1.0)
    return (v[0] / n, v[1] / n, v[2] / n)


def _camera_ray_direction(
    anchor_x: float,
    anchor_y: float,
    image_width: int,
    image_height: int,
    focal_px: float,
    computed_rotation: list[float] | None,
) -> tuple[float, float, float]:
    """
    Ray in OpenSfM camera frame: x right, y down, z forward.
    Returns unit direction after optional computed_rotation.
    """
    cx = image_width / 2.0
    cy = image_height / 2.0
    raw = ((anchor_x - cx) / focal_px, (anchor_y - cy) / focal_px, 1.0)
    direction = _normalize(raw)
    if computed_rotation and len(computed_rotation) >= 3:
        rot = _axis_angle_to_matrix(computed_rotation)
        direction = _normalize(_mat_vec(rot, direction))
    return direction


def _enu_bearing_from_direction(dx: float, dy: float, dz: float, compass_deg: float) -> float:
    """
    Map camera-forward ray to ground bearing (degrees from north).
    compass_deg aligns camera +Z with horizontal projection at image center.
    Horizontal offset from pixel projects as additional yaw.
    """
    horiz = math.sqrt(dx * dx + dy * dy)
    if horiz < 1e-9:
        return geo.normalize_bearing(compass_deg)
    pixel_yaw = math.degrees(math.atan2(dx, dz))
    return geo.normalize_bearing(compass_deg + pixel_yaw)


def ground_intersection(
    camera_lat: float,
    camera_lng: float,
    bearing_deg: float,
    distance_m: float,
) -> tuple[float, float]:
    """Project horizontal bearing + slant range to lat/lng (flat ground)."""
    return geo.destination_point(camera_lat, camera_lng, bearing_deg, distance_m)


def detection_geo_from_camera_ray(
    *,
    anchor_x: float,
    anchor_y: float,
    camera_lat: float,
    camera_lng: float,
    compass_angle: float,
    image_width: int,
    image_height: int,
    focal_px: float,
    computed_rotation: list[float] | None = None,
    camera_alt_m: float = 2.5,
) -> dict[str, Any] | None:
    """
    Intersect sight ray with flat ground plane below the camera.
    Returns bearing_deg, distance_m, geo_lat, geo_lng or None if ray misses ground.
    """
    if focal_px <= 0 or image_width < 1 or image_height < 1:
        return None

    dx, dy, dz = _camera_ray_direction(
        anchor_x,
        anchor_y,
        image_width,
        image_height,
        focal_px,
        computed_rotation,
    )
    if dy <= 1e-6:
        return None

    # Camera frame y-down: positive dy = below horizon → hits ground in front
    t = camera_alt_m / dy
    if t <= 0:
        return None

    forward_m = dz * t
    lateral_m = dx * t
    distance_m = math.sqrt(forward_m * forward_m + lateral_m * lateral_m)
    if distance_m <= 0 or distance_m > geo.LOB_MAX_LENGTH_M:
        return None

    bearing = _enu_bearing_from_direction(dx, dy, dz, float(compass_angle))
    bearing = geo.normalize_bearing(bearing + geo.COMPASS_BEARING_OFFSET_DEG)
    geo_lat, geo_lng = ground_intersection(camera_lat, camera_lng, bearing, distance_m)
    ray_end_lat, ray_end_lng = geo.lob_endpoint(camera_lat, camera_lng, bearing, geo.LOB_MAX_LENGTH_M)

    return {
        "bearing_deg": round(bearing, 2),
        "geo_lat": round(geo_lat, 7),
        "geo_lng": round(geo_lng, 7),
        "geo_distance_m": round(distance_m, 2),
        "geo_method": "camera_ray_3d",
        "ray_end_lat": round(ray_end_lat, 7),
        "ray_end_lng": round(ray_end_lng, 7),
    }
