import { detectGsvContinuedPanorama } from '../api'
import { CLASS_COLORS, CLASS_EMOJIS, CLASS_META } from '../constants/classes'
import {
  buildViewTilesFromResponse,
  enrichImageryWithViewTiles,
} from './gsvPanoramaClassFilter'
import { buildMap3dExportScript } from './map3d/map3dExportBootstrap'
import { filterMapMarkers } from './gsvMapSession'

const FETCH_CONCURRENCY = 2

function buildExportViewerScript() {
  return `
(function () {
${buildMap3dExportScript()}

  const data = JSON.parse(document.getElementById('export-data').textContent);
  const session = data.session;
  const imagery = data.imagery;
  const classColors = data.classColors || {};
  const classEmojis = data.classEmojis || {};

  let filterClass = null;
  let basemap = 'street';
  let showRays = false;
  let selectedLocationId = null;
  let selectedDetectionId = null;
  let selectedView = 4;
  let terrainEnabled = true;
  let buildingsEnabled = true;

  let map;
  let mapMarkers = [];
  let savedView = null;

  function emoji(cls) {
    return classEmojis[cls] || '\\u{1F4E6}';
  }

  function clearMapMarkers() {
    mapMarkers.forEach(function (m) { m.remove(); });
    mapMarkers = [];
  }

  function addHtmlMarker(lng, lat, html, onClick) {
    var wrap = document.createElement('div');
    wrap.innerHTML = html;
    var el = wrap.firstElementChild || wrap;
    el.style.cursor = 'pointer';
    if (onClick) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        onClick();
      });
    }
    var marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([lng, lat])
      .addTo(map);
    mapMarkers.push(marker);
  }

  function filteredDetections() {
    const list = session.detections || [];
    if (!filterClass) return list;
    return list.filter(function (d) { return d.class === filterClass; });
  }

  function trailPoints() {
    return (session.locations || [])
      .slice()
      .sort(function (a, b) { return a.order - b.order; })
      .map(function (l) { return [l.lat, l.lng]; });
  }

  function formatCoord(v) {
    if (v == null || isNaN(Number(v))) return '\\u2014';
    return Number(v).toFixed(6);
  }

  function formatView(view) {
    if (view == null) return '\\u2014';
    if (view >= 1 && view <= 4) return 'Side ' + view;
    if (view === 0) return 'Overlay';
    if (view === 5) return 'Sky';
    return 'View ' + view;
  }

  function formatMethod(method) {
    if (!method) return '\\u2014';
    if (method === 'bearing_single') return 'bearing';
    if (method === 'bearing_size') return 'size';
    return method;
  }

  function filterDetectionsByClass(list, cls) {
    if (!cls) return list;
    return list.filter(function (d) { return d.class === cls; });
  }

  function hexToRgb(hex) {
    const h = (hex || '#b4b4b4').replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map(function (c) { return c + c; }).join('') : h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image load failed')); };
      img.src = src;
    });
  }

  function drawAnnotatedView(ctx, detections, cls) {
    const list = filterDetectionsByClass(detections, cls);
    list.forEach(function (d) {
      const bbox = d.bbox;
      if (!bbox || bbox.length < 4) return;
      const x1 = bbox[0]; const y1 = bbox[1]; const x2 = bbox[2]; const y2 = bbox[3];
      const rgb = hexToRgb(classColors[d.class]);
      const color = 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')';
      ctx.save();
      ctx.globalAlpha = 0.15;
      ctx.fillStyle = color;
      ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
      ctx.restore();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      const label = (d.class || '') + ' ' + Math.round((d.confidence || 0) * 100) + '%';
      ctx.font = '600 12px system-ui, sans-serif';
      const tw = ctx.measureText(label).width;
      const th = 14;
      const labelY = Math.max(y1 - th - 4, 0);
      ctx.fillStyle = color;
      ctx.fillRect(x1, labelY, tw + 6, th + 4);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x1 + 3, labelY + th);
    });
  }

  function stitchCanvases(tiles) {
    const targetH = Math.max.apply(null, tiles.map(function (t) { return t.height; }));
    const normalized = tiles.map(function (t) {
      if (t.height === targetH) return t;
      const scale = targetH / t.height;
      const w = Math.round(t.width * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = targetH;
      c.getContext('2d').drawImage(t, 0, 0, w, targetH);
      return c;
    });
    const stripW = normalized.reduce(function (sum, t) { return sum + t.width; }, 0);
    const strip = document.createElement('canvas');
    strip.width = stripW;
    strip.height = targetH;
    const stripCtx = strip.getContext('2d');
    let x = 0;
    normalized.forEach(function (tile) {
      stripCtx.drawImage(tile, x, 0);
      x += tile.width;
    });
    const titleH = 48;
    const combined = document.createElement('canvas');
    combined.width = stripW;
    combined.height = targetH + titleH;
    const ctx = combined.getContext('2d');
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, stripW, titleH);
    ctx.fillStyle = '#dcdcdc';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('360 Degree Street Asset Panorama', stripW / 2, titleH / 2);
    ctx.drawImage(strip, 0, titleH);
    return combined.toDataURL('image/jpeg', 0.88);
  }

  function buildFilteredPanoramaFromTiles(panoViews, viewTiles, cls) {
    const promises = panoViews.map(function (view) {
      const key = String(view);
      const tile = viewTiles[key];
      if (!tile || !tile.raw_b64) return Promise.resolve(null);
      return loadImage(tile.raw_b64).then(function (img) {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        drawAnnotatedView(ctx, tile.detections || [], cls);
        return canvas;
      });
    });
    return Promise.all(promises).then(function (results) {
      const tiles = results.filter(Boolean);
      if (!tiles.length) return null;
      return stitchCanvases(tiles);
    });
  }

  function applyFilterChange() {
    if (selectedDetectionId) {
      const sel = (session.detections || []).find(function (d) { return d.detection_id === selectedDetectionId; });
      if (sel && filterClass && sel.class !== filterClass) selectedDetectionId = null;
    }
    initFilters();
    renderMap();
    renderTable();
    renderPanorama();
  }

  function toggleFilterClass(cls) {
    filterClass = filterClass === cls ? null : cls;
    applyFilterChange();
  }

  function scrollToView(view) {
    const container = document.getElementById('pano-scroll');
    const img = document.getElementById('pano-img');
    if (!container || !img || !img.complete || !img.naturalWidth) return;
    const locKey = String(selectedLocationId);
    const locImagery = imagery[locKey];
    const panoViews = (locImagery && locImagery.pano_views) || [1, 2, 3, 4];
    if (!panoViews.includes(view)) return;
    const idx = panoViews.indexOf(view);
    const tileCount = panoViews.length;
    const tileWidth = img.clientWidth / tileCount;
    const targetLeft = idx * tileWidth + tileWidth / 2 - container.clientWidth / 2;
    container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  }

  function renderPanorama() {
    const img = document.getElementById('pano-img');
    const hud = document.getElementById('pano-hud');
    if (!img || selectedLocationId == null) return;

    const locKey = String(selectedLocationId);
    const locImagery = imagery[locKey];
    if (hud) {
      let hudText = 'Location ' + selectedLocationId;
      if (selectedView != null) hudText += ' \\u00b7 ' + formatView(selectedView);
      if (filterClass) hudText += ' \\u00b7 ' + filterClass;
      hud.textContent = hudText;
    }
    if (!locImagery) {
      img.src = '';
      return;
    }

    if (!filterClass) {
      img.src = locImagery.panorama_image_b64 || '';
      img.onload = function () { scrollToView(selectedView); };
      return;
    }

    const panoViews = locImagery.pano_views || [1, 2, 3, 4];
    const viewTiles = locImagery.view_tiles || {};
    buildFilteredPanoramaFromTiles(panoViews, viewTiles, filterClass).then(function (b64) {
      img.src = b64 || locImagery.panorama_image_b64 || '';
      img.onload = function () { scrollToView(selectedView); };
    }).catch(function () {
      img.src = locImagery.panorama_image_b64 || '';
    });
  }

  function renderTable() {
    const tbody = document.getElementById('det-table-body');
    const empty = document.getElementById('viewer-empty');
    const viewerContent = document.getElementById('viewer-content');
    const filterBanner = document.getElementById('filter-banner');
    if (!tbody) return;

    if (selectedLocationId == null) {
      if (viewerContent) viewerContent.style.display = 'none';
      if (empty) empty.style.display = 'flex';
      if (filterBanner) filterBanner.style.display = 'none';
      tbody.innerHTML = '';
      return;
    }

    if (empty) empty.style.display = 'none';
    if (viewerContent) viewerContent.style.display = 'flex';
    if (filterBanner) {
      filterBanner.style.display = filterClass ? 'block' : 'none';
      filterBanner.textContent = filterClass
        ? 'Showing ' + filterClass + ' only \\u00b7 click row again to show all'
        : '';
    }

    let dets = (session.detections || []).filter(function (d) {
      return d.location_id === selectedLocationId;
    });
    dets = filterDetectionsByClass(dets, filterClass);

    if (!dets.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="padding:12px;color:#8b9cb3;">' +
        (filterClass ? 'No ' + filterClass + ' detections at this location' : 'No detections for this location') +
        '</td></tr>';
      renderPanorama();
      return;
    }

    tbody.innerHTML = dets.map(function (d, i) {
      const highlighted = d.detection_id === selectedDetectionId;
      const rowStyle = highlighted ? ' style="background:rgba(5,203,99,0.12);cursor:pointer;"' : ' style="cursor:pointer;"';
      return '<tr' + rowStyle + ' data-detection-id="' + d.detection_id + '" data-class="' + (d.class || '') + '">' +
        '<td>' + (i + 1) + '</td>' +
        '<td><span class="det-emoji">' + emoji(d.class) + '</span> ' + (d.class || '') + '</td>' +
        '<td>' + formatView(d.view) + '</td>' +
        '<td>' + (d.confidence != null ? (d.confidence * 100).toFixed(1) + '%' : '\\u2014') + '</td>' +
        '<td class="mono">' + formatCoord(d.lat) + ', ' + formatCoord(d.lng) + '</td>' +
        '<td>' + formatMethod(d.geo_method) + '</td>' +
        '<td>' + (d.geo_distance_m != null ? Number(d.geo_distance_m).toFixed(1) + ' m' : '\\u2014') + '</td>' +
        '</tr>';
    }).join('');

    renderPanorama();
  }

  function selectDetection(detectionId) {
    const det = (session.detections || []).find(function (d) { return d.detection_id === detectionId; });
    if (!det) return;
    selectedLocationId = det.location_id;
    selectedDetectionId = detectionId;
    selectedView = det.view != null ? det.view : 4;
    if (filterClass != null && det.class !== filterClass) {
      filterClass = det.class;
    }
    if (det.lat != null && det.lng != null && map) {
      map.flyTo({ center: [det.lng, det.lat], zoom: MAP3D_CFG.defaults.flyToZoom, pitch: map.getPitch(), duration: 450 });
    }
    applyFilterChange();
  }

  function selectCamera(locationId) {
    const pool = filterClass
      ? (session.detections || []).filter(function (d) { return d.class === filterClass; })
      : session.detections || [];
    const firstDet = pool.find(function (d) { return d.location_id === locationId; });
    if (firstDet) {
      selectDetection(firstDet.detection_id);
      return;
    }
    selectedLocationId = locationId;
    selectedDetectionId = null;
    selectedView = 4;
    const loc = (session.locations || []).find(function (l) { return l.id === locationId; });
    if (loc && map) {
      map.flyTo({ center: [loc.lng, loc.lat], zoom: MAP3D_CFG.defaults.flyToZoom, pitch: map.getPitch(), duration: 450 });
    }
    renderMap();
    renderTable();
  }

  function renderMap() {
    if (!map) return;
    var dets = filteredDetections();

    enhanceMap3dExport(map, { basemap: basemap, terrainEnabled: terrainEnabled, buildingsEnabled: buildingsEnabled });

    var trail = trailPoints().map(function (p) { return { lat: p[0], lng: p[1] }; });
    ensureGeoJsonSource(map, 'export-trail', trailToGeoJSON(trail));
    ensureLineLayer(map, 'export-trail', 'export-trail-line', {
      'line-color': '#05CB63',
      'line-width': 3,
      'line-opacity': 0.85,
    });

    ensureGeoJsonSource(map, 'export-rays', raysToGeoJSON(dets, showRays, classColors));
    ensureLineLayer(map, 'export-rays', 'export-ray-lines', {
      'line-color': ['get', 'color'],
      'line-width': 2,
      'line-opacity': 0.75,
      'line-dasharray': [2, 2],
    });

    clearMapMarkers();
    (session.locations || []).forEach(function (loc) {
      var selected = loc.id === selectedLocationId;
      addHtmlMarker(loc.lng, loc.lat, cameraMarkerHtml(selected ? '#05CB63' : '#3B82F6', selected ? 14 : 8), function () {
        selectCamera(loc.id);
      });
    });
    dets.forEach(function (d) {
      var selected = d.detection_id === selectedDetectionId;
      addHtmlMarker(d.lng, d.lat, detectionMarkerHtml(d.class, selected, classColors, classEmojis), function () {
        selectDetection(d.detection_id);
      });
    });

    updateLegend(dets);
  }

  function updateLegend(dets) {
    const legend = document.getElementById('map-legend');
    if (!legend) return;
    const seen = {};
    const classes = [];
    dets.forEach(function (d) {
      if (!d.class || seen[d.class]) return;
      seen[d.class] = true;
      classes.push(d.class);
    });
    let html = '<span><i class="legend-dot camera"></i> GSV camera</span>';
    classes.forEach(function (cls) {
      html += '<span><span class="legend-symbol">' + emoji(cls) + '</span> ' + cls + '</span>';
    });
    legend.innerHTML = html;
  }

  function initFilters() {
    const container = document.getElementById('filter-chips');
    if (!container) return;
    const agg = session.aggregate_counts || {};
    container.innerHTML = '';

    function addChip(label, cls, active) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip' + (active ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', function () {
        filterClass = cls;
        applyFilterChange();
      });
      container.appendChild(btn);
    }

    addChip('All', null, !filterClass);
    (data.classMeta || []).forEach(function (item) {
      if (!(agg[item.key] > 0)) return;
      addChip(item.emoji + ' ' + item.label + ' (' + agg[item.key] + ')', item.key, filterClass === item.key);
    });
  }

  function initMap() {
    var pts = [];
    (session.locations || []).forEach(function (l) { pts.push([l.lat, l.lng]); });
    (session.detections || []).forEach(function (d) { if (d.lat != null) pts.push([d.lat, d.lng]); });
    var center = pts.length ? [pts[0][1], pts[0][0]] : [72.8311, 21.1702];

    map = new maplibregl.Map({
      container: 'map',
      style: MAP3D_CFG.styleUrl,
      center: center,
      zoom: MAP3D_CFG.defaults.zoom,
      pitch: MAP3D_CFG.defaults.pitch,
      bearing: MAP3D_CFG.defaults.bearing,
      maxPitch: 85,
      scrollZoom: true,
      canvasContextAttributes: { antialias: true },
    });

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

    map.on('load', function () {
      enhanceMap3dExport(map, { basemap: basemap, terrainEnabled: terrainEnabled, buildingsEnabled: buildingsEnabled });
      savedView = {
        center: center.slice(),
        zoom: map.getZoom(),
        pitch: MAP3D_CFG.defaults.pitch,
        bearing: MAP3D_CFG.defaults.bearing,
      };
      if (pts.length) {
        var bounds = new maplibregl.LngLatBounds();
        pts.forEach(function (p) { bounds.extend([p[1], p[0]]); });
        map.fitBounds(bounds, { padding: 40, maxZoom: MAP3D_CFG.defaults.fitBoundsMaxZoom, duration: 0 });
        savedView.center = map.getCenter().toArray();
        savedView.zoom = map.getZoom();
      }
      renderMap();
    });
  }

  document.getElementById('btn-basemap').addEventListener('click', function () {
    basemap = basemap === 'street' ? 'satellite' : 'street';
    this.textContent = basemap === 'street' ? 'Satellite' : 'Street map';
    renderMap();
  });

  document.getElementById('btn-rays').addEventListener('click', function () {
    showRays = !showRays;
    this.textContent = showRays ? 'Hide sight lines' : 'Show sight lines';
    renderMap();
  });

  document.getElementById('btn-terrain').addEventListener('click', function () {
    terrainEnabled = !terrainEnabled;
    this.textContent = terrainEnabled ? 'Terrain on' : 'Terrain off';
    renderMap();
  });

  document.getElementById('btn-buildings').addEventListener('click', function () {
    buildingsEnabled = !buildingsEnabled;
    this.textContent = buildingsEnabled ? 'Buildings on' : 'Buildings off';
    renderMap();
  });

  document.getElementById('btn-reset3d').addEventListener('click', function () {
    if (!map || !savedView) return;
    map.easeTo({
      center: savedView.center,
      zoom: savedView.zoom,
      pitch: savedView.pitch,
      bearing: savedView.bearing,
      duration: 600,
    });
  });

  document.getElementById('det-table-body').addEventListener('click', function (e) {
    const row = e.target.closest('tr[data-class]');
    if (!row) return;
    const cls = row.getAttribute('data-class');
    if (!cls) return;
    toggleFilterClass(cls);
  });

  initFilters();
  initMap();
  renderTable();
})();
`
}

