"""Tests for GSV continued view headings and GSV-specific geolocation helpers."""

import os

import geolocation as geo
import gsv_continued_service as gsv


def test_normalize_compass_ccw():
    assert abs(gsv.normalize_compass(115.74) - 244.26) < 0.01


def test_view_heading_view4_matches_compass_bearing():
    h = gsv.view_heading(115.74, 4)
    assert h is not None
    assert abs(h - gsv.normalize_compass(115.74)) < 0.01


def test_view_heading_overlay_and_sky_none():
    assert gsv.view_heading(115.74, 0) is None
    assert gsv.view_heading(115.74, 5) is None


def test_view_heading_side_views_90_apart():
    base = gsv.normalize_compass(115.74)
    headings = [gsv.view_heading(115.74, v) for v in (1, 2, 3, 4)]
    assert all(h is not None for h in headings)
    deltas = sorted((h - base) % 360.0 for h in headings)
    assert len(deltas) == 4
    for i, expected in enumerate((0.0, 90.0, 180.0, 270.0)):
        assert abs(deltas[i] - expected) < 0.01


def test_side_view_for_bearing_aligned_with_view4():
    base = gsv.normalize_compass(115.74)
    assert gsv.side_view_for_bearing(115.74, base) == 4


def test_side_view_for_bearing_quadrants():
    base = gsv.normalize_compass(0.0)
    assert gsv.side_view_for_bearing(0.0, base) == 4
    assert gsv.side_view_for_bearing(0.0, (base + 90) % 360) == 3
    assert gsv.side_view_for_bearing(0.0, (base + 180) % 360) == 2
    assert gsv.side_view_for_bearing(0.0, (base + 270) % 360) == 1


def test_focal_px_from_hfov_1280_90():
    focal = geo.focal_px_from_hfov(1280, 90.0)
    assert abs(focal - 640.0) < 0.01


def test_gsv_effective_h_fov_uses_default():
    assert geo.gsv_effective_h_fov_deg() == geo.HORIZONTAL_FOV_DEG * geo.HFOV_SCALE


def test_gsv_effective_h_fov_override(monkeypatch):
    monkeypatch.setenv("GSV_HORIZONTAL_FOV_DEG", "60")
    import importlib

    importlib.reload(geo)
    try:
        assert geo.gsv_effective_h_fov_deg() == 60.0 * geo.HFOV_SCALE
    finally:
        monkeypatch.delenv("GSV_HORIZONTAL_FOV_DEG", raising=False)
        importlib.reload(geo)


def test_gsv_compass_ccw_env_false(monkeypatch):
    monkeypatch.setenv("GSV_COMPASS_CCW", "false")
    import importlib

    importlib.reload(gsv)
    try:
        assert abs(gsv.view_heading(115.74, 4) - 115.74) < 0.01
    finally:
        monkeypatch.setenv("GSV_COMPASS_CCW", "true")
        importlib.reload(gsv)
