import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'
import MarkerClusterGroup from 'react-leaflet-cluster'
import L from 'leaflet'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'

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
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 6px ${color}99;"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })

const PIN_DEFAULT = makeIcon('#3B82F6', 8)
const PIN_SELECTED = makeIcon('#05CB63', 14)

function MapResize() {
  const map = useMap()
  useEffect(() => {
    const run = () => map.invalidateSize()
    run()
    const t = window.setTimeout(run, 100)
    window.addEventListener('resize', run)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', run)
    }
  }, [map])
  return null
}

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
    map.fitBounds(L.latLngBounds(points), { padding: [32, 32], maxZoom: 12 })
    window.setTimeout(() => map.invalidateSize(), 50)
  }, [map, points, resetKey])

  return null
}

export default function DatasetMap({
  points = [],
  selectedId,
  onSelectPoint,
  basemap = 'street',
  onBasemapToggle,
}) {
  const [markersReady, setMarkersReady] = useState(false)
  const selected = points.find((p) => p.id === selectedId)
  const fitPoints = useMemo(
    () => points.map((p) => [p.lat, p.lng]),
    [points]
  )

  const center = useMemo(() => {
    if (selected) return [selected.lat, selected.lng]
    if (points.length) return [points[0].lat, points[0].lng]
    return [20, 0]
  }, [selected, points])

  const layer = BASE_LAYERS[basemap]

  useEffect(() => {
    setMarkersReady(false)
    if (!points.length) return undefined
    const t = window.setTimeout(() => setMarkersReady(true), 200)
    return () => window.clearTimeout(t)
  }, [points])

  return (
    <div className="dashboard-map-wrap" style={{ height: '100%', width: '100%' }}>
      <MapContainer center={center} zoom={3} style={{ width: '100%', height: '100%' }} scrollWheelZoom>
        <TileLayer url={layer.url} attribution={layer.attribution} maxZoom={19} />
        <MapResize />
        <MapFitBounds points={fitPoints} resetKey={points.length} />
        {selected && <MapFlyTo lat={selected.lat} lng={selected.lng} />}

        {markersReady && (
          <MarkerClusterGroup chunkedLoading maxClusterRadius={50}>
            {points.map((p) => (
              <Marker
                key={p.id}
                position={[p.lat, p.lng]}
                icon={p.id === selectedId ? PIN_SELECTED : PIN_DEFAULT}
                eventHandlers={{ click: () => onSelectPoint(p.id) }}
              />
            ))}
          </MarkerClusterGroup>
        )}
      </MapContainer>

      {onBasemapToggle && (
        <div className="dashboard-map-controls">
          <button type="button" className="dashboard-map-toggle" onClick={onBasemapToggle}>
            {basemap === 'street' ? 'Satellite' : 'Street map'}
          </button>
        </div>
      )}
    </div>
  )
}
