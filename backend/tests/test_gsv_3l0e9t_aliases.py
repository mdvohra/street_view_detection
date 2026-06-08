"""Tests for 3-l0e9t/14 class alias normalization (no inference)."""

from __future__ import annotations

import detector


def test_3l0e9t_overlap_aliases():
    assert detector._normalize_class("car") == "Car"
    assert detector._normalize_class("motorcycle") == "Motorcycle"
    assert detector._normalize_class("person") == "Person"
    assert detector._normalize_class("traffic light") == "Traffic Signal"
    assert detector._normalize_class("tree trunk") == "Tree"


def test_3l0e9t_passthrough_aliases():
    assert detector._normalize_class("truck") == "Truck"
    assert detector._normalize_class("bus") == "Bus"
    assert detector._normalize_class("bicycle") == "Bicycle"
    assert detector._normalize_class("train") == "Train"
    assert detector._normalize_class("bench") == "Bench"
    assert detector._normalize_class("fire hydrant") == "Fire Hydrant"
    assert detector._normalize_class("potted plant") == "Potted Plant"
    assert detector._normalize_class("Dustbin") == "Dustbin"
    assert detector._normalize_class("Bollards") == "Bollards"
    assert detector._normalize_class("Garbage container") == "Garbage Container"
    assert detector._normalize_class("Stairs") == "Stairs"
    assert detector._normalize_class("Street railing") == "Street Railing"


def test_gsv_registry_includes_3l0e9t():
    registry = detector.get_gsv_continued_model_registry()
    assert any(e["model_id"] == "3-l0e9t/14" for e in registry)
    assert any(e["source"] == "street_assets_3l0e9t" for e in registry)
    specs = detector._gsv_continued_model_specs()
    assert ("street_assets_3l0e9t", "3-l0e9t/14") in specs
