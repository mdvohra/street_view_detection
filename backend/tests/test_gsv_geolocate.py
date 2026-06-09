"""Tests for GSV geolocate fusion and deduplication."""

import gsv_geolocate as gg


def _det(cls: str, view: int, lat: float, lng: float, **kwargs) -> dict:
    return {
        "class": cls,
        "view": view,
        "geo_lat": lat,
        "geo_lng": lng,
        "confidence": kwargs.get("confidence", 0.8),
        "geo_method": kwargs.get("geo_method", "bearing_size"),
        "geo_distance_m": kwargs.get("geo_distance_m"),
        "bbox": kwargs.get("bbox", [100, 100, 140, 300]),
        "camera_lat": kwargs.get("camera_lat", lat - 0.00005),
        "camera_lng": kwargs.get("camera_lng", lng),
        "bearing_deg": kwargs.get("bearing_deg", 90.0),
    }


def test_fuse_location_dedupes_multi_view():
    base_lat, base_lng = 28.61, -81.20
    dets = [
        _det("Traffic Signal", 1, base_lat + 0.0001, base_lng + 0.0001, confidence=0.7),
        _det("Traffic Signal", 2, base_lat + 0.00011, base_lng + 0.00009, confidence=0.9),
        _det("Traffic Signal", 4, base_lat + 0.00009, base_lng + 0.00011, confidence=0.75),
    ]
    official = gg.fuse_location_objects(42, dets)
    assert len(official) == 1
    assert official[0]["support_count"] == 3
    assert set(official[0]["support_views"]) == {1, 2, 4}


def test_fuse_location_keeps_distinct_classes():
    base_lat, base_lng = 28.61, -81.20
    dets = [
        _det("Traffic Signal", 1, base_lat, base_lng),
        _det("Street Light", 2, base_lat + 0.0002, base_lng + 0.0002),
    ]
    official = gg.fuse_location_objects(1, dets)
    assert len(official) == 2


def test_official_counts():
    objects = [
        {"class": "Traffic Signal", "tier": "official", "geo_quality": "high"},
        {"class": "Traffic Signal", "tier": "estimated", "geo_quality": "low"},
    ]
    assert gg.official_counts_from_objects(objects)["Traffic Signal"] == 2
    assert gg.official_counts_from_objects(objects, verified_only=True)["Traffic Signal"] == 1


def test_fuse_cluster_uses_best_not_average():
    base_lat, base_lng = 28.61, -81.20
    cam_lat, cam_lng = base_lat - 0.00005, base_lng
    dets = [
        _det(
            "Street Light",
            1,
            base_lat + 0.00008,
            base_lng + 0.00008,
            geo_method="bearing_single",
            bearing_deg=90.0,
            geo_distance_m=30.0,
            camera_lat=cam_lat,
            camera_lng=cam_lng,
        ),
        _det(
            "Street Light",
            2,
            base_lat + 0.00006,
            base_lng + 0.00006,
            geo_method="bearing_size",
            bearing_deg=92.0,
            geo_distance_m=12.0,
            camera_lat=cam_lat,
            camera_lng=cam_lng,
        ),
    ]
    official = gg.fuse_location_objects(99, dets)
    assert len(official) == 1
    assert official[0]["geo_method"] == "bearing_size"
    assert official[0]["geo_distance_m"] == 21.0


def test_excludes_bearing_single_static_from_official():
    dets = [
        _det("Car", 1, 28.61, -81.20, geo_method="bearing_single"),
        _det("Street Light", 2, 28.6101, -81.2001, geo_method="bearing_single"),
    ]
    official = gg.fuse_location_objects(1, dets)
    classes = {o["class"] for o in official}
    assert "Car" in classes
    assert "Street Light" not in classes


def test_process_panorama_returns_official_fields():
    dets = [
        _det("Traffic Signal", 1, 28.61, -81.20),
        _det("Traffic Signal", 3, 28.61001, -81.2001),
    ]
    result = gg.process_panorama_official_objects(5, dets)
    assert "official_objects" in result
    assert "official_counts" in result
    assert result["official_counts"].get("Traffic Signal", 0) == 1
