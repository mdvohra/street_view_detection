import asyncio
import base64
import logging
import os
import uuid

import cv2
import httpx
import numpy as np
import requests

logger = logging.getLogger(__name__)

INFERENCE_URL = os.getenv("INFERENCE_SERVER_URL", "http://localhost:9001")
API_KEY = os.getenv("ROBOFLOW_API_KEY")
PROJECT_ID = os.getenv("PROJECT_ID", "vehicle-detection-7nnx0")
MODEL_VERSION = os.getenv("MODEL_VERSION", "4")
STREET_LIGHT_PROJECT_ID = os.getenv("STREET_LIGHT_PROJECT_ID", "street-light-ci0on")
STREET_LIGHT_MODEL_VERSION = os.getenv("STREET_LIGHT_MODEL_VERSION", "1")
ENABLE_STREET_LIGHT_MODEL = os.getenv("ENABLE_STREET_LIGHT_MODEL", "true").lower() in (
    "1",
    "true",
    "yes",
)
TRAFFIC_SIGNAL_PROJECT_ID = os.getenv("TRAFFIC_SIGNAL_PROJECT_ID", "traffic-signal-sg7ou")
TRAFFIC_SIGNAL_MODEL_VERSION = os.getenv("TRAFFIC_SIGNAL_MODEL_VERSION", "4")
ENABLE_TRAFFIC_SIGNAL_MODEL = os.getenv("ENABLE_TRAFFIC_SIGNAL_MODEL", "true").lower() in (
    "1",
    "true",
    "yes",
)
IOU_THRESHOLD = float(os.getenv("DETECTION_IOU_THRESHOLD", "0.5"))
CONFIDENCE_MIN = float(os.getenv("DETECTION_CONFIDENCE_MIN", "0.25"))

ENDPOINT = f"{INFERENCE_URL}/infer/object_detection"
PRIMARY_MODEL_ID = f"{PROJECT_ID}/{MODEL_VERSION}"
SECONDARY_MODEL_ID = f"{STREET_LIGHT_PROJECT_ID}/{STREET_LIGHT_MODEL_VERSION}"
TERTIARY_MODEL_ID = f"{TRAFFIC_SIGNAL_PROJECT_ID}/{TRAFFIC_SIGNAL_MODEL_VERSION}"

_optional_models = int(ENABLE_STREET_LIGHT_MODEL) + int(ENABLE_TRAFFIC_SIGNAL_MODEL)
INFERENCE_TIMEOUT = 30.0 + _optional_models * 15.0

# Class colors (BGR for OpenCV)
CLASS_COLORS = {
    "Car": (255, 120, 0),
    "Tree": (80, 200, 0),
    "Street Light": (0, 220, 255),
    "Pole": (255, 80, 200),
    "Building": (50, 100, 255),
    "Motorcycle": (255, 200, 50),
    "Person": (100, 50, 255),
    "Traffic Signal": (0, 255, 200),
}

CLASS_EMOJIS = {
    "Car": "🚗",
    "Tree": "🌳",
    "Street Light": "💡",
    "Pole": "🪧",
    "Building": "🏢",
    "Motorcycle": "🏍️",
    "Person": "🚶",
    "Traffic Signal": "🚦",
}

CLASS_ALIASES = {
    "street light": "Street Light",
    "street-light": "Street Light",
    "streetlight": "Street Light",
    "street_light": "Street Light",
    "StreetLight": "Street Light",
    "Street Light": "Street Light",
    "light": "Street Light",
    "lights": "Street Light",
    "traffic signal": "Traffic Signal",
    "traffic-signal": "Traffic Signal",
    "traffic_signal": "Traffic Signal",
    "traffic sign": "Traffic Signal",
    "traffic-sign": "Traffic Signal",
    "traffic_sign": "Traffic Signal",
    "TrafficSign": "Traffic Signal",
    "Traffic Signal": "Traffic Signal",
    "Traffic Sign": "Traffic Signal",
    "signal": "Traffic Signal",
    "signals": "Traffic Signal",
}


