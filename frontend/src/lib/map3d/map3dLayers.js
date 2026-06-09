import { CLASS_COLORS } from '../../constants/classes'

export function trailToGeoJSON(trailPoints = []) {
  const coordinates = trailPoints
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => [p.lng, p.lat])

  if (coordinates.length < 2) {
    return { type: 'FeatureCollection', features: [] }
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates },
      },
    ],
  }
}

export function raysToGeoJSON(detectionMarkers = [], showRays = false) {
  if (!showRays) {
    return { type: 'FeatureCollection', features: [] }
  }

  const features = detectionMarkers
    .filter((d) => d.camera_lat != null && d.bearing_deg != null)
    .map((d) => {
      const endLat = d.ray_end_lat ?? d.lat
      const endLng = d.ray_end_lng ?? d.lng
      return {
        type: 'Feature',
        properties: { color: CLASS_COLORS[d.class] || '#888', id: d.detection_id },
        geometry: {
          type: 'LineString',
          coordinates: [
            [d.camera_lng, d.camera_lat],
            [endLng, endLat],
          ],
        },
      }
    })

  return { type: 'FeatureCollection', features }
}

export function pointsToClusterGeoJSON(points = [], excludeId = null) {
  const features = points
    .filter((p) => p.id !== excludeId && p.lat != null && p.lng != null)
    .map((p) => ({
      type: 'Feature',
      properties: { id: p.id },
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
    }))

  return { type: 'FeatureCollection', features }
}

export function fitPointsFromMarkers({ cameraMarkers = [], detectionMarkers = [], points = [] } = {}) {
  const result = []
  cameraMarkers.forEach((m) => {
    if (m.lat != null) result.push([m.lat, m.lng])
  })
  detectionMarkers.forEach((d) => {
    if (d.lat != null) result.push([d.lat, d.lng])
  })
  points.forEach((p) => {
    if (p.lat != null) result.push([p.lat, p.lng])
  })
  return result
}

export function computeMapCenter({ cameraMarkers = [], detectionMarkers = [], points = [], flyTarget = null, fallback = [21.1702, 72.8311] } = {}) {
  if (flyTarget?.lat != null) return { lat: flyTarget.lat, lng: flyTarget.lng }
  if (cameraMarkers.length) return { lat: cameraMarkers[0].lat, lng: cameraMarkers[0].lng }
  if (points.length) return { lat: points[0].lat, lng: points[0].lng }
  return { lat: fallback[0], lng: fallback[1] }
}

export function uniqueLegendClasses(detectionMarkers = []) {
  const seen = new Set()
  const items = []
  for (const d of detectionMarkers) {
    if (!d.class || seen.has(d.class)) continue
    seen.add(d.class)
    items.push(d.class)
  }
  return items
}

/** Serialize shared helpers for offline HTML export (pure functions as strings). */
export function serializeMap3dExportHelpers() {
  return `
function trailToGeoJSON(trailPoints) {
  var coordinates = (trailPoints || [])
    .filter(function (p) { return p.lat != null && p.lng != null; })
    .map(function (p) { return [p.lng, p.lat]; });
  if (coordinates.length < 2) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coordinates } }],
  };
}

function raysToGeoJSON(detectionMarkers, showRays, classColors) {
  if (!showRays) return { type: 'FeatureCollection', features: [] };
  var features = (detectionMarkers || [])
    .filter(function (d) { return d.camera_lat != null && d.bearing_deg != null; })
    .map(function (d) {
      var endLat = d.ray_end_lat != null ? d.ray_end_lat : d.lat;
      var endLng = d.ray_end_lng != null ? d.ray_end_lng : d.lng;
      return {
        type: 'Feature',
        properties: { color: (classColors || {})[d.class] || '#888', id: d.detection_id },
        geometry: {
          type: 'LineString',
          coordinates: [[d.camera_lng, d.camera_lat], [endLng, endLat]],
        },
      };
    });
  return { type: 'FeatureCollection', features: features };
}

function detectionMarkerHtml(cls, selected, classColors, classEmojis) {
  var emoji = (classEmojis || {})[cls] || '\\u{1F4E6}';
  var color = (classColors || {})[cls] || '#888';
  var size = selected ? 30 : 24;
  var fontSize = selected ? 17 : 14;
  var border = selected ? '#05CB63' : color;
  var selClass = selected ? ' map-detection-symbol--selected' : '';
  return '<div class="map-detection-symbol' + selClass + '" style="width:' + size + 'px;height:' + size + 'px;border-color:' + border + ';font-size:' + fontSize + 'px;">' + emoji + '</div>';
}

function cameraMarkerHtml(color, size) {
  size = size || 8;
  return '<div style="width:' + size + 'px;height:' + size + 'px;border-radius:50%;background:' + color + ';border:2px solid #fff;box-shadow:0 0 8px ' + color + '99;"></div>';
}
`
}
