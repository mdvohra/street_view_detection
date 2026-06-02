# Urban Infrastructure Detector

Detects Cars, Trees, Street Lights, Poles, Buildings, Motorcycles, People, and Traffic Signals in Mapillary street imagery and live camera frames.

## Stack

- Frontend: React (Vite) + Tailwind + react-leaflet
- Backend: FastAPI (Docker)
- Detection: **Roboflow Inference Server via `inference-cli`** (runs on your machine, port 9001) — dual models: urban vehicle detection + street-light specialist
- Street imagery: Mapillary API v4
- Maps: OpenStreetMap + Mapillary vector tiles

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (backend + frontend only)
- Python 3.11+ (for `inference-cli`)
- Free accounts: [Mapillary](https://www.mapillary.com/signup) and [Roboflow](https://roboflow.com)

## API keys

Edit root `.env`:

- `MAPILLARY_ACCESS_TOKEN` — [Mapillary developers dashboard](https://www.mapillary.com/dashboard/developers)
- `ROBOFLOW_API_KEY` — [Roboflow API keys](https://app.roboflow.com/settings/api)

## How to run (recommended)

You need **two terminals**.

### Terminal 1 — Inference Server (inference-cli)

```powershell
pip install inference-cli
inference server start
```

Wait until this loads: [http://localhost:9001/docs](http://localhost:9001/docs)

`inference-cli` starts the official Roboflow Inference Server in Docker for you and picks the right image for your machine.

### Terminal 2 — App (Docker Compose + Buildx)

```powershell
cd D:\Street_view_detection
.\scripts\buildx-setup.ps1   # once per machine
.\scripts\build.ps1          # fast cached build
docker compose up -d
```

Or one command:

```powershell
make up
```

### Open the app

| URL | Service |
|-----|---------|
| [http://localhost:5173](http://localhost:5173) | Frontend |
| [http://localhost:8000/health](http://localhost:8000/health) | Backend health |
| [http://localhost:8000/docs](http://localhost:8000/docs) | API docs |
| [http://localhost:9001/docs](http://localhost:9001/docs) | Inference server |

### Stop

```powershell
# Terminal 2
docker compose down

# Terminal 1 — Ctrl+C, then optionally:
inference server stop
```

## Environment

Root `.env` is used by Docker Compose. Important values:

```env
INFERENCE_SERVER_URL=http://host.docker.internal:9001
PROJECT_ID=vehicle-detection-7nnx0
MODEL_VERSION=4
STREET_LIGHT_PROJECT_ID=street-light-ci0on
STREET_LIGHT_MODEL_VERSION=1
ENABLE_STREET_LIGHT_MODEL=true
```

Both models run in parallel on the inference server; results are merged with IoU-based deduplication. Your `ROBOFLOW_API_KEY` must have access to both Roboflow projects.

That lets the **backend container** reach inference running on your **host** via `inference server start`.

If you run the backend **locally** (without Docker), use:

```env
INFERENCE_SERVER_URL=http://localhost:9001
```

## Fast Docker builds (Buildx)

Uses **Docker Buildx** with local cache in `.buildx-cache/` and pip/npm cache mounts inside Dockerfiles.

```powershell
.\scripts\buildx-setup.ps1   # one-time
.\scripts\build.ps1          # buildx bake --load (parallel, cached)
docker compose up -d
```

## Makefile

```bash
make buildx-setup   # create buildx builder
make build          # buildx bake --load
make up             # build + start containers
make down
make logs
```

## Fully local (no Docker for app)

Use the same `.env` with `INFERENCE_SERVER_URL=http://localhost:9001`.

**Terminal 1:** `inference server start`

**Terminal 2 — backend:**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Terminal 3 — frontend:**

```powershell
cd frontend
npm install
npm run dev
```

## Usage

1. Zoom into a city — green dots = Mapillary coverage.
2. Click near a green dot → street detection → blue pin.
3. Camera panel → **Detect Now** → orange pin (if GPS allowed).
4. Click pins for summary; **View Full Detection** for the right panel.

## Troubleshooting

### Inference disconnected on `/health`

- Terminal 1 must be running: `inference server start`
- Open [http://localhost:9001/docs](http://localhost:9001/docs) in the browser first
- Ensure `ROBOFLOW_API_KEY` is set in `.env`
- Restart backend after inference is up: `docker compose up --build backend`

### Backend in Docker cannot reach inference

- `.env` should have `INFERENCE_SERVER_URL=http://host.docker.internal:9001`
- On Linux without `host.docker.internal`, add to `docker-compose.yml` under backend: `extra_hosts: ["host.docker.internal:host-gateway"]` (already included)

### Detection failed / 502

- Check inference logs in Terminal 1
- Confirm model env: `PROJECT_ID=vehicle-detection-7nnx0`, `MODEL_VERSION=4`, and street-light vars in `.env.example`
- If street-light model fails, set `ENABLE_STREET_LIGHT_MODEL=false` or verify API key access to `stret-light/street-light-ci0on`
- First detection after restart may be slow while both models cold-load on the inference server

### No green dots on map

- Zoom in further; try urban areas with Mapillary coverage

### Camera not working

- Allow camera permission in the browser
