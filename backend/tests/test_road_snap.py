"""Tests for intersection corner snap geometry."""

import road_snap as rs


def test_pick_corner_ahead_right():
    center_lat, center_lng = 28.61, -81.20
    road_bearing = 0.0
    det_bearing = 30.0
    lat, lng = rs._pick_corner(center_lat, center_lng, road_bearing, det_bearing, lateral_sign=1)
    assert lat != center_lat or lng != center_lng


def test_snap_corner_not_road_edge_for_signal(monkeypatch):
    obj = {"class": "Street Light", "geo_lat": 28.61, "geo_lng": -81.20, "geo_anchor_x": 640}
    monkeypatch.setattr(rs, "_query_osm_intersections", lambda *a, **k: [])
    monkeypatch.setattr(rs, "_gsv_intersection_center", lambda *_: None)
    monkeypatch.setattr(rs, "SNAP_USE_GEOMETRIC_FALLBACK", False)
    monkeypatch.setattr(rs, "_query_osm_road_segments", lambda *a, **k: [])
    monkeypatch.setattr(
        rs,
        "_gsv_centerline_segment",
        lambda _loc: ((28.61, -81.20), (28.611, -81.199), 90.0),
    )
    out = rs.snap_official_object(obj, location_id=1, compass_raw=115.0, image_width=1280)
    assert out.get("geo_method") != "intersection_corner_snap"


def test_nav_degree_counts_links():
    nav = {"forward": 1, "backward": 2, "left": 3, "right": 4}
    assert rs._nav_degree(nav) == 4
    assert rs._is_intersection_nav(nav)


def test_geometric_fallback_uses_forward_nav(monkeypatch):
    obj = {
        "class": "Traffic Signal",
        "geo_lat": 40.440898,
        "geo_lng": -80.0005,
        "bearing_deg": 240.0,
        "geo_distance_m": 13.0,
        "geo_anchor_x": 900,
        "camera_lat": 40.440818,
        "camera_lng": -80.0005,
    }

    monkeypatch.setattr(rs, "_query_osm_intersections", lambda *a, **k: [])
    monkeypatch.setattr(rs, "_gsv_intersection_center", lambda *_: None)
    monkeypatch.setattr(
        rs.gsv_continued_service,
        "get_location",
        lambda loc_id: {
            "id": 790,
            "lat": 40.440818,
            "lng": -80.0005,
            "compass": 117.19,
            "nav": {"forward": 791, "backward": 789, "left": None, "right": None},
        }
        if loc_id == 790
        else {"id": 791, "lat": 40.440737, "lng": -80.0003, "compass": 117.0, "nav": {}},
    )
    monkeypatch.setattr(
        rs.gsv_continued_service,
        "normalize_compass",
        lambda c: (360.0 - float(c)) % 360.0,
    )

    out = rs.snap_official_object(obj, location_id=790, compass_raw=117.19, image_width=1280)
    assert out.get("geo_method") == "intersection_corner_snap"
    assert out.get("snap_source") == "geometric"
    assert out.get("tier") == "official"


def test_snap_rejects_large_displacement(monkeypatch):
    obj = {
        "class": "Traffic Signal",
        "geo_lat": 28.61,
        "geo_lng": -81.20,
        "bearing_deg": 90.0,
        "geo_anchor_x": 900,
    }

    def fake_osm(*_args, **_kwargs):
        return [(28.62, -81.21)]

    monkeypatch.setattr(rs, "_query_osm_intersections", fake_osm)
    monkeypatch.setattr(rs, "SNAP_MAX_DISPLACEMENT_M", 5.0)
    out = rs.snap_official_object(obj, location_id=1, compass_raw=115.0, image_width=1280)
    assert out.get("snap_rejected") is True
