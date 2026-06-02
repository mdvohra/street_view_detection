import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import detector
import mapillary

ROOT_ENV = Path(__file__).resolve().parents[1] / ".env"
load_dotenv(dotenv_path=ROOT_ENV)


@asynccontextmanager
async def lifespan(_: FastAPI):
    mapillary.init()
    inference_ok = await detector.health_check()
    if not inference_ok:
        print(
            "WARNING: Roboflow Inference Server not reachable at",
            os.getenv("INFERENCE_SERVER_URL"),
        )
        print("Run: pip install inference-cli && inference server start")
    else:
        print("Roboflow Inference Server connected")
    yield


app = FastAPI(title="Urban Detector API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class StreetDetectRequest(BaseModel):
    lat: float
    lng: float
    image_id: str | None = None


class CameraDetectRequest(BaseModel):
    image_b64: str
    lat: float | None = None
    lng: float | None = None


@app.get("/health")
async def health():
    inference_ok = await detector.health_check()
    return {
        "status": "ok",
        "inference_server": "connected" if inference_ok else "disconnected",
        "inference_url": os.getenv("INFERENCE_SERVER_URL"),
    }


@app.get("/config")
def config():
    cfg = detector.get_model_config()
    workspace = cfg["workspace"]
    project = cfg["project"]
    version = cfg["version"]
    sl_workspace = cfg["street_light_workspace"]
    sl_project = cfg["street_light_project"]
    sl_version = cfg["street_light_version"]
    street_light_enabled = cfg["street_light_enabled"]

    models = [
        {
            "role": "primary",
            "model_id": cfg["primary_model_id"],
            "workspace": workspace,
            "project": project,
            "version": version,
            "enabled": True,
            "universe_url": (
                f"https://universe.roboflow.com/{workspace}/{project}/model/{version}"
            ),
        },
        {
            "role": "street_light",
            "model_id": cfg["secondary_model_id"],
            "workspace": sl_workspace,
            "project": sl_project,
            "version": sl_version,
            "enabled": street_light_enabled,
            "universe_url": (
                f"https://universe.roboflow.com/{sl_workspace}/{sl_project}/model/{sl_version}"
            ),
        },
    ]

    return {
        "mapillary_token": os.getenv("MAPILLARY_ACCESS_TOKEN"),
        "model_info": {
            "workspace": workspace,
            "project": project,
            "version": version,
            "model_id": cfg["primary_model_id"],
            "universe_url": models[0]["universe_url"],
        },
        "models": models,
    }


@app.post("/detect/street")
async def detect_street(req: StreetDetectRequest):
    if req.image_id:
        image_info, mapillary_err = await mapillary.fetch_image_by_id(
            req.image_id, req.lat, req.lng
        )
    else:
        image_info, mapillary_err = await mapillary.fetch_nearest_image(req.lat, req.lng)

    if mapillary_err:
        return {
            "error": "mapillary_error",
            "message": mapillary_err,
            "lat": req.lat,
            "lng": req.lng,
        }

    if not image_info:
        return {
            "error": "no_imagery",
            "message": (
                "No street imagery within 50 m. Zoom to level 14 for green dots, "
                "then click directly on a dot or green line."
            ),
            "lat": req.lat,
            "lng": req.lng,
        }

    if not image_info.get("thumb_url"):
        return {
            "error": "no_imagery",
            "message": "Mapillary image found but thumbnail URL is missing. Try another dot.",
            "lat": req.lat,
            "lng": req.lng,
        }

    try:
        result = await detector.detect_from_url(image_info["thumb_url"])
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Inference server error: {str(exc)}") from exc

    return {
        "lat": req.lat,
        "lng": req.lng,
        "image_lat": image_info["image_lat"],
        "image_lng": image_info["image_lng"],
        "distance_m": image_info["distance_m"],
        "image_id": image_info["image_id"],
        "image_url": image_info["thumb_url"],
        "captured_at": image_info["captured_at"],
        "compass_angle": image_info["compass_angle"],
        "sequence_id": image_info["sequence_id"],
        "source": "street",
        **result,
    }


@app.post("/detect/camera")
async def detect_camera(req: CameraDetectRequest):
    try:
        result = await detector.detect_from_base64(req.image_b64)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Inference server error: {str(exc)}") from exc

    return {
        "lat": req.lat,
        "lng": req.lng,
        "source": "camera",
        **result,
    }
