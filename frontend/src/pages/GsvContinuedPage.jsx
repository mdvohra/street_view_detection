import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Toaster } from 'react-hot-toast'
import {
  apiErrorMessage,
  detectGsvContinuedLocation,
  getGsvContinuedMeta,
  getGsvContinuedNav,
  getGsvContinuedPoints,
} from '../api'
import GsvContinuedImagePanel from '../components/GsvContinuedImagePanel'
import GsvStreetViewViewer from '../components/GsvStreetViewViewer'
import DatasetMap from '../components/DatasetMap'
import '../dashboard.css'

export default function GsvContinuedPage() {
  const [points, setPoints] = useState([])
  const [meta, setMeta] = useState(null)
  const [loadingMeta, setLoadingMeta] = useState(true)
  const [loadingPoints, setLoadingPoints] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [, setFromLocationId] = useState(null)
  const [selectedView, setSelectedView] = useState(0)
  const [navData, setNavData] = useState(null)
  const [trailIds, setTrailIds] = useState([])
  const [detectionResult, setDetectionResult] = useState(null)
  const [detecting, setDetecting] = useState(false)
  const [basemap, setBasemap] = useState('street')
  const [showMap, setShowMap] = useState(true)

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
      setDetectionResult(null)
      const nav = await loadNav(id, fromId)
      if (nav) {
        setSelectedView(nav.suggested_view ?? 0)
      } else {
        setSelectedView(0)
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
    setDetectionResult(null)
  }, [])

  const handleRunDetection = useCallback(async () => {
    if (selectedId == null) return
    const views = navData?.views || selectedPoint?.views || [0]
    const view = views.includes(selectedView) ? selectedView : views[0]
    setDetecting(true)
    try {
      const res = await detectGsvContinuedLocation(selectedId, view)
      setDetectionResult(res.data)
      toast.success('Detection complete')
    } catch (err) {
      toast.error(apiErrorMessage(err, 'Detection failed'))
    } finally {
      setDetecting(false)
    }
  }, [selectedId, selectedView, navData, selectedPoint])

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
        <button
          type="button"
          onClick={() => setShowMap((v) => !v)}
          style={{
            marginLeft: 'auto',
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
              />
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
                view={selectedView}
                nav={navData}
                compass={navData?.compass ?? selectedPoint.compass}
                detectionResult={detectionResult}
                onNavigate={handleNavigate}
                onForwardClickZone={() => handleNavigate('forward')}
              />
              <div style={{ flex: '0 0 auto', maxHeight: '38%', minHeight: 120, borderTop: '1px solid var(--border)' }}>
                <GsvContinuedImagePanel
                  selectedId={selectedId}
                  point={selectedPoint}
                  nav={navData}
                  selectedView={selectedView}
                  onViewChange={handleViewChange}
                  detectionResult={detectionResult}
                  detecting={detecting}
                  onRunDetection={handleRunDetection}
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
