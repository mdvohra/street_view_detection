import math
import os

import httpx

MAPILLARY_BASE = "https://graph.mapillary.com"
_token = None

IMAGE_FIELDS = (
    "id,thumb_1024_url,thumb_2048_url,thumb_256_url,"
    "captured_at,compass_angle,geometry,sequence_id"
)


def init() -> None:
    global _token
    _token = os.getenv("MAPILLARY_ACCESS_TOKEN")
    if not _token:
        raise ValueError("MAPILLARY_ACCESS_TOKEN not set in .env")


def _params(extra: dict | None = None) -> dict:
    params = {"access_token": _token, "fields": IMAGE_FIELDS}
    if extra:
        params.update(extra)
    return params


def _haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    earth_radius_m = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return earth_radius_m * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _image_to_info(image: dict, click_lat: float, click_lng: float) -> dict:
    coords = image["geometry"]["coordinates"]
    image_lat, image_lng = coords[1], coords[0]
    thumb = (
        image.get("thumb_1024_url")
        or image.get("thumb_2048_url")
        or image.get("thumb_256_url")
        or ""
    )
    return {
        "image_id": image["id"],
        "thumb_url": thumb,
        "captured_at": image.get("captured_at", ""),
        "compass_angle": image.get("compass_angle", 0),
        "sequence_id": image.get("sequence_id", ""),
        "image_lat": image_lat,
        "image_lng": image_lng,
        "distance_m": round(_haversine_m(click_lat, click_lng, image_lat, image_lng), 1),
    }


async def _get_images(params: dict) -> tuple[list[dict], str | None]:
    """Call /images and return (data list, error message)."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(f"{MAPILLARY_BASE}/images", params=_params(params))

    if resp.status_code != 200:
        try:
            body = resp.json()
            err = body.get("error", {}).get("message", resp.text)
        except Exception:
            err = resp.text or f"HTTP {resp.status_code}"
        return [], f"Mapillary API error ({resp.status_code}): {err}"

    data = resp.json()
    if isinstance(data, dict) and "data" in data:
        return data.get("data", []), None
    if isinstance(data, dict) and data.get("id"):
        return [data], None
    return [], "Unexpected Mapillary API response"


async def fetch_nearest_image(lat: float, lng: float) -> tuple[dict | None, str | None]:
    """
    Find the nearest Mapillary image using radius search (up to 50 m).
    Returns (image_info, error_message).
    """
    images, err = await _get_images(
        {"lat": lat, "lng": lng, "radius": 50, "limit": 20},
    )
    if err:
        return None, err
    if not images:
        # Fallback for sparse areas: bbox search with progressively wider boxes.
        # Keeps bbox area << 0.01 degrees square API limit.
        for radius_deg in [0.001, 0.0025, 0.0045]:
            bbox = f"{lng - radius_deg},{lat - radius_deg},{lng + radius_deg},{lat + radius_deg}"
            images, err = await _get_images(
                {"bbox": bbox, "is_pano": "false", "limit": 100},
            )
            if err:
                return None, err
            if images:
                break

    if not images:
        return None, None

    best = min(
        images,
        key=lambda img: _haversine_m(
            lat,
            lng,
            img["geometry"]["coordinates"][1],
            img["geometry"]["coordinates"][0],
        ),
    )
    return _image_to_info(best, lat, lng), None


async def fetch_image_by_id(image_id: str, click_lat: float, click_lng: float) -> tuple[dict | None, str | None]:
    """Fetch a specific image by Mapillary image ID."""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{MAPILLARY_BASE}/{image_id}",
            params={"access_token": _token, "fields": IMAGE_FIELDS},
        )

    if resp.status_code != 200:
        try:
            body = resp.json()
            err = body.get("error", {}).get("message", resp.text)
        except Exception:
            err = resp.text or f"HTTP {resp.status_code}"
        return None, f"Mapillary API error ({resp.status_code}): {err}"

    image = resp.json()
    if not image.get("id"):
        return None, "Image not found"
    return _image_to_info(image, click_lat, click_lng), None
