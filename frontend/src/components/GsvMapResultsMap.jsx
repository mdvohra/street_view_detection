import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, Polyline, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import { CLASS_COLORS } from '../constants/classes'
import { detectionEmoji, makeDetectionSymbolIcon } from '../lib/detectionMapIcons'

const BASE_LAYERS = {
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenStreetMap contributors',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri',
  },
}

const makeIcon = (color, size = 8) =>
  L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 8px ${color}99;"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })

const PIN_CAMERA = makeIcon('#3B82F6', 8)
const PIN_CAMERA_SELECTED = makeIcon('#05CB63', 14)

function MapFlyTo({ lat, lng, zoom = 17 }) {
  const map = useMap()
  useEffect(() => {
    if (lat == null || lng == null) return
    map.flyTo([lat, lng], zoom, { duration: 0.45 })
  }, [lat, lng, zoom, map])
  return null
}

function MapFitBounds({ points, resetKey }) {
  const map = useMap()
  const fittedRef = useRef(false)

  useEffect(() => {
    fittedRef.current = false
  }, [resetKey])

  useEffect(() => {
    if (fittedRef.current || !points.length) return
    fittedRef.current = true
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 17 })
  }, [map, points, resetKey])

  return null
}

export default function GsvMapResultsMap({
  cameraMarkers = [],
  detectionMarkers = [],
  trailPoints = [],
  selectedLocationId,
  selectedDetectionId,
  onSelectCamera,
  onSelectDetection,
  basemap = 'street',
  onBasemapToggle,
  showRays = false,
  onToggleRays,
}) {
  const activeCamera = cameraMarkers.find((m) => m.id === selectedLocationId)
  const activeDetection = detectionMarkers.find((d) => d.detection_id === selectedDetectionId)

  const flyTarget = useMemo(() => {
    if (activeDetection?.lat != null) {
      return { lat: activeDetection.lat, lng: activeDetection.lng }
    }
    if (activeCamera?.lat != null) {
      return { lat: activeCamera.lat, lng: activeCamera.lng }
    }
    return null
  }, [activeCamera, activeDetection])

  const center = useMemo(() => {
    if (flyTarget) return [flyTarget.lat, flyTarget.lng]
    if (cameraMarkers.length) return [cameraMarkers[0].lat, cameraMarkers[0].lng]
    return [21.1702, 72.8311]
  }, [flyTarget, cameraMarkers])

  const layer = BASE_LAYERS[basemap]

  const fitPoints = useMemo(() => {
    const pts = []
    cameraMarkers.forEach((m) => {
      if (m.lat != null) pts.push([m.lat, m.lng])
    })
    detectionMarkers.forEach((d) => {
      if (d.lat != null) pts.push([d.lat, d.lng])
    })
    return pts
  }, [cameraMarkers, detectionMarkers])

  const rays = useMemo(() => {
    if (!showRays) return []
    return detectionMarkers
      .filter((d) => d.camera_lat != null && d.bearing_deg != null)
      .map((d) => {
        const endLat = d.ray_end_lat ?? d.lat
        const endLng = d.ray_end_lng ?? d.lng
        return {
          id: d.detection_id,
          positions: [
            [d.camera_lat, d.camera_lng],
            [endLat, endLng],
          ],
          color: CLASS_COLORS[d.class] || '#888',
        }
      })
  }, [showRays, detectionMarkers])

  const legendClasses = useMemo(() => {
    const seen = new Set()
    const items = []
    for (const d of detectionMarkers) {
      if (!d.class || seen.has(d.class)) continue
      seen.add(d.class)
      items.push(d.class)
    }
    return items
  }, [detectionMarkers])

  const trailLatLngs = trailPoints.map((p) => [p.lat, p.lng])

  return (
    <div className="dashboard-map-wrap">
      <MapContainer
        center={center}
        zoom={14}
        style={{ width: '100%', height: '100%' }}
        scrollWheelZoom
      >
        <TileLayer url={layer.url} attribution={layer.attribution} maxZoom={19} />
        <MapFitBounds points={fitPoints} resetKey={fitPoints.length} />
        {flyTarget && <MapFlyTo lat={flyTarget.lat} lng={flyTarget.lng} />}

        {trailLatLngs.length > 1 && (
          <Polyline
            positions={trailLatLngs}
            pathOptions={{ color: '#05CB63', weight: 3, opacity: 0.85 }}
          />
        )}

        {rays.map((ray) => (
          <Polyline
            key={ray.id}
            positions={ray.positions}
            pathOptions={{ color: ray.color, weight: 2, dashArray: '6 4', opacity: 0.75 }}
          />
        ))}

        {cameraMarkers.map((m) => (
          <Marker
            key={`cam-${m.id}`}
            position={[m.lat, m.lng]}
            icon={m.id === selectedLocationId ? PIN_CAMERA_SELECTED : PIN_CAMERA}
            eventHandlers={{ click: () => onSelectCamera?.(m.id) }}
          />
        ))}

        {detectionMarkers.map((d) => {
          const selected = d.detection_id === selectedDetectionId
          return (
            <Marker
              key={d.detection_id}
              position={[d.lat, d.lng]}
              icon={makeDetectionSymbolIcon(d.class, selected)}
              zIndexOffset={selected ? 900 : 500}
              eventHandlers={{
                click: () => onSelectDetection?.(d.detection_id),
              }}
            />
          )
        })}
      </MapContainer>

      <div className="dashboard-map-controls">
        {onToggleRays && (
          <button type="button" className="dashboard-map-toggle" onClick={onToggleRays}>
            {showRays ? 'Hide sight lines' : 'Show sight lines'}
          </button>
        )}
        {onBasemapToggle && (
          <button type="button" className="dashboard-map-toggle" onClick={onBasemapToggle}>
            {basemap === 'street' ? 'Satellite' : 'Street map'}
          </button>
        )}
      </div>

      <div className="dashboard-map-legend">
        <span><i className="legend-dot camera" /> GSV camera</span>
        {legendClasses.map((cls) => (
          <span key={cls}>
            <span className="legend-symbol" aria-hidden="true">
              {detectionEmoji(cls)}
            </span>
            {cls}
          </span>
        ))}
      </div>
    </div>
  )
}
