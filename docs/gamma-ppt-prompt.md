# Gamma.ai prompt — 5–6 slides (copy everything below the line)

---

Create a **professional, executive-ready presentation with exactly 6 slides** (no more) for managers and infrastructure stakeholders about an **Urban Street Asset Intelligence** platform. It inventories **street lights and poles** (primary focus) from street-level imagery using AI, then maps assets for dashboard review.

## Goals

- One clear **6-stage pipeline** as the hero visual.
- Cover: AOI, imagery (Mapillary + Google Street View), **object detection & classes**, **geospatial localization logic**, **asset mapping**, **dashboard analytics**.
- Confident, civic-tech tone. No code, no phone/camera capture workflow.

## Visual style

- Modern smart-city / civic-tech: clean, premium, minimal text.
- **Stage colors:** Navy `#0B3D6B` (AOI) → Teal `#0E6B7A` (Imagery) → Purple `#5B2D82` (Detection) → Green `#1A6B4A` (Localization) → Amber `#B45309` (Mapping) → Blue `#1E40AF` (Analytics). Background `#F8FAFC`, text `#0F172A`.
- Sans-serif fonts. Max **4–5 bullets** per slide. Use icons, diagrams, map mockups — no cluttered tables.

## Core pipeline (must be on slide 2 — large, horizontal, color-coded)

**AOI → Street-Level Imagery Acquisition (Mapillary & Google Street View) → Object Detection & Classification → Geospatial Localization → Asset Mapping → Visualization & Analytics**

**Imagery note:** Mapillary is **in production today**; Google Street View is the **same pipeline stage** when enabled — label GSV as “optional / planned source” unless shown as future.

**Detection classes:** **Primary:** Street Lights, Poles. **Also:** Traffic Signals, Cars, Trees, Buildings, People, Motorcycles.

**Localization (plain English, for slide 4):**  
(1) Camera GPS + facing direction → (2) object position in photo → bearing → (3) poles/lights: distance from typical height in image → (4) area scans: same asset in multiple photos → **multi-view triangulation** for a better map pin. Do not use jargon “LOB.”

---

## Slide outline (generate exactly these 6 slides)

### Slide 1 — Title
- **Title:** Urban Street Asset Intelligence Platform  
- **Subtitle:** Automated street light & pole inventory from street-level imagery  
- Subtle map / infrastructure background. Placeholder for name, org, date.

### Slide 2 — End-to-end pipeline (HERO — most important slide)
- Full-width **horizontal flowchart** with 6 color-coded stages and bold arrows (labels exactly as in Core pipeline above).
- One-line caption: *From study area to map-ready asset inventory and analytics.*
- Keep text inside each stage box short (subtitle + 1 line each).

### Slide 3 — Imagery + Object Detection & Classification
- **Left half — Imagery acquisition:** Mapillary (live) + Google Street View (same layer); panoramas + camera GPS & heading.  
- **Right half — Detection:** AI object detection draws boxes on each photo. **Highlight Street Lights & Poles** as primary assets; list other classes smaller.  
- Optional: simple graphic “street photo → labeled boxes.”

### Slide 4 — Geospatial Localization
- **4-step visual** (icons or numbered flow):  
  1. Camera location & direction  
  2. Object position in frame → bearing  
  3. Poles & lights: distance from typical height  
  4. Multiple street views → crossing sight lines → accurate pin  
- One example callout: *“Same pole in 3 photos → refined location.”*

### Slide 5 — Asset Mapping + Dashboard & Analytics
- **Asset mapping:** Geo-ready layer — pins by class, clustered assets, inventory for GIS / asset registers.  
- **Dashboard:** Interactive map, labeled photos, filters (especially lights & poles), counts & job status, review workflow for planners.  
- Split slide visually (top/bottom or left/right).

### Slide 6 — Value & next steps
- **3–4 bullets — business value:** faster than manual survey, repeatable AOI studies, photo evidence + map, better maintenance planning.  
- **Next steps:** pilot one AOI, success metrics (area covered, lights/poles detected, review time), Q&A.  
- Clean closing layout.

---

## Constraints

- **Exactly 6 slides** — do not add appendix or extra slides.  
- **Exclude:** phone camera, code, APIs, databases, technical jargon.  
- **Include:** pipeline, primary classes (lights/poles), localization logic, dashboard, business value.  
- Add **2 short speaker notes sentences** per slide.

Generate the full 6-slide presentation now.
