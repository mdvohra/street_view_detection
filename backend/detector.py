import asyncio
import base64
import logging
import os
import time
import uuid

import cv2
import httpx
import numpy as np
import requests

logger = logging.getLogger(__name__)

INFERENCE_URL = os.getenv("INFERENCE_SERVER_URL", "http://localhost:9001")
API_KEY = os.getenv("ROBOFLOW_API_KEY")
# When false, omit api_key from requests — use ROBOFLOW_API_KEY on the inference server container.
SEND_API_KEY = os.getenv("INFERENCE_SEND_API_KEY", "false").lower() in (
    "1",
    "true",
    "yes",
)
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
GSV_STREET_LIGHT_PK0ZZ_PROJECT_ID = os.getenv(
    "GSV_STREET_LIGHT_PK0ZZ_PROJECT_ID", "street-light-pkozz"
)
GSV_STREET_LIGHT_PK0ZZ_MODEL_VERSION = os.getenv("GSV_STREET_LIGHT_PK0ZZ_MODEL_VERSION", "1")
ENABLE_GSV_STREET_LIGHT_PK0ZZ = os.getenv("ENABLE_GSV_STREET_LIGHT_PK0ZZ", "true").lower() in (
    "1",
    "true",
    "yes",
)
GSV_TRAFFIC_SIGNS_PROJECT_ID = os.getenv("GSV_TRAFFIC_SIGNS_PROJECT_ID", "street-view-traffic-signs")
GSV_TRAFFIC_SIGNS_MODEL_VERSION = os.getenv("GSV_TRAFFIC_SIGNS_MODEL_VERSION", "3")
ENABLE_GSV_TRAFFIC_SIGNS = os.getenv("ENABLE_GSV_TRAFFIC_SIGNS", "true").lower() in (
    "1",
    "true",
    "yes",
)
IOU_THRESHOLD = float(os.getenv("DETECTION_IOU_THRESHOLD", "0.5"))
CONFIDENCE_MIN = float(os.getenv("DETECTION_CONFIDENCE_MIN", "0.25"))
# GSV Continued: drop pole/light/sign boxes covering more than this fraction of the image
GSV_MAX_BBOX_RATIO = float(os.getenv("GSV_MAX_BBOX_RATIO", "0.50"))

VERTICAL_SLIM_CLASSES = frozenset({"Street Light", "Pole", "Traffic Signal", "Traffic Sign"})

ENDPOINT = f"{INFERENCE_URL}/infer/object_detection"
PRIMARY_MODEL_ID = f"{PROJECT_ID}/{MODEL_VERSION}"
SECONDARY_MODEL_ID = f"{STREET_LIGHT_PROJECT_ID}/{STREET_LIGHT_MODEL_VERSION}"
TERTIARY_MODEL_ID = f"{TRAFFIC_SIGNAL_PROJECT_ID}/{TRAFFIC_SIGNAL_MODEL_VERSION}"
GSV_PK0ZZ_MODEL_ID = f"{GSV_STREET_LIGHT_PK0ZZ_PROJECT_ID}/{GSV_STREET_LIGHT_PK0ZZ_MODEL_VERSION}"
GSV_TRAFFIC_SIGNS_MODEL_ID = f"{GSV_TRAFFIC_SIGNS_PROJECT_ID}/{GSV_TRAFFIC_SIGNS_MODEL_VERSION}"

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
    "Traffic Sign": (0, 180, 255),
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
    "Traffic Sign": "🛑",
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
    "traffic sign": "Traffic Sign",
    "traffic-sign": "Traffic Sign",
    "traffic_sign": "Traffic Sign",
    "TrafficSign": "Traffic Sign",
    "Traffic Sign": "Traffic Sign",
    "stop sign": "Traffic Sign",
    "stop-sign": "Traffic Sign",
    "stop_sign": "Traffic Sign",
    "Stop Sign": "Traffic Sign",
    "Traffic Signal": "Traffic Signal",
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


async def _call_inference(
    model_id: str,
    payload: dict,
    *,
    timeout: float = INFERENCE_TIMEOUT,
) -> dict:
    """Call the local Roboflow Inference Server (object_detection API)."""
    body = {
        "id": str(uuid.uuid4()),
        "model_id": model_id,
        **payload,
    }
    if SEND_API_KEY and API_KEY:
        body["api_key"] = API_KEY
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(ENDPOINT, json=body)
        resp.raise_for_status()
        return resp.json()


def _default_model_specs() -> list[tuple[str, str]]:
    specs: list[tuple[str, str]] = [("primary", PRIMARY_MODEL_ID)]
    if ENABLE_STREET_LIGHT_MODEL:
        specs.append(("street_light", SECONDARY_MODEL_ID))
    if ENABLE_TRAFFIC_SIGNAL_MODEL:
        specs.append(("traffic_signal", TERTIARY_MODEL_ID))
    return specs


