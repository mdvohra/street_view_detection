import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import toast from 'react-hot-toast'
import { useDetections } from '../context/DetectionContext'
import { cancelBatchJob, detectStreet, getBatchJob, startBatchPolygon } from '../api'
import MapillaryLayer from './MapillaryLayer'
import MarkerPopup from './MarkerPopup'
import PolygonDrawControl from './PolygonDrawControl'
import PolygonToolbar from './PolygonToolbar'
import BatchProgressOverlay from './BatchProgressOverlay'

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

const TERMINAL = new Set(['completed', 'cancelled', 'failed'])

function ClickHandler({ onMapClick, enabled }) {
  useMapEvents({
    click: (e) => {
      if (enabled) onMapClick(e.latlng.lat, e.latlng.lng, null)
    },
  })
  return null
}

export default function MapView() {
  const { markers, mapillaryToken, showMapillaryCoverage, addDetection, setActiveDetection } =
    useDetections()
  const [loadingMarker, setLoadingMarker] = useState(null)
  const [streetPreview, setStreetPreview] = useState(null)
  const [basemap, setBasemap] = useState('street')
  const [polygon, setPolygon] = useState(null)
  const [draftPoints, setDraftPoints] = useState([])
  const [drawMode, setDrawMode] = useState(false)
  const [batchJob, setBatchJob] = useState(null)
  const [predicting, setPredicting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const pollRef = useRef(null)
  const warnedRef = useRef(false)
  const activeBase = BASE_LAYERS[basemap]

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const pollJob = useCallback(
    (jobId) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await getBatchJob(jobId)
          setBatchJob(data)
          if (data.total > 200 && !warnedRef.current) {
            warnedRef.current = true
            toast('Large batch — this may take a long time. You can cancel anytime.', {
              icon: '⏳',
              duration: 5000,
            })
          }
          if (TERMINAL.has(data.status)) {
            stopPolling()
            setPredicting(false)
            setCancelling(false)
            if (data.status === 'completed') {
              toast.success(`Batch complete — ${data.processed} images processed`, { icon: '✅' })
            } else if (data.status === 'cancelled') {
              toast(`Batch cancelled — ${data.processed} images saved`, { icon: '⏹️' })
            } else if (data.status === 'failed') {
              toast.error(data.error_message || 'Batch failed')
            }
          }
        } catch (_) {
          stopPolling()
          setPredicting(false)
        }
      }, 1500)
    },
    [stopPolling]
  )

  useEffect(() => () => stopPolling(), [stopPolling])

  const runStreetDetect = useCallback(
    async (lat, lng, imageId = null) => {
      setLoadingMarker({ lat, lng })
      try {
        const { data } = await detectStreet(lat, lng, imageId)
        if (data.error === 'mapillary_error') {
          toast.error(data.message || 'Mapillary API error. Check your access token.')
          setStreetPreview(null)
        } else if (data.error) {
          toast.error(
            data.message ||
              (showMapillaryCoverage
                ? 'No imagery here. Click on or near green coverage.'
                : 'No street imagery near this location.')
          )
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
    [addDetection, showMapillaryCoverage]
  )

  const closePolygon = useCallback((ring) => {
    if (ring.length < 3) {
      toast.error('Need at least 3 points for a polygon')
      return
    }
    setPolygon(ring)
    setDraftPoints([])
    setDrawMode(false)
    toast.success('Polygon closed — click Predict to run batch detection')
  }, [])

  const handleFinishPolygon = () => {
    closePolygon(draftPoints)
  }

  const handleAddDraftPoint = (pt) => {
    setDraftPoints((prev) => [...prev, pt])
  }

  const handleUndoDraft = () => {
    setDraftPoints((prev) => prev.slice(0, -1))
  }

  const handleDrawModeToggle = (on) => {
    setDrawMode(on)
    if (!on) setDraftPoints([])
  }

  const handleClearPolygon = () => {
    setPolygon(null)
    setDraftPoints([])
    setDrawMode(false)
  }

  const handlePredict = async () => {
    if (!polygon || polygon.length < 3) return
    setPredicting(true)
    setCancelling(false)
    warnedRef.current = false
    try {
      const { data } = await startBatchPolygon(polygon)
      setBatchJob({ ...data, processed: 0, total: 0, status: 'queued' })
      pollJob(data.job_id)
    } catch (_) {
      toast.error('Failed to start batch. Is the backend running?')
      setPredicting(false)
    }
  }

  const handleCancel = async () => {
    if (!batchJob?.job_id) return
    setCancelling(true)
    try {
      await cancelBatchJob(batchJob.job_id)
    } catch (_) {
      toast.error('Cancel request failed')
      setCancelling(false)
    }
  }

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
        {showMapillaryCoverage && mapillaryToken && (
          <MapillaryLayer token={mapillaryToken} basemap={basemap} />
        )}
        <PolygonDrawControl
          polygon={polygon}
          draftPoints={draftPoints}
          drawMode={drawMode}
          onAddPoint={handleAddDraftPoint}
          onClosePolygon={handleFinishPolygon}
        />
        <ClickHandler onMapClick={runStreetDetect} enabled={!drawMode && !predicting} />

        {loadingMarker && <Marker position={[loadingMarker.lat, loadingMarker.lng]} icon={loadingIcon} />}

        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.lat, m.lng]}
            icon={m.source === 'camera' || m.source === 'upload' ? CAMERA_ICON : STREET_ICON}
            eventHandlers={{ click: () => setActiveDetection(m) }}
          >
            <Popup>
              <MarkerPopup data={m} />
            </Popup>
          </Marker>
        ))}
      </MapContainer>

      <PolygonToolbar
        drawMode={drawMode}
        onDrawMode={handleDrawModeToggle}
        onClear={handleClearPolygon}
        onPredict={handlePredict}
        onFinish={handleFinishPolygon}
        onUndo={handleUndoDraft}
        hasPolygon={!!polygon && polygon.length >= 3}
        draftCount={draftPoints.length}
        predicting={predicting}
        activeJobId={batchJob?.job_id}
      />

      <BatchProgressOverlay job={batchJob} onCancel={handleCancel} cancelling={cancelling} />

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
            {streetPreview.capturedAt
              ? ` · ${new Date(streetPreview.capturedAt).toLocaleDateString('en-IN')}`
              : ''}
          </div>
        </div>
      )}
    </div>
  )
}