const HTML_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GSV Map Detection — __SESSION_TITLE__</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css" crossorigin="" />
  <style>
    :root {
      --bg: #0a0e14;
      --surface: #0f1520;
      --surface2: #151c28;
      --border: #1e2a3a;
      --text: #e8edf4;
      --muted: #8b9cb3;
      --green: #05cb63;
      --green-dim: rgba(5, 203, 99, 0.12);
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      padding: 14px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      display: flex;
      align-items: center;
      gap: 20px;
      flex-wrap: wrap;
    }
    header h1 { margin: 0; font-size: 1.25rem; font-weight: 800; }
    header .subtitle { font-size: 11px; color: var(--muted); font-family: var(--font-mono); margin-top: 4px; }
    .filters {
      padding: 10px 24px;
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      background: var(--surface);
    }
    .chip {
      padding: 6px 12px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: var(--surface2);
      color: var(--text);
      font-size: 12px;
      cursor: pointer;
    }
    .chip.active { background: var(--green-dim); border-color: var(--green); color: var(--green); }
    .body {
      flex: 1;
      display: flex;
      min-height: 0;
    }
    .panel-map {
      flex: 0 0 55%;
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border);
      min-width: 0;
    }
    .panel-viewer {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .panel-label {
      padding: 8px 16px;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      border-bottom: 1px solid var(--border);
      background: var(--surface);
    }
    .map-wrap {
      flex: 1;
      position: relative;
      min-height: 0;
    }
    #map { width: 100%; height: 100%; }
    .map-controls {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 500;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .map-toggle {
      padding: 7px 12px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: rgba(15, 21, 32, 0.92);
      color: var(--text);
      font-size: 12px;
      cursor: pointer;
    }
    .map-toggle:hover { background: var(--green-dim); border-color: var(--green); }
    .map-legend {
      position: absolute;
      bottom: 10px;
      left: 10px;
      z-index: 500;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      padding: 8px 12px;
      border-radius: 8px;
      background: rgba(15, 21, 32, 0.92);
      border: 1px solid var(--border);
      font-size: 11px;
      color: var(--muted);
    }
    .map-legend span { display: inline-flex; align-items: center; gap: 5px; }
    .legend-dot.camera {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #3b82f6;
      border: 2px solid #fff;
    }
    .legend-symbol { font-size: 12px; }
    .map-detection-symbol {
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      background: rgba(15, 21, 32, 0.92);
      border: 2px solid #888;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.45);
      line-height: 1;
      cursor: pointer;
    }
    .map-detection-symbol--selected {
      box-shadow: 0 0 0 2px rgba(5, 203, 99, 0.35), 0 2px 10px rgba(0, 0, 0, 0.5);
    }
    #viewer-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--muted);
      gap: 12px;
      padding: 24px;
      text-align: center;
      font-size: 14px;
    }
    #viewer-content {
      flex: 1;
      display: none;
      flex-direction: column;
      min-height: 0;
    }
    .pano-root { position: relative; flex: 1; min-height: 200px; background: #111; overflow: hidden; }
    .pano-scroll { width: 100%; height: 100%; overflow-x: auto; overflow-y: hidden; }
    .pano-img { height: 100%; width: auto; display: block; user-select: none; }
    .pano-hud {
      position: absolute;
      top: 12px;
      left: 12px;
      padding: 6px 10px;
      border-radius: 6px;
      background: rgba(0,0,0,0.55);
      color: #fff;
      font-size: 11px;
      font-family: var(--font-mono);
      z-index: 3;
      pointer-events: none;
    }
    .table-wrap { flex: 0 0 auto; max-height: 40%; min-height: 120px; overflow: auto; border-top: 1px solid var(--border); }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
    th { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; position: sticky; top: 0; background: var(--surface2); }
    td.mono { font-family: var(--font-mono); font-size: 11px; }
    .det-emoji { margin-right: 4px; }
    footer {
      padding: 8px 24px;
      border-top: 1px solid var(--border);
      font-size: 10px;
      color: var(--muted);
      font-family: var(--font-mono);
      background: var(--surface);
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>GSV Map Detection Results</h1>
      <div class="subtitle">__SESSION_SUBTITLE__</div>
    </div>
  </header>
  <div class="filters" id="filter-chips"></div>
  <div class="body">
    <section class="panel-map">
      <div class="panel-label">Detection map</div>
      <div class="map-wrap">
        <div id="map"></div>
        <div class="map-controls">
          <button type="button" class="map-toggle" id="btn-reset3d">Reset 3D view</button>
          <button type="button" class="map-toggle" id="btn-terrain">Terrain on</button>
          <button type="button" class="map-toggle" id="btn-buildings">Buildings on</button>
          <button type="button" class="map-toggle" id="btn-rays">Show sight lines</button>
          <button type="button" class="map-toggle" id="btn-basemap">Satellite</button>
        </div>
        <div class="map-legend" id="map-legend"></div>
      </div>
    </section>
    <section class="panel-viewer">
      <div class="panel-label">Street view</div>
      <div id="viewer-empty">
        <div style="font-size:48px">&#x1F5FA;&#xFE0F;</div>
        <p>Click any detection marker on the map to view annotated panorama imagery.</p>
      </div>
      <div id="viewer-content">
        <div class="pano-root">
          <div class="pano-scroll" id="pano-scroll">
            <img id="pano-img" class="pano-img" alt="Annotated panorama" draggable="false" />
          </div>
          <div class="pano-hud" id="pano-hud"></div>
        </div>
        <div class="table-wrap">
          <div id="filter-banner" style="display:none;padding:8px 12px;font-size:11px;color:#05cb63;border-bottom:1px solid #1e2a3a;background:rgba(5,203,99,0.08);"></div>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Object</th>
                <th>View</th>
                <th>Conf.</th>
                <th>Lat, Lng</th>
                <th>Method</th>
                <th>Dist.</th>
              </tr>
            </thead>
            <tbody id="det-table-body"></tbody>
          </table>
        </div>
      </div>
    </section>
  </div>
  <footer>__FOOTER__</footer>
  <script type="application/json" id="export-data">__EXPORT_DATA__</script>
  <script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js" crossorigin=""></script>
  <script>__VIEWER_SCRIPT__</script>
</body>
</html>`

function locationImageryFromResponse(locationId, response, fallbackLat, fallbackLng) {
  const panoViews = response.pano_views || [1, 2, 3, 4]
  const { viewTiles } = buildViewTilesFromResponse(locationId, response)
  return {
    lat: response.lat ?? fallbackLat,
    lng: response.lng ?? fallbackLng,
    pano_views: panoViews,
    panorama_image_b64: response.panorama_image_b64 || '',
    view_tiles: viewTiles,
  }
}

async function fetchLocationImagery(locationId, fallbackLat, fallbackLng) {
  const res = await detectGsvContinuedPanorama(locationId)
  const data = res.data
  if (!data?.panorama_image_b64) {
    const err = new Error(`No panorama imagery for location ${locationId}`)
    err.locationId = locationId
    throw err
  }
  const entry = locationImageryFromResponse(locationId, data, fallbackLat, fallbackLng)
  entry.view_tiles = await enrichImageryWithViewTiles(locationId, data, entry.view_tiles)
  return entry
}

export async function collectSessionImagery(session, existingCache = {}, onProgress) {
  const locations = session?.locations || []
  const total = locations.length
  const imagery = {}
  let done = 0

  async function processLocation(loc) {
    try {
      const cached = existingCache[loc.id]
      if (cached?.panorama_image_b64) {
        const entry = locationImageryFromResponse(loc.id, cached, loc.lat, loc.lng)
        entry.view_tiles = await enrichImageryWithViewTiles(loc.id, cached, entry.view_tiles)
        imagery[String(loc.id)] = entry
      } else {
        imagery[String(loc.id)] = await fetchLocationImagery(loc.id, loc.lat, loc.lng)
      }
    } catch (err) {
      const wrapped = new Error(`Failed to fetch imagery for location ${loc.id}`)
      wrapped.locationId = loc.id
      wrapped.cause = err
      throw wrapped
    }
    done += 1
    onProgress?.({ done, total, locationId: loc.id })
  }

  for (let i = 0; i < locations.length; i += FETCH_CONCURRENCY) {
    const batch = locations.slice(i, i + FETCH_CONCURRENCY)
    await Promise.all(batch.map(processLocation))
  }

  return imagery
}

export function buildGsvMapExportHtml(session, imageryByLocation) {
  const officialCounts = session.official_counts || session.aggregate_counts || {}
  const verifiedCounts = session.verified_counts || {}
  const totalOfficial = Object.values(officialCounts).reduce((a, b) => a + b, 0)
  const totalVerified = Object.values(verifiedCounts).reduce((a, b) => a + b, 0)
  const estimated = Math.max(0, totalOfficial - totalVerified)
  const shortId = (session.sessionId || 'session').slice(0, 8)
  const generatedAt = new Date().toISOString()

  const exportDetections = filterMapMarkers(session.detections || [], {
    staticOnly: true,
    verifiedOnly: true,
  })

  const exportData = {
    session: {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      locations: session.locations,
      detections: exportDetections,
      raw_detections: session.raw_detections || [],
      aggregate_counts: officialCounts,
      official_counts: officialCounts,
      verified_counts: verifiedCounts,
      geo_pipeline_version: session.geo_pipeline_version || 1,
    },
    imagery: imageryByLocation,
    classColors: CLASS_COLORS,
    classEmojis: CLASS_EMOJIS,
    classMeta: CLASS_META,
    generatedAt,
  }

  const durationMins = (() => {
    if (!session.startedAt) return '—'
    const end = session.endedAt ? new Date(session.endedAt) : new Date()
    const start = new Date(session.startedAt)
    const mins = Math.round((end - start) / 60000)
    if (mins < 1) return '< 1 min'
    return `${mins} min`
  })()

  const subtitle = `${session.locations.length} locations · ${totalVerified || totalOfficial} verified${estimated > 0 ? ` · ${estimated} estimated` : ''} · ${durationMins}`
  const methodology = session.geo_pipeline_version >= 2
    ? ' · Assets deduplicated per location; traffic signals snapped to intersection corners where OSM/nav data available'
    : ''
  const footer = `Generated ${generatedAt.slice(0, 19).replace('T', ' ')} UTC · Session ${shortId} · Map tiles © OpenStreetMap / Esri · Imagery embedded offline${methodology}`

  return HTML_SHELL
    .replace('__SESSION_TITLE__', shortId)
    .replace('__SESSION_SUBTITLE__', subtitle)
    .replace('__FOOTER__', footer)
    .replace('__EXPORT_DATA__', JSON.stringify(exportData))
    .replace('__VIEWER_SCRIPT__', buildExportViewerScript())
}

export function downloadGsvMapExportHtml(session, imageryByLocation) {
  const html = buildGsvMapExportHtml(session, imageryByLocation)
  let blob
  try {
    blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  } catch (err) {
    const error = new Error('Session too large — try exporting after visiting fewer locations.')
    error.cause = err
    throw error
  }

  const shortId = (session.sessionId || 'session').slice(0, 8)
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const filename = `gsv-map-${shortId}-${date}.html`

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