def _gsv_continued_model_specs() -> list[tuple[str, str]]:
    """GSV Continued page: all five models in parallel."""
    specs: list[tuple[str, str]] = [("primary", PRIMARY_MODEL_ID)]
    if ENABLE_STREET_LIGHT_MODEL:
        specs.append(("street_light_ci0on", SECONDARY_MODEL_ID))
    if ENABLE_GSV_STREET_LIGHT_PK0ZZ:
        specs.append(("street_light_pkozz", GSV_PK0ZZ_MODEL_ID))
    if ENABLE_TRAFFIC_SIGNAL_MODEL:
        specs.append(("traffic_signal", TERTIARY_MODEL_ID))
    if ENABLE_GSV_TRAFFIC_SIGNS:
        specs.append(("traffic_signs", GSV_TRAFFIC_SIGNS_MODEL_ID))
    return specs


def get_gsv_continued_model_registry() -> list[dict]:
    """Registry entries for GSV Continued models (enabled flags + ids)."""
    entries: list[dict] = [
        {
            "source": "primary",
            "model_id": PRIMARY_MODEL_ID,
            "enabled": True,
            "gsv_only": False,
        },
    ]
    if ENABLE_STREET_LIGHT_MODEL:
        entries.append(
            {
                "source": "street_light_ci0on",
                "model_id": SECONDARY_MODEL_ID,
                "enabled": True,
                "gsv_only": False,
            }
        )
    if ENABLE_GSV_STREET_LIGHT_PK0ZZ:
        entries.append(
            {
                "source": "street_light_pkozz",
                "model_id": GSV_PK0ZZ_MODEL_ID,
                "enabled": True,
                "gsv_only": True,
            }
        )
    if ENABLE_TRAFFIC_SIGNAL_MODEL:
        entries.append(
            {
                "source": "traffic_signal",
                "model_id": TERTIARY_MODEL_ID,
                "enabled": True,
                "gsv_only": False,
            }
        )
    if ENABLE_GSV_TRAFFIC_SIGNS:
        entries.append(
            {
                "source": "traffic_signs",
                "model_id": GSV_TRAFFIC_SIGNS_MODEL_ID,
                "enabled": True,
                "gsv_only": True,
            }
        )
    return entries


def _inference_timeout_for_specs(specs: list[tuple[str, str]]) -> float:
    optional = max(0, len(specs) - 1)
    return 30.0 + optional * 15.0


def _model_status_entry(
    source: str,
    model_id: str,
    *,
    status: str,
    error: str | None = None,
    latency_ms: int | None = None,
    prediction_count: int | None = None,
) -> dict:
    return {
        "source": source,
        "model_id": model_id,
        "status": status,
        "error": error,
        "latency_ms": latency_ms,
        "prediction_count": prediction_count,
    }


