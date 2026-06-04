# Workflow diagrams

## Manager / pipeline view (recommended for leadership)

**`workflow-pipeline.mmd`** · **`workflow-pipeline.png`**

AOI → Street-Level Imagery Acquisition → Object Detection & Classification → Geospatial Localization → Asset Mapping → Visualization & Analytics

See `workflow-pipeline-summary.md` for stage descriptions.

---

## Stakeholder / product view

# Opening the workflow diagram (Windows fix)

The draw.io MCP URL launcher can fail on Windows with *"The data area passed to a system call is too small."* Use the **single** diagram file below.

## One diagram file

**`workflow-complete.mmd`** — stakeholder-friendly flow (plain language, three user options, dashboard, no code jargon).

**`workflow-stakeholder-summary.md`** — one-page written summary for slides or email.

## Import into draw.io

1. Open [https://app.diagrams.net](https://app.diagrams.net)
2. **Arrange** → **Insert** → **Advanced** → **Mermaid**
3. Copy all of `workflow-complete.mmd`, paste, **Insert**
4. **File** → **Save as** → `workflow-complete.drawio` (optional; reopen without re-pasting)

## Export as image

After import: **File** → **Export as** → PNG or SVG.

## Legacy split files

`workflow-overview.mmd` and `workflow-batch-geolocation.mmd` are older two-part versions; prefer `workflow-complete.mmd`.
