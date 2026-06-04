"""Tests for geolocation bearing and intersection."""

import math

import geolocation as geo


def test_pixel_to_bearing_delta_center():
    assert geo.pixel_to_bearing_delta(320, 640, 90) == 0.0


def test_pixel_to_bearing_delta_right():
    delta = geo.pixel_to_bearing_delta(358, 640, 90)
    assert abs(delta - 5.34375) < 0.01


def test_detection_bearing():
    brg = geo.detection_bearing(0, 358, 640, 90)
    assert abs(brg - 5.34375) < 0.01


def test_horizontal_fov_from_focal():
    # focal = width for ~53° HFOV
    fov = geo.horizontal_fov_deg(1024.0, 1024)
    assert 50 < fov < 56


def test_scaled_focal():
    assert geo.scaled_focal_px(2048.0, 2048, 1024) == 1024.0


def test_geo_anchor_bottom_for_pole():
    det = {"class": "Pole", "bbox": [100, 50, 200, 400], "x_center": 150}
    x, y = geo.geo_anchor_pixel(det, "Pole")
    assert x == 150
    assert y == 400


def test_estimate_distance_from_bbox():
    det = {"class": "Pole", "bbox": [0, 100, 40, 300]}
    dist = geo.estimate_distance_from_bbox(det, "Pole", focal_px=500.0, image_height=768)
    assert dist is not None
    assert geo.MIN_OBJECT_DISTANCE_M <= dist <= geo.LOB_MAX_LENGTH_M


def test_destination_point_north():
    lat, lng = geo.destination_point(0.0, 0.0, 0.0, 111320.0)
    assert abs(lat - 1.0) < 0.01
    assert abs(lng) < 0.01


def test_intersect_lob_perpendicular():
    lat1, lng1 = 0.0, 0.0
    lat2, lng2 = geo.destination_point(0.0, 0.0, 0.0, 10.0)
    pt = geo.intersect_lob_2d(lat1, lng1, 90.0, lat2, lng2, 180.0, max_distance_m=100)
    assert pt is not None
    assert geo.haversine_m(lat1, lng1, pt[0], pt[1]) < 15


def test_cluster_points():
    clusters = geo.cluster_points([(0.0, 0.0), (0.0, 0.00001), (1.0, 1.0)], radius_m=50)
    assert len(clusters) == 2


def test_intersect_lob_rejects_backward_rays():
    lat1, lng1 = 0.0, 0.0
    lat2, lng2 = geo.destination_point(0.0, 0.0, 0.0, 10.0)
    pt = geo.intersect_lob_2d(lat1, lng1, 138.97, lat2, lng2, 128.37, max_distance_m=500)
    assert pt is None


def test_geo_accuracy_label():
    assert "street views" in geo.geo_accuracy_label("lob_triangulation", 3)
    assert geo.geo_accuracy_label("bearing_single") == "Estimated from photo"


def test_enrich_with_per_image_fov():
    det = {"class": "Car", "bbox": [400, 200, 624, 400], "x_center": 512}
    out = geo.enrich_detection_geo(
        det,
        camera_lat=25.0,
        camera_lng=56.0,
        compass_angle=90.0,
        image_width=1024,
        image_height=768,
        camera_focal_px=1024.0,
        source_width=1024,
    )
    assert out.get("bearing_deg") is not None
    assert out.get("geo_lat") is not None
    assert out.get("ray_end_lat") is not None
