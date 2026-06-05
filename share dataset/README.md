# Share Dataset

Sample data package for review.

## Multi-view street locations (6 sides each)

**5 locations** from `Dataset_PitOrlManh` — full 360° coverage (V0–V5, 60° apart).

| Location ID | Folder |
|-------------|--------|
| 1 | `location_000001/` |
| 200 | `location_000200/` |
| 400 | `location_000400/` |
| 600 | `location_000600/` |
| 800 | `location_000800/` |

Each folder contains:
- `view_0.jpg` … `view_5.jpg` — images for all sides
- `metadata.json` — lat, lng, compass, nav links, per-view heading

## Single-view points (from `dataset/`)

**5 points** in `single_view_from_dataset/` — one PNG + coords per point (IDs: [0, 2500, 5000, 7500, 9999]).

## Files
- `manifest.json` — full summary for all samples
