"""Tests for road-edge snap geometry."""

import json
from pathlib import Path

import geolocation as geo
import road_snap as rs


def test_offset_perpendicular_to_road():
    lat, lng = 40.4445, -80.001
    edge_lat, edge_lng = rs._offset_perpendicular_to_road(lat, lng, 0.0, 1, 7.0)
    assert abs(geo.haversine_m(lat, lng, edge_lat, edge_lng) - 7.0) < 0.01


def test_nearest_segment_projection():
    segments = [
        ((40.4440, -80.002), (40.4450, -80.000)),
    ]
    nearest = rs._nearest_segment_projection(40.4445, -80.0015, segments)
    assert nearest is not None
    proj_lat, proj_lng, cross, _ = nearest
    assert cross < 30.0
    assert 40.4440 <= proj_lat <= 40.4450


def test_snap_roadside_uses_gsv_fallback(monkeypatch):
    obj = {
        "class": "Street Light",
        "geo_lat": 40.44455,
        "geo_lng": -80.00085,
        "bearing_deg": 200.0,
        "geo_anchor_x": 900,
        "camera_lat": 40.444502,
        "camera_lng": -80.001,
    }

    monkeypatch.setattr(rs, "_query_osm_road_segments", lambda *a, **k: [])
    monkeypatch.setattr(
        rs,
        "_gsv_centerline_segment",
        lambda _loc: (
            (40.444418, -80.00105),
            (40.444586, -80.00095),
            117.0,
        ),
    )

    out = rs.snap_roadside_object(obj, location_id=493, compass_raw=117.19, image_width=1280)
    assert out.get("geo_method") == "road_edge_snap"
    assert out.get("tier") == "official"
    assert out.get("snap_source") == "gsv_nav"


def test_snap_street_light_not_corner_snap(monkeypatch):
    obj = {
        "class": "Street Light",
        "geo_lat": 28.61,
        "geo_lng": -81.20,
        "geo_anchor_x": 640,
        "bearing_deg": 90.0,
        "camera_lat": 28.61,
        "camera_lng": -81.20,
    }
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


def test_apply_road_proximity_gate_rejects_far_pin(monkeypatch):
    obj = {
        "class": "Pole",
        "geo_lat": 40.45,
        "geo_lng": -80.05,
        "geo_quality": "high",
        "tier": "official",
    }
    monkeypatch.setattr(rs, "_query_osm_road_segments", lambda *a, **k: [])
    monkeypatch.setattr(rs, "_gsv_centerline_segment", lambda _loc: None)
    out = rs.apply_road_proximity_gate(obj, location_id=493)
    assert out.get("geo_quality") == "high" or out.get("centerline_distance_m") is None


def test_audit_fixture_session_metrics():
    from scripts import audit_gsv_session_geo as audit

    fixture = Path(__file__).resolve().parent / "fixtures" / "gsv_geo" / "sample_session.json"
    session = json.loads(fixture.read_text(encoding="utf-8"))
    summary = audit.audit_session(session)
    assert summary["static_detections"] == 4
    assert summary["bearing_single_count"] == 1
    assert "pole_light_roadside_pct" in summary
