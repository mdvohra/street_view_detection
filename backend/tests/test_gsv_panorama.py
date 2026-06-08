"""Tests for GSV Continued panorama helpers (no inference)."""

from __future__ import annotations

import base64

import cv2
import numpy as np
import pytest

import gsv_continued_service as gsv
import detector


def test_pano_side_views_for_location_filters_to_available():
    views = gsv.pano_side_views_for_location(1)
    assert views == [1, 2, 3, 4]


def test_pano_side_views_invalid_location():
    with pytest.raises(ValueError, match="Invalid GSV continued location"):
        gsv.pano_side_views_for_location(999999999)


def test_stitch_annotated_panorama_dimensions():
    tiles = [
        np.zeros((100, 80, 3), dtype=np.uint8),
        np.zeros((120, 60, 3), dtype=np.uint8),
    ]
    tiles[0][:, :] = (0, 0, 255)
    tiles[1][:, :] = (0, 255, 0)

    out_b64 = detector.stitch_annotated_panorama(tiles)
    assert out_b64.startswith("data:image/jpeg;base64,")

    raw = base64.b64decode(out_b64.split(",", 1)[1])
    img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    assert img is not None
    # Title band (48px) + max tile height (120)
    assert img.shape[0] == 168
    # Resized widths: 80*(120/100)=96 + 60 = 156
    assert img.shape[1] == 156


def test_stitch_annotated_panorama_empty_raises():
    with pytest.raises(ValueError, match="No tiles"):
        detector.stitch_annotated_panorama([])