def _normalize_class(name: str) -> str:
    key = name.strip()
    if key in CLASS_ALIASES:
        return CLASS_ALIASES[key]
    lower = key.lower()
    if lower in CLASS_ALIASES:
        return CLASS_ALIASES[lower]
    return key


async def _call_inference(model_id: str, payload: dict) -> dict:
    """Call the local Roboflow Inference Server (object_detection API)."""
    body = {
        "id": str(uuid.uuid4()),
        "api_key": API_KEY,
        "model_id": model_id,
        **payload,
    }
    async with httpx.AsyncClient(timeout=INFERENCE_TIMEOUT) as client:
        resp = await client.post(ENDPOINT, json=body)
        resp.raise_for_status()
        return resp.json()


async def _run_models(image_payload: dict) -> list[tuple[str, dict]]:
    """Run all enabled models in parallel; return (source_model, raw) pairs."""
    specs: list[tuple[str, str]] = [("primary", PRIMARY_MODEL_ID)]
    if ENABLE_STREET_LIGHT_MODEL:
        specs.append(("street_light", SECONDARY_MODEL_ID))
    if ENABLE_TRAFFIC_SIGNAL_MODEL:
        specs.append(("traffic_signal", TERTIARY_MODEL_ID))

    tasks = [_call_inference(model_id, image_payload) for _, model_id in specs]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    ok: list[tuple[str, dict]] = []
    for (source, model_id), result in zip(specs, results):
        if isinstance(result, Exception):
            logger.warning(
                "Inference failed for model %s (%s): %s",
                model_id,
                source,
                result,
            )
            if source == "primary":
                raise result
            continue
        ok.append((source, result))
    return ok


def _iou(box_a: list[int], box_b: list[int]) -> float:
    x1 = max(box_a[0], box_b[0])
    y1 = max(box_a[1], box_b[1])
    x2 = min(box_a[2], box_b[2])
    y2 = min(box_a[3], box_b[3])
    inter_w = max(0, x2 - x1)
    inter_h = max(0, y2 - y1)
    inter = inter_w * inter_h
    if inter == 0:
        return 0.0
    area_a = (box_a[2] - box_a[0]) * (box_a[3] - box_a[1])
    area_b = (box_b[2] - box_b[0]) * (box_b[3] - box_b[1])
    union = area_a + area_b - inter
    return inter / union if union > 0 else 0.0


def _nms_by_class(detections: list[dict], iou_threshold: float) -> list[dict]:
    """Per-class NMS: keep highest-confidence boxes, suppress overlapping duplicates."""
    by_class: dict[str, list[dict]] = {}
    for d in detections:
        by_class.setdefault(d["class"], []).append(d)

    kept: list[dict] = []
    for cls in by_class:
        sorted_dets = sorted(by_class[cls], key=lambda x: x["confidence"], reverse=True)
        selected: list[dict] = []
        for det in sorted_dets:
            if any(_iou(det["bbox"], s["bbox"]) >= iou_threshold for s in selected):
                continue
            selected.append(det)
        kept.extend(selected)
    return kept


def _draw_and_encode(img: np.ndarray, detections: list) -> str:
    """Draw bounding boxes on image, return base64 JPEG string."""
    annotated = img.copy()
    for d in detections:
        x1, y1, x2, y2 = d["bbox"]
        color = CLASS_COLORS.get(d["class"], (180, 180, 180))

        overlay = annotated.copy()
        cv2.rectangle(overlay, (x1, y1), (x2, y2), color, -1)
        cv2.addWeighted(overlay, 0.15, annotated, 0.85, 0, annotated)
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

        label = f"{d['class']} {d['confidence']:.0%}"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
        cv2.rectangle(annotated, (x1, max(y1 - th - 10, 0)), (x1 + tw + 6, y1), color, -1)
        cv2.putText(
            annotated,
            label,
            (x1 + 3, max(y1 - 5, 10)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (255, 255, 255),
            2,
        )

    _, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 88])
    return f"data:image/jpeg;base64,{base64.b64encode(buf).decode()}"


