import { useCallback, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import toast from 'react-hot-toast'
import { useDetections } from '../context/DetectionContext'
import { detectStreet } from '../api'
import MapillaryLayer from './MapillaryLayer'
import MarkerPopup from './MarkerPopup'

const makeIcon = (color, size = 14) =>
  L.divIcon({
    className: '',
    html: `
    <div style="position:relative;width:${size}px;height:${size}px;">
      <div style="
        width:${size}px;height:${size}px;border-radius:50%;
        background:${color};border:2.5px solid #fff;
        box-shadow:0 0 12px ${color}99;
      "></div>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })

const loadingIcon = L.divIcon({
  className: '',
  html: `
    <div style="position:relative;width:24px;height:24px;">
      <div style="position:absolute;inset:0;border-radius:50%;background:rgba(5,203,99,0.3);border:2px solid #05CB63;animation:pulse-ring 1s ease-out infinite;"></div>
      <div style="position:absolute;inset:4px;border-radius:50%;background:#05CB63;"></div>
    </div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
})

const STREET_ICON = makeIcon('#3B82F6')
const CAMERA_ICON = makeIcon('#FF6B35')

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

function ClickHandler({ onMapClick }) {
  useMapEvents({
    click: (e) => onMapClick(e.latlng.lat, e.latlng.lng, null),
  })
  return null
}

export default function MapView() {
  const { markers, mapillaryToken, addDetection, setActiveDetection } = useDetections()
  const [loadingMarker, setLoadingMarker] = useState(null)
  const [streetPreview, setStreetPreview] = useState(null)
  const [basemap, setBasemap] = useState('street')
  const activeBase = BASE_LAYERS[basemap]

  const runStreetDetect = useCallback(
    async (lat, lng, imageId = null) => {
      setLoadingMarker({ lat, lng })
      try {
        const { data } = await detectStreet(lat, lng, imageId)
        if (data.error === 'mapillary_error') {
          toast.error(data.message || 'Mapillary API error. Check your access token.')
          setStreetPreview(null)
        } else if (data.error) {
          toast.error(data.message || 'No imagery here. Click on or near green coverage.')
          setStreetPreview(null)
        } else {
          addDetection(data)
          if (data.source === 'street') {
            setStreetPreview({
              imageUrl: data.image_url,
              capturedAt: data.captured_at,
              distanceM: data.distance_m,
            })
          }
          toast.success(
            `Detected ${Object.values(data.counts || {}).reduce((a, b) => a + b, 0)} objects`,
            { icon: '🔍' }
          )
        }
      } catch (_) {
        toast.error('Detection failed. Is the inference server running?')
      } finally {
        setLoadingMarker(null)
      }
    },
    [addDetection]
  )

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <MapContainer
        center={[21.1702, 72.8311]}
        zoom={14}
        minZoom={6}
        maxZoom={19}
        style={{ width: '100%', height: '100%' }}
      >
        <TileLayer
          key={basemap}
          url={activeBase.url}
          attribution={activeBase.attribution}
          maxNativeZoom={19}
          maxZoom={19}
        />
        <MapillaryLayer token={mapillaryToken} basemap={basemap} />
        <ClickHandler onMapClick={runStreetDetect} />

        {loadingMarker && <Marker position={[loadingMarker.lat, loadingMarker.lng]} icon={loadingIcon} />}

        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={m.source === 'camera' ? CAMERA_ICON : STREET_ICON}
            eventHandlers={{ click: () => setActiveDetection(m) }}
          >
            <Popup>
              <MarkerPopup data={m} />
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <button
        type="button"
        onClick={() => setBasemap((prev) => (prev === 'street' ? 'satellite' : 'street'))}
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 500,
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--surface)',
          color: 'var(--text)',
          fontFamily: 'var(--font-ui)',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        }}
      >
        {basemap === 'street' ? '🛰️ Satellite' : '🗺️ Street map'}
      </button>

      {streetPreview?.imageUrl && (
        <div
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            width: 220,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            overflow: 'hidden',
            zIndex: 500,
            boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
          }}
        >
          <img
            src={streetPreview.imageUrl}
            alt="Nearest street imagery"
            style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }}
          />
          <div style={{ padding: '6px 8px', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            Street preview
            {streetPreview.distanceM ? ` · ${streetPreview.distanceM}m` : ''}
            {streetPreview.capturedAt ? ` · ${new Date(streetPreview.capturedAt).toLocaleDateString('en-IN')}` : ''}
          </div>
        </div>
      )}
    </div>
  )
}
