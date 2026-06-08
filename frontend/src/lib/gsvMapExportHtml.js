import { detectGsvContinuedPanorama } from '../api'
import { CLASS_COLORS, CLASS_EMOJIS, CLASS_META } from '../constants/classes'

const FETCH_CONCURRENCY = 2

const EXPORT_VIEWER_SCRIPT = `
(function () {
  const data = JSON.parse(document.getElementById('export-data').textContent);
  const session = data.session;
  const imagery = data.imagery;
  const classColors = data.classColors || {};
  const classEmojis = data.classEmojis || {};

  const BASE_LAYERS = {
    street: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
    },
    satellite: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
    },
  };

  let filterClass = null;
  let basemap = 'street';
  let showRays = false;
  let selectedLocationId = null;
  let selectedDetectionId = null;
  let selectedView = 4;

  let map;
  let tileLayer;
  let trailLayer;
  let rayLayer;
  let cameraLayer;
  let detectionLayer;

  function emoji(cls) {
    return classEmojis[cls] || '\\u{1F4E6}';
  }

  function makeCameraIcon(color, size) {
    return L.divIcon({
      className: '',
      html: '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color + ';border:2px solid #fff;box-shadow:0 0 8px ' + color + '99;"></div>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function makeDetectionIcon(cls, selected) {
    const em = emoji(cls);
    const color = classColors[cls] || '#888';
    const size = selected ? 30 : 24;
    const fontSize = selected ? 17 : 14;
    const border = selected ? '#05CB63' : color;
    const selClass = selected ? ' map-detection-symbol--selected' : '';
    return L.divIcon({
      className: '',
      html: '<div class="map-detection-symbol' + selClass + '" style="width:' + size + 'px;height:' + size + 'px;border-color:' + border + ';font-size:' + fontSize + 'px;">' + em + '</div>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
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

  function renderTable() {
    const tbody = document.getElementById('det-table-body');
    const empty = document.getElementById('viewer-empty');
    const viewerContent = document.getElementById('viewer-content');
    if (!tbody) return;

    if (selectedLocationId == null) {
      if (viewerContent) viewerContent.style.display = 'none';
      if (empty) empty.style.display = 'flex';
      tbody.innerHTML = '';
      return;
    }

    if (empty) empty.style.display = 'none';
    if (viewerContent) viewerContent.style.display = 'flex';

    const dets = (session.detections || []).filter(function (d) {
      return d.location_id === selectedLocationId;
    });

    const locKey = String(selectedLocationId);
    const locImagery = imagery[locKey];
    const pano = locImagery && locImagery.panorama_image_b64;
    const img = document.getElementById('pano-img');
    const hud = document.getElementById('pano-hud');
    if (img) {
      img.src = pano || '';
      img.onload = function () { scrollToView(selectedView); };
    }
    if (hud) {
      hud.textContent = 'Location ' + selectedLocationId + (selectedView != null ? ' \\u00b7 ' + formatView(selectedView) : '');
    }

    if (!dets.length) {
      tbody.innerHTML = '<tr><td colspan="7" style="padding:12px;color:#8b9cb3;">No detections for this location</td></tr>';
      return;
    }

    tbody.innerHTML = dets.map(function (d, i) {
      const highlighted = d.detection_id === selectedDetectionId;
      const rowStyle = highlighted ? ' style="background:rgba(5,203,99,0.12);"' : '';
      return '<tr' + rowStyle + ' data-detection-id="' + d.detection_id + '">' +
        '<td>' + (i + 1) + '</td>' +
        '<td><span class="det-emoji">' + emoji(d.class) + '</span> ' + (d.class || '') + '</td>' +
        '<td>' + formatView(d.view) + '</td>' +
        '<td>' + (d.confidence != null ? (d.confidence * 100).toFixed(1) + '%' : '\\u2014') + '</td>' +
        '<td class="mono">' + formatCoord(d.lat) + ', ' + formatCoord(d.lng) + '</td>' +
        '<td>' + formatMethod(d.geo_method) + '</td>' +
        '<td>' + (d.geo_distance_m != null ? Number(d.geo_distance_m).toFixed(1) + ' m' : '\\u2014') + '</td>' +
        '</tr>';
    }).join('');

    scrollToView(selectedView);
  }

  function selectDetection(detectionId) {
    const det = (session.detections || []).find(function (d) { return d.detection_id === detectionId; });
    if (!det) return;
    selectedLocationId = det.location_id;
    selectedDetectionId = detectionId;
    selectedView = det.view != null ? det.view : 4;
    if (det.lat != null && det.lng != null && map) {
      map.flyTo([det.lat, det.lng], 17, { duration: 0.45 });
    }
    renderMap();
    renderTable();
  }

  function selectCamera(locationId) {
    const firstDet = (session.detections || []).find(function (d) { return d.location_id === locationId; });
    if (firstDet) {
      selectDetection(firstDet.detection_id);
      return;
    }
    selectedLocationId = locationId;
    selectedDetectionId = null;
    selectedView = 4;
    const loc = (session.locations || []).find(function (l) { return l.id === locationId; });
    if (loc && map) map.flyTo([loc.lat, loc.lng], 17, { duration: 0.45 });
    renderMap();
    renderTable();
  }

  function renderMap() {
    if (!map) return;
    const dets = filteredDetections();

    if (tileLayer) map.removeLayer(tileLayer);
    const layer = BASE_LAYERS[basemap];
    tileLayer = L.tileLayer(layer.url, { attribution: layer.attribution, maxZoom: 19 }).addTo(map);

    if (trailLayer) map.removeLayer(trailLayer);
    const trail = trailPoints();
    if (trail.length > 1) {
      trailLayer = L.polyline(trail, { color: '#05CB63', weight: 3, opacity: 0.85 }).addTo(map);
    } else {
      trailLayer = null;
    }

    if (rayLayer) map.removeLayer(rayLayer);
    rayLayer = L.layerGroup();
    if (showRays) {
      dets.forEach(function (d) {
        if (d.camera_lat == null) return;
        const endLat = d.ray_end_lat != null ? d.ray_end_lat : d.lat;
        const endLng = d.ray_end_lng != null ? d.ray_end_lng : d.lng;
        L.polyline(
          [[d.camera_lat, d.camera_lng], [endLat, endLng]],
          { color: classColors[d.class] || '#888', weight: 2, dashArray: '6 4', opacity: 0.75 }
        ).addTo(rayLayer);
      });
    }
    rayLayer.addTo(map);

    if (cameraLayer) map.removeLayer(cameraLayer);
    cameraLayer = L.layerGroup();
    (session.locations || []).forEach(function (loc) {
      const selected = loc.id === selectedLocationId;
      L.marker([loc.lat, loc.lng], {
        icon: makeCameraIcon(selected ? '#05CB63' : '#3B82F6', selected ? 14 : 8),
      }).on('click', function () { selectCamera(loc.id); }).addTo(cameraLayer);
    });
    cameraLayer.addTo(map);

    if (detectionLayer) map.removeLayer(detectionLayer);
    detectionLayer = L.layerGroup();
    dets.forEach(function (d) {
      const selected = d.detection_id === selectedDetectionId;
      L.marker([d.lat, d.lng], {
        icon: makeDetectionIcon(d.class, selected),
        zIndexOffset: selected ? 900 : 500,
      }).on('click', function () { selectDetection(d.detection_id); }).addTo(detectionLayer);
    });
    detectionLayer.addTo(map);

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
        initFilters();
        renderMap();
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
    const pts = [];
    (session.locations || []).forEach(function (l) { pts.push([l.lat, l.lng]); });
    (session.detections || []).forEach(function (d) { if (d.lat != null) pts.push([d.lat, d.lng]); });
    const center = pts.length ? pts[0] : [21.1702, 72.8311];

    map = L.map('map', { scrollWheelZoom: true }).setView(center, 14);
    if (pts.length) {
      map.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 17 });
    }
    renderMap();
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

  initFilters();
  initMap();
  renderTable();
})();
`