def _parse_predictions(raw: dict, source_model: str = "primary") -> list:
    """Convert inference server response to app detection format."""
    detections = []
    for p in raw.get("predictions", []):
        conf = float(p["confidence"])
        if conf < CONFIDENCE_MIN:
            continue
        cls = _normalize_class(p["class"])
        x, y, w, h = p["x"], p["y"], p["width"], p["height"]
        x1, y1 = int(x - w / 2), int(y - h / 2)
        x2, y2 = int(x + w / 2), int(y + h / 2)
        detections.append(
            {
                "class": cls,
                "confidence": round(conf, 3),
                "bbox": [x1, y1, x2, y2],
                "x_center": int(x),
                "y_center": int(y),
                "emoji": CLASS_EMOJIS.get(cls, "📦"),
                "source_model": source_model,
            }
        )
    return detections


def _merge_detections(raw_results: list[tuple[str, dict]]) -> list[dict]:
    all_dets: list[dict] = []
    for source, raw in raw_results:
        all_dets.extend(_parse_predictions(raw, source_model=source))
    return _nms_by_class(all_dets, IOU_THRESHOLD)


def _count_classes(detections: list) -> dict:
    counts = {}
    for d in detections:
        counts[d["class"]] = counts.get(d["class"], 0) + 1
    return counts


async def detect_from_url(image_url: str) -> dict:
    """Detect objects in a Mapillary street image URL."""
    image_payload = {"image": {"type": "url", "value": image_url}}
    raw_results = await _run_models(image_payload)

    resp = requests.get(image_url, timeout=15)
    resp.raise_for_status()
    arr = np.frombuffer(resp.content, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode URL image for annotation")

    width = height = 0
    if raw_results:
        img_meta = raw_results[0][1].get("image", {})
        width = img_meta.get("width", 0)
        height = img_meta.get("height", 0)
    if not width or not height:
        height, width = img.shape[:2]

    detections = _merge_detections(raw_results)
    return {
        "detections": detections,
        "annotated_image_b64": _draw_and_encode(img, detections),
        "counts": _count_classes(detections),
        "image_size": {"width": width, "height": height},
    }


async def detect_from_base64(b64_str: str) -> dict:
    """Detect objects in a base64-encoded image from browser camera."""
    if "," in b64_str:
        b64_str = b64_str.split(",", maxsplit=1)[1]

    image_payload = {"image": {"type": "base64", "value": b64_str}}
    raw_results = await _run_models(image_payload)

    arr = np.frombuffer(base64.b64decode(b64_str), np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode base64 image for annotation")

    detections = _merge_detections(raw_results)
    return {
        "detections": detections,
        "annotated_image_b64": _draw_and_encode(img, detections),
        "counts": _count_classes(detections),
        "image_size": {"width": img.shape[1], "height": img.shape[0]},
    }


async def health_check() -> bool:
    """Check if the Roboflow Inference Server is reachable."""
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            resp = await client.get(f"{INFERENCE_URL}/")
            return resp.status_code == 200
    except Exception:
        return False


def get_model_config() -> dict:
    """Model registry for /config endpoint."""
    workspace = os.getenv("ROBOFLOW_WORKSPACE", "power-house")
    sl_workspace = os.getenv("STREET_LIGHT_WORKSPACE", "stret-light")
    ts_workspace = os.getenv("TRAFFIC_SIGNAL_WORKSPACE", "power-house")
    return {
        "primary_model_id": PRIMARY_MODEL_ID,
        "secondary_model_id": SECONDARY_MODEL_ID,
        "traffic_signal_model_id": TERTIARY_MODEL_ID,
        "street_light_enabled": ENABLE_STREET_LIGHT_MODEL,
        "traffic_signal_enabled": ENABLE_TRAFFIC_SIGNAL_MODEL,
        "workspace": workspace,
        "street_light_workspace": sl_workspace,
        "traffic_signal_workspace": ts_workspace,
        "project": PROJECT_ID,
        "version": MODEL_VERSION,
        "street_light_project": STREET_LIGHT_PROJECT_ID,
        "street_light_version": STREET_LIGHT_MODEL_VERSION,
        "traffic_signal_project": TRAFFIC_SIGNAL_PROJECT_ID,
        "traffic_signal_version": TRAFFIC_SIGNAL_MODEL_VERSION,
    }