async def _run_model_specs(
    image_payload: dict,
    specs: list[tuple[str, str]],
) -> dict:
    """Run model specs in parallel; return results and per-model status."""
    timeout = _inference_timeout_for_specs(specs)
    started = time.perf_counter()
    tasks = [
        _call_inference(model_id, image_payload, timeout=timeout) for _, model_id in specs
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    ok: list[tuple[str, dict]] = []
    model_status: list[dict] = []
    for (source, model_id), result in zip(specs, results):
        if isinstance(result, Exception):
            err = str(result)
            logger.warning(
                "Inference failed for model %s (%s): %s",
                model_id,
                source,
                result,
            )
            model_status.append(
                _model_status_entry(
                    source,
                    model_id,
                    status="failed",
                    error=err,
                    latency_ms=elapsed_ms,
                )
            )
            if source == "primary":
                raise result
            continue
        pred_count = len(result.get("predictions", []))
        model_status.append(
            _model_status_entry(
                source,
                model_id,
                status="ok",
                latency_ms=elapsed_ms,
                prediction_count=pred_count,
            )
        )
        ok.append((source, result))
    return {"results": ok, "model_status": model_status}


async def _run_models(image_payload: dict) -> list[tuple[str, dict]]:
    """Run all enabled app-wide models in parallel."""
    out = await _run_model_specs(image_payload, _default_model_specs())
    return out["results"]


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


def _bbox_ratios(det: dict, img_w: int, img_h: int) -> tuple[float, float, float]:
    """Return (height_ratio, width_ratio, area_ratio) relative to image size."""
    bbox = det.get("bbox") or [0, 0, 0, 0]
    w = max(0, int(bbox[2]) - int(bbox[0]))
    h = max(0, int(bbox[3]) - int(bbox[1]))
    img_area = img_w * img_h
    area_ratio = (w * h) / img_area if img_area > 0 else 0.0
    h_ratio = h / img_h if img_h > 0 else 0.0
    w_ratio = w / img_w if img_w > 0 else 0.0
    return h_ratio, w_ratio, area_ratio


def _filter_implausible_vertical_boxes(
    detections: list[dict],
    img_w: int,
    img_h: int,
) -> list[dict]:
    """Drop pole/light/signal boxes that span too much of the frame (model false positives)."""
    if img_w <= 0 or img_h <= 0:
        return detections

    kept: list[dict] = []
    for det in detections:
        cls = det.get("class", "")
        if cls not in VERTICAL_SLIM_CLASSES:
            kept.append(det)
            continue

        h_ratio, w_ratio, area_ratio = _bbox_ratios(det, img_w, img_h)
        if (
            h_ratio > GSV_MAX_BBOX_RATIO
            or w_ratio > GSV_MAX_BBOX_RATIO
            or area_ratio > GSV_MAX_BBOX_RATIO
        ):
            logger.info(
                "Dropped implausible %s box (h=%.0f%% w=%.0f%% area=%.0f%% conf=%.2f)",
                cls,
                h_ratio * 100,
                w_ratio * 100,
                area_ratio * 100,
                det.get("confidence", 0),
            )
            continue
        kept.append(det)
    return kept


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


def _merge_detections(
    raw_results: list[tuple[str, dict]],
    *,
    img_w: int = 0,
    img_h: int = 0,
    filter_vertical_boxes: bool = False,
) -> list[dict]:
    all_dets: list[dict] = []
    for source, raw in raw_results:
        all_dets.extend(_parse_predictions(raw, source_model=source))
    if filter_vertical_boxes:
        all_dets = _filter_implausible_vertical_boxes(all_dets, img_w, img_h)
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

    detections = _merge_detections(raw_results, img_w=width, img_h=height)
    return {
        "detections": detections,
        "annotated_image_b64": _draw_and_encode(img, detections),
        "counts": _count_classes(detections),
        "image_size": {"width": width, "height": height},
    }


async def _detect_base64_with_specs(
    b64_str: str,
    specs: list[tuple[str, str]],
    *,
    filter_vertical_boxes: bool = False,
    include_model_status: bool = False,
) -> dict:
    if "," in b64_str:
        b64_str = b64_str.split(",", maxsplit=1)[1]

    image_payload = {"image": {"type": "base64", "value": b64_str}}
    run_out = await _run_model_specs(image_payload, specs)
    raw_results = run_out["results"]

    arr = np.frombuffer(base64.b64decode(b64_str), np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode base64 image for annotation")

    img_h, img_w = img.shape[:2]
    detections = _merge_detections(
        raw_results,
        img_w=img_w,
        img_h=img_h,
        filter_vertical_boxes=filter_vertical_boxes,
    )
    out = {
        "detections": detections,
        "annotated_image_b64": _draw_and_encode(img, detections),
        "counts": _count_classes(detections),
        "image_size": {"width": img_w, "height": img_h},
    }
    if include_model_status:
        out["model_status"] = run_out["model_status"]
    return out


async def detect_from_base64(b64_str: str) -> dict:
    """Detect objects in a base64-encoded image from browser camera."""
    return await _detect_base64_with_specs(b64_str, _default_model_specs())


async def detect_gsv_continued_from_base64(b64_str: str) -> dict:
    """GSV Continued: run all five specialist models in parallel."""
    return await _detect_base64_with_specs(
        b64_str,
        _gsv_continued_model_specs(),
        filter_vertical_boxes=True,
        include_model_status=True,
    )


def _gsv_probe_test_image_b64() -> str:
    """Load a small GSV JPG for model health probes."""
    from pathlib import Path

    candidates = [
        Path(__file__).resolve().parents[1] / "share dataset" / "location_000001" / "view_0.jpg",
        Path(__file__).resolve().parents[1]
        / "Dataset_PitOrlManh"
        / "zipped images"
        / "part1"
        / "000001_0.jpg",
    ]
    for path in candidates:
        if path.is_file():
            return base64.b64encode(path.read_bytes()).decode("ascii")
    raise FileNotFoundError(
        "No GSV probe image found. Expected share dataset/location_000001/view_0.jpg "
        "or Dataset_PitOrlManh/zipped images/part1/000001_0.jpg"
    )


async def probe_models(
    specs: list[tuple[str, str]] | None = None,
    *,
    test_image_b64: str | None = None,
) -> list[dict]:
    """Call each model individually and return per-model health results."""
    if specs is None:
        specs = [(e["source"], e["model_id"]) for e in get_gsv_continued_model_registry()]
    if test_image_b64 is None:
        test_image_b64 = _gsv_probe_test_image_b64()

    image_payload = {"image": {"type": "base64", "value": test_image_b64}}
    timeout = _inference_timeout_for_specs(specs)
    registry = {e["source"]: e for e in get_gsv_continued_model_registry()}
    probes: list[dict] = []

    for source, model_id in specs:
        enabled = registry.get(source, {}).get("enabled", True)
        started = time.perf_counter()
        try:
            raw = await _call_inference(model_id, image_payload, timeout=timeout)
            latency_ms = int((time.perf_counter() - started) * 1000)
            probes.append(
                {
                    "source": source,
                    "model_id": model_id,
                    "enabled": enabled,
                    "status": "ok",
                    "latency_ms": latency_ms,
                    "prediction_count": len(raw.get("predictions", [])),
                    "error": None,
                }
            )
        except Exception as exc:
            latency_ms = int((time.perf_counter() - started) * 1000)
            probes.append(
                {
                    "source": source,
                    "model_id": model_id,
                    "enabled": enabled,
                    "status": "failed",
                    "latency_ms": latency_ms,
                    "prediction_count": None,
                    "error": str(exc),
                }
            )
    return probes


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
        "gsv_continued_models": get_gsv_continued_model_registry(),
    }
