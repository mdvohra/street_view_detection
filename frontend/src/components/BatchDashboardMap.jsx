import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, Polygon, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import MapillaryLayer from './MapillaryLayer'

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

const POLY_STYLE = {
  color: '#05CB63',
  weight: 2,
  fillColor: '#05CB63',
  fillOpacity: 0.12,
}

const makeIcon = (color, size = 10) =>
  L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 8px ${color}99;"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })

const PIN_DEFAULT = makeIcon('#3B82F6', 10)
const PIN_SELECTED = makeIcon('#05CB63', 16)

function MapFlyTo({ lat, lng, zoom = 17 }) {
  const map = useMap()
  useEffect(() => {
    if (lat == null || lng == null) return
    map.flyTo([lat, lng], zoom, { duration: 0.45 })
  }, [lat, lng, zoom, map])
  return null
}

function MapFitBounds({ markers, polygon, resetKey }) {
  const map = useMap()
  const fittedRef = useRef(false)

  useEffect(() => {
    fittedRef.current = false
  }, [resetKey])

  useEffect(() => {
    if (fittedRef.current) return
    const points = []
    if (polygon?.length >= 3) {
      polygon.forEach(([lng, lat]) => points.push([lat, lng]))
    }
    markers.forEach((m) => {
      if (m.lat != null && m.lng != null) points.push([m.lat, m.lng])
    })
    if (points.length === 0) return
    fittedRef.current = true
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24], maxZoom: 17 })
  }, [map, markers, polygon, resetKey])

  return null
}

export default function BatchDashboardMap({
  markers,
  polygon,
  selectedImageId,
  onSelect,
  mapillaryToken,
  basemap = 'street',
  onBasemapToggle,
}) {
  const active = markers.find((m) => m.image_id === selectedImageId)

  const center = useMemo(() => {
    if (active?.lat != null && active?.lng != null) return [active.lat, active.lng]
    if (markers.length) return [markers[0].lat, markers[0].lng]
    return [21.1702, 72.8311]
  }, [active, markers])

  const polygonLatLngs =
    polygon?.length >= 3 ? polygon.map(([lng, lat]) => [lat, lng]) : null

  const layer = BASE_LAYERS[basemap]

  return (
    <div className="dashboard-map-wrap">
      <MapContainer
        center={center}
        zoom={14}
        style={{ width: '100%', height: '100%' }}
        scrollWheelZoom
      >
        <TileLayer url={layer.url} attribution={layer.attribution} maxZoom={19} />
        {mapillaryToken && <MapillaryLayer token={mapillaryToken} basemap={basemap} />}
        {polygonLatLngs && <Polygon positions={polygonLatLngs} pathOptions={POLY_STYLE} />}
        <MapFitBounds markers={markers} polygon={polygon} resetKey={markers.length} />
        {active && (
          <MapFlyTo lat={active.lat} lng={active.lng} />
        )}
        {markers.map((m) => (
          <Marker
            key={m.image_id}
            position={[m.lat, m.lng]}
            icon={m.image_id === selectedImageId ? PIN_SELECTED : PIN_DEFAULT}
            eventHandlers={{
              click: () => onSelect(m.image_id),
            }}
          />
        ))}
      </MapContainer>
      {onBasemapToggle && (
        <button type="button" className="dashboard-map-toggle" onClick={onBasemapToggle}>
          {basemap === 'street' ? 'Satellite' : 'Street map'}
        </button>
      )}
    </div>
  )
}
