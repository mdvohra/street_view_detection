import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

import base64

import batch_service
import dataset_service
import detector
import geolocation
import geolocate_batch
import mapillary
import storage

def _load_root_env() -> None:
    here = Path(__file__).resolve()
    candidates = [here.parent / ".env", here.parents[1] / ".env"]
    if len(here.parents) > 2:
        candidates.append(here.parents[2] / ".env")
    for env_path in candidates:
        if env_path.is_file():
            load_dotenv(dotenv_path=env_path)
            return
    load_dotenv()


_load_root_env()


def _env_bool(name: str, default: str = "true") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


@asynccontextmanager
async def lifespan(_: FastAPI):
    storage.init_db()
    mapillary.init()
    dataset_service.init()
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
        "show_mapillary_coverage": _env_bool("SHOW_MAPILLARY_COVERAGE", "true"),
        "model_info": {
            "workspace": workspace,
            "project": project,
            "version": version,
            "model_id": cfg["primary_model_id"],
            "universe_url": models[0]["universe_url"],
        },
        "models": models,
        "geolocation": {
            "horizontal_fov_deg": geolocation.HORIZONTAL_FOV_DEG,
            "hfov_scale": geolocation.HFOV_SCALE,
            "compass_bearing_offset_deg": geolocation.COMPASS_BEARING_OFFSET_DEG,
            "lob_max_length_m": geolocation.LOB_MAX_LENGTH_M,
            "use_3d_camera_ray": geolocation.USE_3D_CAMERA_RAY,
        },
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

    image_size = result.get("image_size") or {}
    iw = int(image_size.get("width") or 0)
    ih = int(image_size.get("height") or 0)
    detections = geolocation.enrich_detections_with_geo(
        result.get("detections", []),
        camera_lat=image_info["image_lat"],
        camera_lng=image_info["image_lng"],
        compass_angle=image_info.get("compass_angle", 0),
        image_width=iw,
        image_height=ih,
        camera_focal_px=image_info.get("camera_focal_px"),
        source_width=image_info.get("source_width"),
        source_height=image_info.get("source_height"),
        computed_rotation=image_info.get("computed_rotation"),
    )

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
        "detections": detections,
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


class BatchPolygonRequest(BaseModel):
    polygon: list[list[float]]


@app.post("/batch/polygon")
async def batch_polygon(req: BatchPolygonRequest):
    if len(req.polygon) < 3:
        raise HTTPException(status_code=400, detail="Polygon must have at least 3 points")
    job_id = storage.create_job(req.polygon)
    batch_service._register_cancel(job_id)
    batch_service.start_batch_job(job_id)
    return {"job_id": job_id, "status": "queued"}


@app.get("/batch")
def batch_list():
    jobs = storage.list_jobs()
    return {"jobs": [batch_service.job_to_response(j) for j in jobs]}


@app.get("/batch/{job_id}")
def batch_get(job_id: str):
    try:
        job = storage.get_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return batch_service.job_to_response(job)


@app.post("/batch/{job_id}/cancel")
def batch_cancel(job_id: str):
    try:
        job = storage.get_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    batch_service.request_cancel(job_id)
    return {"job_id": job_id, "status": "cancelling"}


@app.get("/batch/{job_id}/geo")
def batch_geo(job_id: str):
    try:
        job = storage.get_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    markers = storage.get_results_geo(job_id)
    return {"job_id": job_id, "polygon": job["polygon"], "markers": markers}


@app.get("/batch/{job_id}/detections/geo")
def batch_detections_geo(job_id: str):
    try:
        job = storage.get_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    detections = storage.get_detections_geo(job_id)
    return {"job_id": job_id, "detections": detections}


@app.get("/batch/{job_id}/objects/geo")
def batch_objects_geo(job_id: str):
    try:
        job = storage.get_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    objects = storage.get_objects_geo(job_id)
    return {"job_id": job_id, "objects": objects}


@app.post("/batch/{job_id}/geolocate")
def batch_geolocate(job_id: str):
    try:
        job = storage.get_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] not in ("completed", "cancelled"):
        raise HTTPException(status_code=409, detail="Job must be finished before geolocation")
    try:
        stats = geolocate_batch.run_geolocate_job(job_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return {"job_id": job_id, **stats}


@app.get("/batch/{job_id}/results")
def batch_results(job_id: str, offset: int = 0, limit: int = 50):
    try:
        job = storage.get_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    limit = min(max(limit, 1), 100)
    offset = max(offset, 0)
    results = storage.get_results(job_id, offset=offset, limit=limit)
    total = storage.count_results(job_id)
    return {"job_id": job_id, "offset": offset, "limit": limit, "total": total, "results": results}


@app.get("/batch/{job_id}/images/{image_id}/annotated")
def batch_annotated_image(job_id: str, image_id: str):
    try:
        path = storage.annotated_file_path(job_id, image_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not path:
        raise HTTPException(status_code=404, detail="Annotated image not found")
    return FileResponse(path, media_type="image/jpeg")


@app.delete("/batch")
def batch_delete_all():
    count = storage.delete_all_jobs()
    return {"deleted_jobs": count}


@app.get("/dataset/meta")
def dataset_meta():
    try:
        return dataset_service.get_meta()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/dataset/points")
def dataset_points():
    try:
        return {"points": dataset_service.get_points()}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/dataset/images/{image_id}")
def dataset_image(image_id: int):
    try:
        path = dataset_service.get_image_path(image_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(path, media_type="image/png")


@app.post("/dataset/images/{image_id}/detect")
async def dataset_detect(image_id: int):
    try:
        point = dataset_service.get_point(image_id)
        path = dataset_service.get_image_path(image_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    image_b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    try:
        result = await detector.detect_from_base64(image_b64)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Inference server error: {str(exc)}") from exc

    return {
        "id": image_id,
        "row": point["row"],
        "lat": point["lat"],
        "lng": point["lng"],
        "image_url": f"/dataset/images/{image_id}",
        "source": "dataset",
        **result,
    }


@app.delete("/batch/{job_id}")
def batch_delete_one(job_id: str):
    try:
        job = storage.get_job(job_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    batch_service.request_cancel(job_id)
    storage.delete_job(job_id)
    return {"job_id": job_id, "deleted": True}
