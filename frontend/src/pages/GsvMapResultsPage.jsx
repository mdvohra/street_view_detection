import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Toaster } from 'react-hot-toast'
import {
  apiErrorMessage,
  detectGsvContinuedPanorama,
  getGsvContinuedNav,
} from '../api'
import GsvContinuedDetectionTable from '../components/GsvContinuedDetectionTable'
import GsvContinuedImagePanel from '../components/GsvContinuedImagePanel'
import GsvMapResults3DMap from '../components/GsvMapResults3DMap'
import GsvMapResultsMap from '../components/GsvMapResultsMap'
import MapModeToggle from '../components/MapModeToggle'
import GsvStreetViewViewer from '../components/GsvStreetViewViewer'
import { CLASS_META } from '../constants/classes'
import {
  collectSessionImagery,
  downloadGsvMapExportHtml,
} from '../lib/gsvMapExportHtml'
import { loadSession, sessionSummaryCounts, filterMapMarkers } from '../lib/gsvMapSession'
import '../dashboard.css'

export default function GsvMapResultsPage() {
  const { sessionId } = useParams()
  const navigate = useNavigate()
  const [session, setSession] = useState(null)
  const [filterClass, setFilterClass] = useState(null)
  const [basemap, setBasemap] = useState('street')
  const [map3dEnabled, setMap3dEnabled] = useState(false)
  const [showRays, setShowRays] = useState(false)
  const [selectedLocationId, setSelectedLocationId] = useState(null)
  const [selectedDetectionId, setSelectedDetectionId] = useState(null)
  const [selectedView, setSelectedView] = useState(4)
  const [navData, setNavData] = useState(null)
  const [detectionResult, setDetectionResult] = useState(null)
  const [detecting, setDetecting] = useState(false)
  const [detectionCache, setDetectionCache] = useState({})
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(null)
  const [showRawDetections, setShowRawDetections] = useState(false)
  const [showVerifiedOnly, setShowVerifiedOnly] = useState(true)

  useEffect(() => {
    const data = loadSession(sessionId)
    if (!data) {
      toast.error('Session not found — start a new map detection on GSV continued')
      navigate('/gsv-continued', { replace: true })
      return
    }
    if (!data.detections?.length) {
      toast.error('Session has no map coordinates — only side views 1–4 produce geo estimates')
      navigate('/gsv-continued', { replace: true })
      return
    }
    setSession(data)
  }, [sessionId, navigate])

  const summary = useMemo(() => sessionSummaryCounts(session || {}), [session])
  const agg = session?.official_counts || session?.aggregate_counts || {}

  const mapDetections = useMemo(() => {
    if (showRawDetections && session?.raw_detections?.length) {
      return filterMapMarkers(session.raw_detections, { verifiedOnly: false })
    }
    const list = session?.detections || []
    return filterMapMarkers(list, { verifiedOnly: showVerifiedOnly })
  }, [session, showRawDetections, showVerifiedOnly])

  const hiddenEstimatedCount = useMemo(() => {
    if (showRawDetections || !showVerifiedOnly) return 0
    const all = filterMapMarkers(session?.detections || [], { verifiedOnly: false })
    return Math.max(0, all.length - mapDetections.length)
  }, [session, showRawDetections, showVerifiedOnly, mapDetections.length])

  const filteredDetections = useMemo(() => {
    const list = mapDetections
    if (!filterClass) return list
    return list.filter((d) => d.class === filterClass)
  }, [mapDetections, filterClass])

  const cameraMarkers = useMemo(() => {
    return (session?.locations || []).map((loc) => ({
      id: loc.id,
      lat: loc.lat,
      lng: loc.lng,
    }))
  }, [session])

  const trailPoints = useMemo(() => {
    const sorted = [...(session?.locations || [])].sort((a, b) => a.order - b.order)
    return sorted.map((l) => ({ id: l.id, lat: l.lat, lng: l.lng }))
  }, [session])

  const selectedPoint = useMemo(() => {
    const loc = (session?.locations || []).find((l) => l.id === selectedLocationId)
    if (!loc) return null
    return { id: loc.id, lat: loc.lat, lng: loc.lng, views: [0, 1, 2, 3, 4, 5] }
  }, [session, selectedLocationId])

  const loadLocationImagery = useCallback(
    async (locationId, view, detectionId) => {
      setSelectedLocationId(locationId)
      setSelectedDetectionId(detectionId)
      setSelectedView(view ?? 4)

      const cached = detectionCache[locationId]
      if (cached) {
        setDetectionResult(cached)
        setNavData(cached._nav || null)
        return
      }

      setDetecting(true)
      setDetectionResult(null)
      try {
        const [navRes, detectRes] = await Promise.all([
          getGsvContinuedNav(locationId),
          detectGsvContinuedPanorama(locationId),
        ])
        const nav = navRes.data
        const result = { ...detectRes.data, _nav: nav }
        setNavData(nav)
        setDetectionResult(detectRes.data)
        setDetectionCache((prev) => ({ ...prev, [locationId]: result }))
        if (view != null) {
          setSelectedView(view)
        } else if (nav?.suggested_view != null) {
          setSelectedView(nav.suggested_view)
        }
      } catch (err) {
        toast.error(apiErrorMessage(err, 'Failed to load location imagery'))
      } finally {
        setDetecting(false)
      }
    },
    [detectionCache]
  )

  const handleSelectDetection = useCallback(
    (detectionId) => {
      const det = (session?.detections || []).find((d) => d.detection_id === detectionId)
      if (!det) return
      loadLocationImagery(det.location_id, det.view, detectionId)
    },
    [session, loadLocationImagery]
  )

  const handleSelectCamera = useCallback(
    (locationId) => {
      const pool = filterClass
        ? (session?.detections || []).filter((d) => d.class === filterClass)
        : session?.detections || []
      const firstDet = pool.find((d) => d.location_id === locationId)
      if (firstDet) {
        handleSelectDetection(firstDet.detection_id)
      } else {
        loadLocationImagery(locationId, null, null)
      }
    },
    [session, filterClass, handleSelectDetection, loadLocationImagery]
  )

  const handleFilterClassChange = useCallback((cls) => {
    setFilterClass(cls)
  }, [])

  useEffect(() => {
    if (!selectedDetectionId) return
    const det = (session?.detections || []).find((d) => d.detection_id === selectedDetectionId)
    if (!det) return
    if (filterClass && det.class !== filterClass) {
      setSelectedDetectionId(null)
    }
  }, [filterClass, selectedDetectionId, session])

  const handleViewChange = useCallback((view) => {
    setSelectedView(view)
  }, [])

  const resolvedView = useMemo(() => {
    if (selectedLocationId == null) return null
    const views = navData?.views || [0, 1, 2, 3, 4, 5]
    if (views.includes(selectedView)) return selectedView
    const fallback = navData?.suggested_view ?? 4
    if (views.includes(fallback)) return fallback
    const side = views.find((v) => v >= 1 && v <= 4)
    return side ?? views[0]
  }, [selectedLocationId, selectedView, navData])

  const durationLabel = useMemo(() => {
    if (!session?.startedAt) return '—'
    const end = session.endedAt ? new Date(session.endedAt) : new Date()
    const start = new Date(session.startedAt)
    const mins = Math.round((end - start) / 60000)
    if (mins < 1) return '< 1 min'
    return `${mins} min`
  }, [session])

  const handleExportHtml = useCallback(async () => {
    if (!session || exporting) return

    if (session.locations.length > 8) {
      const proceed = window.confirm(
        `This session has ${session.locations.length} locations. The exported HTML may be large (roughly 0.5–2 MB per location). Continue?`
      )
      if (!proceed) return
    }

    setExporting(true)
    setExportProgress(null)
    try {
      const imagery = await collectSessionImagery(session, detectionCache, setExportProgress)
      downloadGsvMapExportHtml(session, imagery)
      toast.success('HTML exported — share the downloaded file')
    } catch (err) {
      const locationHint = err.locationId != null ? ` (location ${err.locationId})` : ''
      toast.error(apiErrorMessage(err, `Export failed${locationHint}`))
    } finally {
      setExporting(false)
      setExportProgress(null)
    }
  }, [session, exporting, detectionCache])

  if (!session) {
    return (
      <div className="dashboard-root">
        <div className="dashboard-empty-state">
          <p style={{ color: 'var(--muted)' }}>Loading session…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-root">
      <header className="dashboard-header">
        <Link to="/gsv-continued" className="dashboard-back">
          ← GSV continued
        </Link>
        <div className="dashboard-title-block">
          <h1 className="dashboard-title">Map detection results</h1>
          <p className="dashboard-subtitle">
            {session.locations.length} locations · {summary.totalVerified || summary.totalOfficial} verified
            {summary.estimated > 0 ? ` · ${summary.estimated} estimated` : ''} · {durationLabel}
          </p>
        </div>
        <div className="dashboard-kpis">
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">Locations</div>
            <div className="dashboard-kpi-value accent">{session.locations.length}</div>
          </div>
          <div className="dashboard-kpi">
            <div className="dashboard-kpi-label">On map</div>
            <div className="dashboard-kpi-value accent">{filteredDetections.length}</div>
          </div>
        </div>
        <button
          type="button"
          className="gsv-export-html-btn"
          onClick={handleExportHtml}
          disabled={exporting}
          title="Download a self-contained HTML file with map and embedded panorama imagery"
        >
          {exporting && exportProgress
            ? `Exporting ${exportProgress.done}/${exportProgress.total}…`
            : exporting
              ? 'Exporting…'
              : 'Export HTML'}
        </button>
      </header>

      <div className="dashboard-filters">
        <button
          type="button"
          className={`dashboard-chip${!filterClass ? ' active' : ''}`}
          onClick={() => setFilterClass(null)}
        >
          All
        </button>
        {CLASS_META.map(({ key, emoji, label }) =>
          (agg[key] || 0) > 0 ? (
            <button
              key={key}
              type="button"
              className={`dashboard-chip${filterClass === key ? ' active' : ''}`}
              onClick={() => setFilterClass(key)}
            >
              {emoji} {label} ({agg[key]})
            </button>
          ) : null
        )}
      </div>

      <div className="dashboard-content">
        <div className="dashboard-body">
          <section className="dashboard-panel dashboard-panel-map">
            <div className="dashboard-panel-label">Detection map</div>
            {showVerifiedOnly && hiddenEstimatedCount > 0 && !showRawDetections && (
              <div
                style={{
                  padding: '6px 12px',
                  fontSize: 11,
                  color: '#94a3b8',
                  borderBottom: '1px solid var(--border)',
                  background: 'rgba(148, 163, 184, 0.08)',
                }}
              >
                {hiddenEstimatedCount} estimated static pin{hiddenEstimatedCount === 1 ? '' : 's'} hidden — toggle Verified only to show
              </div>
            )}
            {showRawDetections && (
              <div
                style={{
                  padding: '6px 12px',
                  fontSize: 11,
                  color: '#f59e0b',
                  borderBottom: '1px solid var(--border)',
                  background: 'rgba(245, 158, 11, 0.1)',
                }}
              >
                Debug mode: showing raw per-view pins (inflated counts). Switch to Official pins for government map.
              </div>
            )}
            <div className="gsv-map-shell">
              {map3dEnabled ? (
                <GsvMapResults3DMap
                  cameraMarkers={cameraMarkers}
                  detectionMarkers={filteredDetections}
                  trailPoints={trailPoints}
                  selectedLocationId={selectedLocationId}
                  selectedDetectionId={selectedDetectionId}
                  onSelectCamera={handleSelectCamera}
                  onSelectDetection={handleSelectDetection}
                  basemap={basemap}
                  onBasemapToggle={() => setBasemap((b) => (b === 'street' ? 'satellite' : 'street'))}
                  showRays={showRays}
                  onToggleRays={() => setShowRays((v) => !v)}
                  showRawDetections={showRawDetections}
                  onToggleRawDetections={
                    session?.raw_detections?.length
                      ? () => setShowRawDetections((v) => !v)
                      : undefined
                  }
                  showVerifiedOnly={showVerifiedOnly}
                  onToggleVerifiedOnly={() => setShowVerifiedOnly((v) => !v)}
                />
              ) : (
                <GsvMapResultsMap
                  cameraMarkers={cameraMarkers}
                  detectionMarkers={filteredDetections}
                  trailPoints={trailPoints}
                  selectedLocationId={selectedLocationId}
                  selectedDetectionId={selectedDetectionId}
                  onSelectCamera={handleSelectCamera}
                  onSelectDetection={handleSelectDetection}
                  basemap={basemap}
                  onBasemapToggle={() => setBasemap((b) => (b === 'street' ? 'satellite' : 'street'))}
                  showRays={showRays}
                  onToggleRays={() => setShowRays((v) => !v)}
                  showRawDetections={showRawDetections}
                  onToggleRawDetections={
                    session?.raw_detections?.length
                      ? () => setShowRawDetections((v) => !v)
                      : undefined
                  }
                  showVerifiedOnly={showVerifiedOnly}
                  onToggleVerifiedOnly={() => setShowVerifiedOnly((v) => !v)}
                />
              )}
              <MapModeToggle
                map3dEnabled={map3dEnabled}
                onToggle={() => setMap3dEnabled((v) => !v)}
              />
            </div>
          </section>

          <section className="dashboard-panel dashboard-panel-viewer">
            <div className="dashboard-panel-label">Street view</div>
            {selectedLocationId != null && selectedPoint ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <GsvStreetViewViewer
                  locationId={selectedLocationId}
                  view={resolvedView ?? selectedView}
                  activeView={resolvedView ?? selectedView}
                  nav={navData}
                  detectionResult={detectionResult}
                  detecting={detecting}
                  filterClass={filterClass}
                  onNavigate={() => {}}
                  onForwardClickZone={() => {}}
                />
                <div
                  style={{
                    flex: '0 0 auto',
                    maxHeight: '40%',
                    minHeight: 140,
                    borderTop: '1px solid var(--border)',
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                  }}
                >
                  <GsvContinuedImagePanel
                    selectedId={selectedLocationId}
                    point={selectedPoint}
                    nav={navData}
                    selectedView={selectedView}
                    onViewChange={handleViewChange}
                    detectionResult={detectionResult}
                    detecting={detecting}
                    filterClass={filterClass}
                  />
                  <GsvContinuedDetectionTable
                    detectionResult={detectionResult}
                    detecting={detecting}
                    cameraLat={selectedPoint.lat}
                    cameraLng={selectedPoint.lng}
                    highlightDetectionId={selectedDetectionId}
                    locationId={selectedLocationId}
                    filterClass={filterClass}
                    onFilterClassChange={handleFilterClassChange}
                  />
                </div>
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--muted)',
                  gap: 12,
                  padding: 24,
                }}
              >
                <div style={{ fontSize: 48 }}>🗺️</div>
                <p style={{ textAlign: 'center', fontSize: 14, lineHeight: 1.6, maxWidth: 320 }}>
                  Click any colored dot on the map to open that location&apos;s annotated imagery.
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      <Toaster
        position="bottom-left"
        toastOptions={{
          style: {
            background: 'var(--surface2)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
          },
        }}
      />
    </div>
  )
}
