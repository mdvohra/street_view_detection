"""Fetch Mapillary images inside a polygon (bbox tiling + point-in-polygon filter)."""

from __future__ import annotations

import asyncio
from typing import Callable

from mapillary import _get_images

MAX_BBOX_AREA_DEG2 = 0.0099  # Mapillary limit is 0.01 deg²
BBOX_LIMIT = 2000


def _bbox_area(west: float, south: float, east: float, north: float) -> float:
    return abs(east - west) * abs(north - south)


def _subdivide_bbox(
    west: float, south: float, east: float, north: float
) -> list[tuple[float, float, float, float]]:
    """Split bbox into tiles each smaller than MAX_BBOX_AREA_DEG2."""
    if _bbox_area(west, south, east, north) <= MAX_BBOX_AREA_DEG2:
        return [(west, south, east, north)]

    if (east - west) >= (north - south):
        mid = (west + east) / 2
        return _subdivide_bbox(west, south, mid, north) + _subdivide_bbox(mid, south, east, north)
    mid = (south + north) / 2
    return _subdivide_bbox(west, south, east, mid) + _subdivide_bbox(west, mid, east, north)


def polygon_bbox(polygon: list[list[float]]) -> tuple[float, float, float, float]:
    lngs = [p[0] for p in polygon]
    lats = [p[1] for p in polygon]
    return min(lngs), min(lats), max(lngs), max(lats)


def point_in_polygon(lng: float, lat: float, polygon: list[list[float]]) -> bool:
    """Ray-casting; polygon vertices as [lng, lat]."""
    n = len(polygon)
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i][0], polygon[i][1]
        xj, yj = polygon[j][0], polygon[j][1]
        if ((yi > lat) != (yj > lat)) and (
            lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-15) + xi
        ):
            inside = not inside
        j = i
    return inside


def _image_to_batch_info(image: dict) -> dict:
    coords = image["geometry"]["coordinates"]
    image_lat, image_lng = coords[1], coords[0]
    thumb = (
        image.get("thumb_1024_url")
        or image.get("thumb_2048_url")
        or image.get("thumb_256_url")
        or ""
    )
    return {
        "image_id": str(image["id"]),
        "thumb_url": thumb,
        "captured_at": image.get("captured_at", ""),
        "compass_angle": image.get("compass_angle", 0),
        "sequence_id": image.get("sequence_id", ""),
        "image_lat": image_lat,
        "image_lng": image_lng,
    }


async def fetch_images_in_polygon(
    polygon: list[list[float]],
    *,
    should_cancel: Callable[[], bool] | None = None,
) -> tuple[list[dict], str | None]:
    """
    Discover all Mapillary images with coordinates inside polygon.
    polygon: [[lng, lat], ...] closed or open ring.
    """
    if len(polygon) < 3:
        return [], "Polygon must have at least 3 points"

    ring = polygon[:]
    if ring[0] != ring[-1]:
        ring = ring + [ring[0]]

    west, south, east, north = polygon_bbox(ring)
    tiles = _subdivide_bbox(west, south, east, north)

    seen: set[str] = set()
    matched: list[dict] = []

    for west_t, south_t, east_t, north_t in tiles:
        if should_cancel and should_cancel():
            break

        bbox = f"{west_t},{south_t},{east_t},{north_t}"
        images, err = await _get_images({"bbox": bbox, "is_pano": "false", "limit": BBOX_LIMIT})
        if err:
            return matched, err

        for image in images:
            img_id = str(image.get("id", ""))
            if not img_id or img_id in seen:
                continue
            coords = image.get("geometry", {}).get("coordinates")
            if not coords or len(coords) < 2:
                continue
            lng, lat = coords[0], coords[1]
            if not point_in_polygon(lng, lat, ring):
                continue
            seen.add(img_id)
            info = _image_to_batch_info(image)
            if info["thumb_url"]:
                matched.append(info)

        # Brief yield so cancel can be processed between tiles
        await asyncio.sleep(0)

    return matched, None
