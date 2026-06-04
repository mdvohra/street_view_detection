import math
import os

import httpx

MAPILLARY_BASE = "https://graph.mapillary.com"
_token = None

IMAGE_FIELDS = (
    "id,thumb_1024_url,thumb_2048_url,thumb_256_url,"
    "captured_at,compass_angle,computed_compass_angle,geometry,sequence,"
    "width,height,camera_parameters,camera_type,computed_rotation,make,model"
)


def sequence_from_image(image: dict) -> str:
    """Mapillary Graph API returns `sequence`, not `sequence_id`, on image objects."""
    return str(image.get("sequence_id") or image.get("sequence") or "")


def focal_length_px(image: dict) -> float | None:
    """OpenSfM camera_parameters[0] is focal length in pixels (original image width)."""
    params = image.get("camera_parameters")
    if not params or not isinstance(params, (list, tuple)) or len(params) < 1:
        return None
    try:
        focal = float(params[0])
    except (TypeError, ValueError):
        return None
    return focal if focal > 0 else None


def camera_metadata_from_image(image: dict) -> dict:
    """Extract geolocation-relevant camera fields from a Mapillary image dict."""
    rotation = image.get("computed_rotation")
    if rotation is not None and not isinstance(rotation, list):
        rotation = None
    source_w = image.get("width")
    source_h = image.get("height")
    try:
        source_w = int(source_w) if source_w else None
    except (TypeError, ValueError):
        source_w = None
    try:
        source_h = int(source_h) if source_h else None
    except (TypeError, ValueError):
        source_h = None
    return {
        "camera_focal_px": focal_length_px(image),
        "camera_type": str(image.get("camera_type") or ""),
        "computed_rotation": rotation,
        "source_width": source_w,
        "source_height": source_h,
        "make": str(image.get("make") or ""),
        "model": str(image.get("model") or ""),
    }


def compass_from_image(image: dict) -> float:
    """
    Camera heading in degrees clockwise from north.

    Default: EXIF ``compass_angle`` — better for horizontal LOB rays in practice.
    Set ``USE_COMPUTED_COMPASS_ANGLE=true`` to prefer SfM ``computed_compass_angle``.
    """
    use_computed = os.getenv("USE_COMPUTED_COMPASS_ANGLE", "").lower() in ("1", "true", "yes")
    if use_computed:
        computed = image.get("computed_compass_angle")
        if computed is not None:
            return float(computed)
    return float(image.get("compass_angle") or 0)


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
    meta = camera_metadata_from_image(image)
    return {
        "image_id": image["id"],
        "thumb_url": thumb,
        "captured_at": image.get("captured_at", ""),
        "compass_angle": compass_from_image(image),
        "sequence_id": sequence_from_image(image),
        "image_lat": image_lat,
        "image_lng": image_lng,
        "distance_m": round(_haversine_m(click_lat, click_lng, image_lat, image_lng), 1),
        **meta,
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
