# Street Light & Pole Detection — Stakeholder Summary

## Purpose

Use **street photos** and **object detection** to map **street lights and poles** (and related street objects) without manual field surveys.

## Workflow

1. User selects a point or draws a **scan area** on the map.  
2. System loads **Mapillary** street photos for that place.  
3. **Object detection** runs on each photo — the AI draws a box around every object found.  
4. System **estimates each object’s map location** (see logic below).  
5. **Dashboard** — review results on a map, open labeled photos, and see counts by class.

## Detection classes

| Priority | Classes |
|----------|---------|
| **Main focus** | Street Lights, Poles |
| **Also detected** | Traffic Signals, Cars, Trees, Buildings, People, Motorcycles |

## How object location is estimated

1. **Camera position** — GPS from the street photo, plus the direction the camera was facing.  
2. **Object in the frame** — which part of the image the box is in (left, center, right) gives a **bearing** from the camera.  
3. **Poles and street lights** — distance is estimated using a **typical height** for that object type and how large it appears in the photo.  
4. **Area scans** — when the same pole or light appears in **several photos**, lines of sight from each camera are combined (**triangulation**) for a more accurate map pin.

## Dashboard

- Map with **camera positions** and **estimated object locations**  
- **Photos with detection boxes** drawn on them  
- **Filters and tables** by class (especially street lights and poles)

## Diagram

`workflow-complete.png` — share in presentations.
