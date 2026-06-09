"""Tests for GSV horizon ray ground intersection."""

import gsv_camera_ray as gcr


def test_ground_hit_below_horizon():
    result = gcr.ground_hit_from_horizon(
        anchor_x=640.0,
        anchor_y=500.0,
        camera_lat=40.444502,
        camera_lng=-80.001,
        compass_angle=117.0,
        image_width=1280,
        image_height=768,
        focal_px=640.0,
        camera_alt_m=2.5,
        h_fov_deg=90.0,
    )
    assert result is not None
    assert result["geo_method"] == "gsv_horizon_ray"
    assert 3.0 <= result["geo_distance_m"] <= 50.0
    assert result["geo_lat"] != 40.444502


def test_ground_hit_rejects_above_horizon():
    result = gcr.ground_hit_from_horizon(
        anchor_x=640.0,
        anchor_y=300.0,
        camera_lat=40.444502,
        camera_lng=-80.001,
        compass_angle=117.0,
        image_width=1280,
        image_height=768,
        focal_px=640.0,
    )
    assert result is None
