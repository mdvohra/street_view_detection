import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Toaster } from 'react-hot-toast'
import {
  apiErrorMessage,
  detectGsvContinuedPanorama,
  getGsvContinuedMeta,
  getGsvContinuedNav,
  getGsvContinuedPoints,
  refineGsvSession,
} from '../api'
import GsvCoordSearch from '../components/GsvCoordSearch'
import GsvContinuedImagePanel from '../components/GsvContinuedImagePanel'
import GsvContinuedDetectionTable from '../components/GsvContinuedDetectionTable'
import GsvStreetViewViewer from '../components/GsvStreetViewViewer'
import GsvContinued3DMap from '../components/GsvContinued3DMap'
import DatasetMap from '../components/DatasetMap'
import MapModeToggle from '../components/MapModeToggle'
import {
  appendLocationResult,
  applySessionRefine,
  buildRefinePayload,
  createSession,
  finalizeSession,
  sessionHasGeoDetections,
  sessionLocationCount,
  sessionObjectCount,
  sessionVerifiedCount,
} from '../lib/gsvMapSession'
import '../dashboard.css'

export default function GsvContinuedPage() {
  const navigate = useNavigate()
  const [points, setPoints] = useState([])
  const [meta, setMeta] = useState(null)
  const [loadingMeta, setLoadingMeta] = useState(true)
  const [loadingPoints, setLoadingPoints] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [, setFromLocationId] = useState(null)
  const [selectedView, setSelectedView] = useState(4)
  const [navData, setNavData] = useState(null)
  const [trailIds, setTrailIds] = useState([])
  const [detectionResult, setDetectionResult] = useState(null)
  const [detecting, setDetecting] = useState(false)
  const [basemap, setBasemap] = useState('street')
  const [map3dEnabled, setMap3dEnabled] = useState(false)
  const [showMap, setShowMap] = useState(true)
  const [mapSessionActive, setMapSessionActive] = useState(false)
  const [mapSession, setMapSession] = useState(null)
  const [selectedSessionDetectionId, setSelectedSessionDetectionId] = useState(null)
  const [filterClass, setFilterClass] = useState(null)
  const mapSessionActiveRef = useRef(false)

  useEffect(() => {
    mapSessionActiveRef.current = mapSessionActive
  }, [mapSessionActive])

  useEffect(() => {
    let cancelled = false

    async function loadDataset() {
      setLoadingMeta(true)
      setLoadingPoints(true)
      setMeta(null)
      setPoints([])

      try {
        const metaRes = await getGsvContinuedMeta()
        if (cancelled) return
        setMeta(metaRes.data)
        setLoadingMeta(false)

        const pointsRes = await getGsvContinuedPoints()
        if (cancelled) return
        setPoints(pointsRes.data.points || [])
      } catch (err) {
        if (cancelled) return
        toast.error(apiErrorMessage(err, 'Failed to load GSV continued dataset'))
      } finally {
        if (!cancelled) {
          setLoadingMeta(false)
          setLoadingPoints(false)
        }
      }
    }

    loadDataset()
    return () => {
      cancelled = true
    }
  }, [])

  const loadNav = useCallback(async (id, fromId = null) => {
    try {
      const res = await getGsvContinuedNav(id, fromId)
      setNavData(res.data)
      return res.data
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Failed to load navigation'))
      return null
    }
  }, [])

  const enterLocation = useCallback(
    async (id, fromId = null, resetTrail = false) => {
      setSelectedId(id)
      setFromLocationId(fromId)
      const nav = await loadNav(id, fromId)
      if (nav) {
        setSelectedView(nav.suggested_view ?? 4)
      } else {
        setSelectedView(4)
      }
      if (resetTrail) {
        setTrailIds([id])
      }
    },
    [loadNav]
  )

  const handleSelectPoint = useCallback(
    (id) => {
      enterLocation(id, null, true)
    },
    [enterLocation]
  )

  const handleNavigate = useCallback(
    async (direction) => {
      const targetId = navData?.nav?.[direction]
      if (!targetId || selectedId == null) return
      setTrailIds((prev) => [...prev, targetId])
      await enterLocation(targetId, selectedId, false)
    },
    [navData, selectedId, enterLocation]
  )

  const selectedPoint = useMemo(
    () => points.find((p) => p.id === selectedId) || null,
    [points, selectedId]
  )

  const handleViewChange = useCallback((view) => {
    setSelectedView(view)
  }, [])

  const resolvedView = useMemo(() => {
    if (selectedId == null) return null
    const views = navData?.views || selectedPoint?.views || [0, 1, 2, 3, 4, 5]
    if (views.includes(selectedView)) return selectedView
    const fallback = navData?.suggested_view ?? 4
    if (views.includes(fallback)) return fallback
    const side = views.find((v) => v >= 1 && v <= 4)
    return side ?? views[0]
  }, [selectedId, selectedView, navData, selectedPoint])

  useEffect(() => {
    if (selectedId == null) return

    const controller = new AbortController()
    let cancelled = false

    async function runPanoramaDetection() {
      setDetecting(true)
      setDetectionResult(null)
      try {
        const res = await detectGsvContinuedPanorama(selectedId, {
          signal: controller.signal,
        })
        if (!cancelled) {
          setDetectionResult(res.data)
          if (mapSessionActiveRef.current) {
            setMapSession((prev) => (prev ? appendLocationResult(prev, res.data) : prev))
          }
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted || err?.code === 'ERR_CANCELED') {
          return
        }
        toast.error(apiErrorMessage(err, 'Panorama detection failed'))
      } finally {
        if (!cancelled) {
          setDetecting(false)
        }
      }
    }

    runPanoramaDetection()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [selectedId])

  useEffect(() => {
    setFilterClass(null)
  }, [selectedId])

  const sessionDetectionMarkers = useMemo(() => {
    const list = mapSession?.detections || []
    if (!filterClass) return list
    return list.filter((d) => d.class === filterClass)
  }, [mapSession, filterClass])

  const handleFilterClassChange = useCallback((cls) => {
    setFilterClass(cls)
  }, [])

  const handleStartMapSession = useCallback(() => {
    let session = createSession()
    if (detectionResult && selectedId != null) {
      session = appendLocationResult(session, detectionResult)
    }
    setMapSession(session)
    setMapSessionActive(true)
    setSelectedSessionDetectionId(null)
    toast.success('Map detection started — navigate and visit locations')
  }, [detectionResult, selectedId])

  const handleCancelMapSession = useCallback(() => {
    setMapSessionActive(false)
    setMapSession(null)
    setSelectedSessionDetectionId(null)
    toast('Map detection session cancelled')
  }, [])

  const handleEndMapSession = useCallback(async () => {
    if (!mapSession) return
    if (!sessionHasGeoDetections(mapSession)) {
      toast.error('No detections with map coordinates yet — visit locations with side-view detections')
      return
    }
    let sessionToSave = mapSession
    if ((mapSession.locations?.length ?? 0) > 1) {
      try {
        const payload = buildRefinePayload(mapSession)
        const res = await refineGsvSession(payload)
        sessionToSave = applySessionRefine(mapSession, res.data)
      } catch (err) {
        toast.error(apiErrorMessage(err, 'Session refine failed — saving per-location estimates'))
      }
    }
    const finalized = finalizeSession(sessionToSave)
    setMapSessionActive(false)
    setMapSession(null)
    navigate(`/gsv-continued/map-results/${finalized.sessionId}`)
  }, [mapSession, navigate])

  const trailPoints = useMemo(
    () =>
      trailIds
        .map((id) => points.find((p) => p.id === id))
        .filter(Boolean),
    [trailIds, points]
  )

  const partsLabel = meta?.parts?.length ? meta.parts.join(', ') : '—'
  const subtitle = loadingMeta
    ? 'Loading dataset…'
    : meta
      ? loadingPoints
        ? `${meta.count.toLocaleString()} locations · loading map…`
        : `${meta.count.toLocaleString()} of ${meta.total_locations_in_mat.toLocaleString()} locations · ${partsLabel} · ↑ forward along road`
      : 'Dataset unavailable — run build_gsv_continued_index.py'

  return (
    <div className="dashboard-root">
      <header className="dashboard-header">
        <Link to="/" className="dashboard-back">
          ← Map
        </Link>
        <div className="dashboard-title-block">
          <h1 className="dashboard-title">GSV continued</h1>
          <p className="dashboard-subtitle">{subtitle}</p>
        </div>
        <GsvCoordSearch
          points={points}
          onSelectLocation={(id) => handleSelectPoint(id)}
          disabled={loadingPoints || !points.length}
        />
        <div className="gsv-session-controls">
          {mapSessionActive ? (
            <>
              <span className="gsv-session-active">
                Recording · {sessionLocationCount(mapSession)} loc · {sessionVerifiedCount(mapSession) || sessionObjectCount(mapSession)} verified
              </span>
              <button
                type="button"
                className="dashboard-btn dashboard-btn-primary"
                onClick={handleEndMapSession}
                disabled={!sessionHasGeoDetections(mapSession)}
              >
                End map detection
              </button>
              <button
                type="button"
                className="dashboard-btn dashboard-btn-ghost"
                onClick={handleCancelMapSession}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="dashboard-btn dashboard-btn-primary"
              onClick={handleStartMapSession}
            >
              Start map detection
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowMap((v) => !v)}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'var(--surface2)',
            color: 'var(--text)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {showMap ? 'Hide map' : 'Show map'}
        </button>
      </header>

      <div className="dashboard-body" style={{ gap: 0, flex: 1, minHeight: 0 }}>
        {showMap && (
          <section
            className="dashboard-panel dashboard-panel-map"
            style={{
              flex: '0 0 30%',
              minWidth: 280,
              borderRadius: 0,
              borderTop: 'none',
              borderBottom: 'none',
              borderLeft: 'none',
            }}
          >
            {loadingMeta ? (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--muted)',
                }}
              >
                Loading map…
              </div>
            ) : (
              <div className="gsv-map-shell">
                {map3dEnabled ? (
                  <GsvContinued3DMap
                    points={points}
                    selectedId={selectedId}
                    onSelectPoint={handleSelectPoint}
                    basemap={basemap}
                    onBasemapToggle={() => setBasemap((b) => (b === 'street' ? 'satellite' : 'street'))}
                    trailPoints={trailPoints}
                    compact
                    selectedPinColor="#EF4444"
                    selectedPinSize={18}
                    detectionMarkers={mapSessionActive ? sessionDetectionMarkers : []}
                    selectedDetectionId={selectedSessionDetectionId}
                    onSelectDetection={setSelectedSessionDetectionId}
                    showSessionLegend={mapSessionActive && sessionDetectionMarkers.length > 0}
                  />
                ) : (
                  <DatasetMap
                    points={points}
                    selectedId={selectedId}
                    onSelectPoint={handleSelectPoint}
                    basemap={basemap}
                    onBasemapToggle={() => setBasemap((b) => (b === 'street' ? 'satellite' : 'street'))}
                    trailPoints={trailPoints}
                    compact
                    selectedPinColor="#EF4444"
                    selectedPinSize={18}
                    detectionMarkers={mapSessionActive ? sessionDetectionMarkers : []}
                    selectedDetectionId={selectedSessionDetectionId}
                    onSelectDetection={setSelectedSessionDetectionId}
                    showSessionLegend={mapSessionActive && sessionDetectionMarkers.length > 0}
                  />
                )}
                <MapModeToggle
                  map3dEnabled={map3dEnabled}
                  onToggle={() => setMap3dEnabled((v) => !v)}
                />
              </div>
            )}
          </section>
        )}

        <section
          className="dashboard-panel"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: 0,
            borderTop: 'none',
            borderBottom: 'none',
            borderRight: 'none',
            minWidth: 0,
            minHeight: 0,
          }}
        >
          {selectedId != null && selectedPoint ? (
            <>
              <GsvStreetViewViewer
                locationId={selectedId}
                view={resolvedView ?? selectedView}
                activeView={resolvedView ?? selectedView}
                nav={navData}
                detectionResult={detectionResult}
                detecting={detecting}
                filterClass={filterClass}
                onNavigate={handleNavigate}
                onForwardClickZone={() => handleNavigate('forward')}
              />
              <div
                style={{
                  flex: '0 0 auto',
                  maxHeight: '45%',
                  minHeight: 160,
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                }}
              >
                <GsvContinuedImagePanel
                  selectedId={selectedId}
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
                  filterClass={filterClass}
                  onFilterClassChange={handleFilterClassChange}
                />
              </div>
            </>
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
              <div style={{ fontSize: 48 }}>🛣️</div>
              <p style={{ textAlign: 'center', fontSize: 14, lineHeight: 1.6, maxWidth: 360 }}>
                Select a blue dot on the map to enter street view. Use the forward arrow or click the road ahead to
                move along the route.
              </p>
            </div>
          )}
        </section>
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
