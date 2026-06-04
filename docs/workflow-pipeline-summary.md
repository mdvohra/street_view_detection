# Urban Street Asset Pipeline (Manager View)

Linear pipeline from area definition to analytics — suitable for steering meetings and architecture slides.

| Stage | What happens | Platform today |
|-------|----------------|------------------|
| **1. AOI** | User draws or selects the **Area of Interest** on the map (polygon / corridor). | Map page — polygon draw |
| **2. Street-Level Imagery Acquisition** | Pull **street-level photos** and metadata (position, compass, sequence). Sources: **Mapillary** (in production), **Google Street View** (same pipeline slot — integrate when required). | `mapillary.py`, `mapillary_batch.py` |
| **3. Object Detection & Classification** | Run **object detection** models; assign a **class** to each detection. **Primary assets:** Street Lights, Poles. Other classes: Traffic Signals, Cars, Trees, Buildings, People, Motorcycles. | `detector.py` (Roboflow / YOLO) |
| **4. Geospatial Localization** | Convert image detections to **map coordinates**: camera pose → bearing from bbox → distance (typical height for poles/lights) → **multi-view LOB triangulation** for area scans. | `geolocation.py`, `camera_ray.py`, `geolocate_batch.py` |
| **5. Asset Mapping** | Persist **geo-located assets** (per detection and triangulated clusters) for the AOI. | `storage.py` — `batch_results`, `batch_object_locations` |
| **6. Visualization & Analytics** | **Dashboard**: map, sight lines, photo viewer, class filters, job KPIs. | `BatchDashboard.jsx`, geo API endpoints |

## One-line pipeline

**AOI → Imagery (Mapillary / GSV) → Detect & classify → Localize → Map assets → Dashboard analytics**

## Diagram files

| File | Best for |
|------|----------|
| `workflow-pipeline.png` | Wide detailed pipeline (documentation) |
| `workflow-pipeline-ppt.png` | **PowerPoint / Gamma** — 1920×1080, compact 2-row layout, fits one slide |
| `workflow-pipeline-banner.png` | Title slide / header — compact + legend |
| `workflow-pipeline.svg` | Print or Figma import |
| `workflow-pipeline.mmd` | Edit in draw.io (Mermaid import) |

**Stage colors:** navy (AOI) → teal (imagery) → purple (detection) → green (localization) → amber (mapping) → blue (analytics).

## Note on imagery sources

The application **currently acquires imagery from Mapillary**. Google Street View fits the same **Stage 2** box as an additional provider when the organization enables that integration.