const HTML_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>GSV Map Detection — __SESSION_TITLE__</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin="" />
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
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
  <script>__VIEWER_SCRIPT__</script>
</body>
</html>`

function locationImageryFromResponse(locationId, response, fallbackLat, fallbackLng) {
  const panoViews = response.pano_views || [1, 2, 3, 4]
  return {
    lat: response.lat ?? fallbackLat,
    lng: response.lng ?? fallbackLng,
    pano_views: panoViews,
    panorama_image_b64: response.panorama_image_b64 || '',
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
  return locationImageryFromResponse(locationId, data, fallbackLat, fallbackLng)
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
        imagery[String(loc.id)] = locationImageryFromResponse(loc.id, cached, loc.lat, loc.lng)
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
  const totalObjects = Object.values(session.aggregate_counts || {}).reduce((a, b) => a + b, 0)
  const shortId = (session.sessionId || 'session').slice(0, 8)
  const generatedAt = new Date().toISOString()

  const exportData = {
    session: {
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      locations: session.locations,
      detections: session.detections,
      aggregate_counts: session.aggregate_counts,
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

  const subtitle = `${session.locations.length} locations · ${totalObjects} objects · ${durationMins}`
  const footer = `Generated ${generatedAt.slice(0, 19).replace('T', ' ')} UTC · Session ${shortId} · Map tiles © OpenStreetMap / Esri · Imagery embedded offline`

  return HTML_SHELL
    .replace('__SESSION_TITLE__', shortId)
    .replace('__SESSION_SUBTITLE__', subtitle)
    .replace('__FOOTER__', footer)
    .replace('__EXPORT_DATA__', JSON.stringify(exportData))
    .replace('__VIEWER_SCRIPT__', EXPORT_VIEWER_SCRIPT)
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
