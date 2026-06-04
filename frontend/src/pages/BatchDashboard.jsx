import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  annotatedImageUrl,
  cancelBatchJob,
  deleteAllBatches,
  getBatchDetectionsGeo,
  getBatchGeo,
  getBatchJob,
  getBatchObjectsGeo,
  getBatchResults,
  getConfig,
  listBatchJobs,
} from '../api'
import BatchDashboardMap from '../components/BatchDashboardMap'
import BatchResultsTable from '../components/BatchResultsTable'
import ImageThumbGrid from '../components/ImageThumbGrid'
import { CLASS_COLORS, CLASS_EMOJIS, CLASS_META } from '../constants/classes'
import '../dashboard.css'

const PAGE_SIZE = 30
const ACTIVE = new Set(['queued', 'discovering', 'running', 'cancelling'])

function geoAccuracyLabel(det) {
  if (det.geo_accuracy) return det.geo_accuracy
  const method = det.geo_method
  if (method === 'lob_triangulation') {
    const n = det.geo_confidence || 0
    return n >= 2 ? `High accuracy (${n} street views)` : 'Multi-view estimate'
  }
  return 'Estimated from photo'
}

function DetectionList({ detections, filterClass }) {
  const list = (detections || []).filter((d) => !filterClass || d.class === filterClass)
  if (list.length === 0) {
    return <div style={{ color: 'var(--muted)', fontSize: 13, padding: 8 }}>No detections for this filter</div>
  }
  return (
    <>
      {list.map((det, i) => {
        const color = CLASS_COLORS[det.class] || '#aaa'
        return (
          <div
            key={i}
            className="dashboard-detection-item"
            style={{ borderColor: `${color}33` }}
          >
            <span className="dashboard-detection-emoji">{CLASS_EMOJIS[det.class] || '📦'}</span>
            <div className="dashboard-detection-body">
              <div className="dashboard-detection-top">
                <span className="dashboard-detection-class">{det.class}</span>
                <span className="dashboard-detection-pct" style={{ color }}>
                  {(det.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="dashboard-detection-bar">
                <div
                  className="dashboard-detection-bar-fill"
                  style={{ width: `${det.confidence * 100}%`, background: color }}
                />
              </div>
              {det.geo_lat != null && (
                <div className="dashboard-detection-geo">
                  {Number(det.geo_lat).toFixed(6)}, {Number(det.geo_lng).toFixed(6)}
                  {det.geo_distance_m != null && ` · ~${Number(det.geo_distance_m).toFixed(0)} m away`}
                  <div className="dashboard-detection-accuracy">{geoAccuracyLabel(det)}</div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

function LocationMeta({ result }) {
  if (!result) return null
  const lat = result.lat
  const lng = result.lng
  const geoDet = (result.detections || []).find((d) => d.geo_lat != null)
  return (
    <div className="dashboard-location">
      <div className="dashboard-location-title">Location</div>
      <div className="dashboard-coords">
        <div className="dashboard-coord-card">
          <div className="dashboard-coord-label">Camera lat</div>
          <div className="dashboard-coord-value">{lat != null ? Number(lat).toFixed(6) : '—'}</div>
        </div>
        <div className="dashboard-coord-card">
          <div className="dashboard-coord-label">Camera lng</div>
          <div className="dashboard-coord-value">{lng != null ? Number(lng).toFixed(6) : '—'}</div>
        </div>
      </div>
      {geoDet && (
        <div className="dashboard-coords" style={{ marginTop: 8 }}>
          <div className="dashboard-coord-card">
            <div className="dashboard-coord-label">Object lat</div>
            <div className="dashboard-coord-value" style={{ color: '#f59e0b' }}>
              {Number(geoDet.geo_lat).toFixed(6)}
            </div>
          </div>
          <div className="dashboard-coord-card">
            <div className="dashboard-coord-label">Object lng</div>
            <div className="dashboard-coord-value" style={{ color: '#f59e0b' }}>
              {Number(geoDet.geo_lng).toFixed(6)}
            </div>
          </div>
          <div className="dashboard-detection-accuracy" style={{ marginTop: 6 }}>
            {geoAccuracyLabel(geoDet)}
          </div>
        </div>
      )}
      <div className="dashboard-meta-row">
        Image <span>{result.image_id}</span>
      </div>
      {result.captured_at && (
        <div className="dashboard-meta-row">
          Captured <span>{new Date(Number(result.captured_at)).toLocaleString()}</span>
        </div>
      )}
    </div>
  )
}

function statusBadge(status) {
  if (status === 'cancelled') return <span className="dashboard-badge cancelled">Cancelled</span>
  if (ACTIVE.has(status)) return <span className="dashboard-badge running">{status}</span>
  if (status === 'completed') return <span className="dashboard-badge running">Completed</span>
  return null
}

export default function BatchDashboard() {
  const { jobId: paramJobId } = useParams()
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [job, setJob] = useState(null)
  const [results, setResults] = useState([])
  const [geoMarkers, setGeoMarkers] = useState([])
  const [detectionMarkers, setDetectionMarkers] = useState([])
  const [objectMarkers, setObjectMarkers] = useState([])
  const [polygon, setPolygon] = useState(null)
  const [mapillaryToken, setMapillaryToken] = useState(null)
  const [showMapillaryCoverage, setShowMapillaryCoverage] = useState(true)
  const [basemap, setBasemap] = useState('street')
  const [showRays, setShowRays] = useState(false)
  const [selectedDetectionId, setSelectedDetectionId] = useState(null)
  const [index, setIndex] = useState(0)
  const [filterClass, setFilterClass] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const touchStartX = useRef(null)
  const pollRef = useRef(null)

  const jobId = paramJobId || job?.job_id || jobs[0]?.job_id

  useEffect(() => {
    getConfig()
      .then((r) => {
        setMapillaryToken(r.data.mapillary_token)
        setShowMapillaryCoverage(r.data.show_mapillary_coverage !== false)
      })
      .catch(() => {})
  }, [])

  const loadJobs = useCallback(async () => {
    try {
      const { data } = await listBatchJobs()
      setJobs(data.jobs || [])
      if (!paramJobId && data.jobs?.length) setJob(data.jobs[0])
    } catch (_) {
      toast.error('Failed to load batch jobs')
    }
  }, [paramJobId])

  const loadJob = useCallback(async (id) => {
    if (!id) return
    try {
      const { data } = await getBatchJob(id)
      setJob(data)
      setPolygon(data.polygon || null)
    } catch (_) {
      toast.error('Job not found')
    }
  }, [])

  const loadGeo = useCallback(async (id) => {
    if (!id) return
    try {
      const { data } = await getBatchGeo(id)
      setGeoMarkers(data.markers || [])
      if (data.polygon) setPolygon(data.polygon)
    } catch (_) {
      setGeoMarkers([])
    }
  }, [])

  const loadDetectionGeo = useCallback(async (id) => {
    if (!id) return
    try {
      const { data } = await getBatchDetectionsGeo(id)
      setDetectionMarkers(data.detections || [])
    } catch (_) {
      setDetectionMarkers([])
    }
  }, [])

  const loadObjectGeo = useCallback(async (id) => {
    if (!id) return
    try {
      const { data } = await getBatchObjectsGeo(id)
      setObjectMarkers(data.objects || [])
    } catch (_) {
      setObjectMarkers([])
    }
  }, [])

  const loadMapLayers = useCallback(
    async (id) => {
      await Promise.all([loadGeo(id), loadDetectionGeo(id), loadObjectGeo(id)])
    },
    [loadGeo, loadDetectionGeo, loadObjectGeo]
  )

  const loadResults = useCallback(async (id, append = false) => {
    if (!id) return
    const offset = append ? results.length : 0
    try {
      setLoadingMore(true)
      const { data } = await getBatchResults(id, offset, PAGE_SIZE)
      setResults((prev) => (append ? [...prev, ...data.results] : data.results))
      if (!append) setIndex(0)
    } catch (_) {
      toast.error('Failed to load results')
    } finally {
      setLoadingMore(false)
    }
  }, [results.length])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  useEffect(() => {
    if (paramJobId) loadJob(paramJobId)
  }, [paramJobId, loadJob])

  useEffect(() => {
    if (jobId) {
      loadResults(jobId, false)
      loadMapLayers(jobId)
    }
  }, [jobId, loadMapLayers])

  useEffect(() => {
    if (!jobId || !job || !ACTIVE.has(job.status)) {
      if (pollRef.current) clearInterval(pollRef.current)
      return undefined
    }
    pollRef.current = setInterval(async () => {
      const { data } = await getBatchJob(jobId)
      setJob(data)
      if (!ACTIVE.has(data.status)) {
        clearInterval(pollRef.current)
        loadResults(jobId, false)
        loadMapLayers(jobId)
        if (data.status === 'completed') {
          toast.success('Processing complete — object locations are shown on the map')
        }
      }
    }, 1500)
    return () => clearInterval(pollRef.current)
  }, [jobId, job?.status, loadResults, loadMapLayers])

  const filteredGeoMarkers = useMemo(() => {
    if (!filterClass) return geoMarkers
    return geoMarkers.filter((m) => (m.counts?.[filterClass] || 0) > 0)
  }, [geoMarkers, filterClass])

  const filteredResults = useMemo(() => {
    if (!filterClass) return results
    return results.filter((r) => (r.counts?.[filterClass] || 0) > 0)
  }, [results, filterClass])

  const filteredDetectionMarkers = useMemo(() => {
    if (!filterClass) return detectionMarkers
    return detectionMarkers.filter((d) => d.class === filterClass)
  }, [detectionMarkers, filterClass])

  const filteredObjectMarkers = useMemo(() => {
    if (!filterClass) return objectMarkers
    return objectMarkers.filter((o) => o.class === filterClass)
  }, [objectMarkers, filterClass])

  useEffect(() => {
    setIndex(0)
  }, [filterClass, jobId])

  const displayIndex = filteredResults.length ? Math.min(index, filteredResults.length - 1) : 0
  const current = filteredResults[displayIndex] || filteredResults[0]
  const selectedImageId = current?.image_id ?? null

  const goPrev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])
  const goNext = useCallback(
    () => setIndex((i) => Math.min(filteredResults.length - 1, i + 1)),
    [filteredResults.length]
  )

  const handleSelectFromMap = useCallback(
    (imageId) => {
      const idx = filteredResults.findIndex((r) => r.image_id === imageId)
      if (idx >= 0) setIndex(idx)
      setSelectedDetectionId(null)
    },
    [filteredResults]
  )

  const handleSelectDetection = useCallback(
    (imageId, detectionIndex) => {
      const idx = filteredResults.findIndex((r) => r.image_id === imageId)
      if (idx >= 0) setIndex(idx)
      setSelectedDetectionId(`${imageId}:${detectionIndex}`)
    },
    [filteredResults]
  )

  const selectedObject = useMemo(() => {
    if (!selectedDetectionId) return null
    return objectMarkers.find((o) =>
      (o.detection_refs || []).some(
        (r) => `${r.image_id}:${r.detection_index}` === selectedDetectionId
      )
    )
  }, [objectMarkers, selectedDetectionId])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goPrev, goNext])

  useEffect(() => {
    if (
      filteredResults.length > 0 &&
      index >= filteredResults.length - 3 &&
      results.length < (job?.results_count || job?.processed || 0) &&
      !loadingMore
    ) {
      loadResults(jobId, true)
    }
  }, [index, filteredResults.length, results.length, job, jobId, loadingMore, loadResults])

  const handleCancel = async () => {
    if (!jobId) return
    setCancelling(true)
    try {
      await cancelBatchJob(jobId)
      await loadJob(jobId)
    } catch (_) {
      toast.error('Cancel failed')
    } finally {
      setCancelling(false)
    }
  }

  const handleDeleteAll = async () => {
    try {
      await deleteAllBatches()
      setShowDeleteConfirm(false)
      setJobs([])
      setJob(null)
      setResults([])
      setGeoMarkers([])
      setDetectionMarkers([])
      setObjectMarkers([])
      toast.success('All batch data deleted')
      navigate('/dashboard')
    } catch (_) {
      toast.error('Delete failed')
    }
  }

  const agg = job?.aggregate_counts || {}
  const totalObjects = Object.values(agg).reduce((a, b) => a + b, 0)
  const progressPct = job?.total ? Math.round((job.processed / job.total) * 100) : 0

  if (!jobId && jobs.length === 0) {
    return (
      <div className="dashboard-root">
        <div className="dashboard-empty-state">
          <div className="dashboard-empty-icon">📊</div>
          <h2>No batch results yet</h2>
          <p>Draw a polygon on the map and run Predict to detect every street image in that area.</p>
          <Link to="/" className="dashboard-empty-cta">
            ← Go to map
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard-root">
      <header className="dashboard-header">
        <Link to="/" className="dashboard-back">
          ← Map
        </Link>
        <div className="dashboard-title-block">
          <h1 className="dashboard-title">
            <span className="brand">Batch</span> dashboard
            {job?.status && statusBadge(job.status)}
          </h1>
          <p className="dashboard-subtitle">
            {job ? `Job ${jobId?.slice(0, 8)}…` : 'Loading…'}
            {job && !ACTIVE.has(job.status) && ` · ${job.status}`}
          </p>
        </div>
        {job && (
          <div className="dashboard-kpis">
            <div className="dashboard-kpi">
              <div className="dashboard-kpi-label">Images</div>
              <div className="dashboard-kpi-value accent">
                {job.processed}/{job.total}
              </div>
            </div>
            <div className="dashboard-kpi">
              <div className="dashboard-kpi-label">Objects</div>
              <div className="dashboard-kpi-value accent">{totalObjects}</div>
            </div>
            {job.failed > 0 && (
              <div className="dashboard-kpi">
                <div className="dashboard-kpi-label">Failed</div>
                <div className="dashboard-kpi-value" style={{ color: '#ff8888' }}>
                  {job.failed}
                </div>
              </div>
            )}
          </div>
        )}
        {jobs.length > 1 && (
          <select
            className="dashboard-select"
            value={jobId || ''}
            onChange={(e) => navigate(`/dashboard/${e.target.value}`)}
          >
            {jobs.map((j) => (
              <option key={j.job_id} value={j.job_id}>
                {j.job_id.slice(0, 8)}… — {j.status} ({j.processed}/{j.total})
              </option>
            ))}
          </select>
        )}
        {job && ACTIVE.has(job.status) && (
          <button
            type="button"
            className="dashboard-btn dashboard-btn-danger"
            onClick={handleCancel}
            disabled={cancelling}
          >
            {cancelling ? 'Cancelling…' : 'Cancel job'}
          </button>
        )}
        <button
          type="button"
          className="dashboard-btn dashboard-btn-ghost"
          onClick={() => setShowDeleteConfirm(true)}
        >
          Delete all
        </button>
      </header>

      {ACTIVE.has(job?.status) && (
        <div className="dashboard-progress-bar">
          <span>Processing {job.processed} / {job.total}</span>
          <div className="dashboard-progress-track">
            <div className="dashboard-progress-fill" style={{ width: `${progressPct}%` }} />
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>{progressPct}%</span>
        </div>
      )}

      <div className="dashboard-filters">
        <button
          type="button"
          className={`dashboard-chip${!filterClass ? ' active' : ''}`}
          onClick={() => setFilterClass(null)}
        >
          All
        </button>
        {CLASS_META.map(({ key, emoji, label }) => (
          <button
            key={key}
            type="button"
            className={`dashboard-chip${filterClass === key ? ' active' : ''}`}
            onClick={() => setFilterClass(key)}
          >
            {emoji} {label} ({agg[key] || 0})
          </button>
        ))}
      </div>

      <div className="dashboard-content">
      <div className="dashboard-body">
        <section className="dashboard-panel dashboard-panel-map">
          <div className="dashboard-panel-label">Coverage map</div>
          {jobId && (
            <BatchDashboardMap
              key={jobId}
              cameraMarkers={filteredGeoMarkers}
              detectionMarkers={filteredDetectionMarkers}
              objectMarkers={filteredObjectMarkers}
              polygon={polygon}
              selectedImageId={selectedImageId}
              selectedDetectionId={selectedDetectionId}
              onSelectCamera={handleSelectFromMap}
              onSelectDetection={handleSelectDetection}
              mapillaryToken={mapillaryToken}
              showMapillaryCoverage={showMapillaryCoverage}
              basemap={basemap}
              onBasemapToggle={() => setBasemap((b) => (b === 'street' ? 'satellite' : 'street'))}
              showRays={showRays}
              onToggleRays={() => setShowRays((v) => !v)}
            />
          )}
        </section>

        <section className="dashboard-panel dashboard-panel-viewer">
          <div className="dashboard-panel-label">Detection preview</div>
          <div
            className="dashboard-viewer"
            onTouchStart={(e) => {
              touchStartX.current = e.touches[0].clientX
            }}
            onTouchEnd={(e) => {
              if (touchStartX.current == null) return
              const dx = e.changedTouches[0].clientX - touchStartX.current
              if (dx > 50) goPrev()
              if (dx < -50) goNext()
              touchStartX.current = null
            }}
          >
            {current?.image_id && jobId ? (
              <img src={annotatedImageUrl(jobId, current.image_id)} alt="Detection result" />
            ) : (
              <div className="dashboard-viewer-empty">
                {filterClass
                  ? 'No images with this class in loaded results'
                  : 'Click a row in the table, a map pin, or a thumbnail to preview detections'}
              </div>
            )}
            <button type="button" className="dashboard-nav-btn left" onClick={goPrev} aria-label="Previous">
              ‹
            </button>
            <button type="button" className="dashboard-nav-btn right" onClick={goNext} aria-label="Next">
              ›
            </button>
            <div className="dashboard-counter">
              {filteredResults.length ? displayIndex + 1 : 0} / {filteredResults.length}
            </div>
          </div>
          <ImageThumbGrid
            jobId={jobId}
            results={filteredResults}
            selectedIndex={displayIndex}
            onSelect={setIndex}
          />
        </section>

        <section className="dashboard-panel dashboard-panel-details">
          <div className="dashboard-panel-label">Details</div>
          <LocationMeta result={current} />
          {selectedObject && (
            <div className="dashboard-object-support">
              Best location for {selectedObject.class} — confirmed from{' '}
              {selectedObject.support_count} street photo
              {selectedObject.support_count === 1 ? '' : 's'}
            </div>
          )}
          <div className="dashboard-detections-header">
            Detections · {current?.detections?.length || 0}
            {filterClass ? ` (${filterClass})` : ''}
          </div>
          <div className="dashboard-detections-list">
            {current ? (
              <DetectionList detections={current.detections} filterClass={filterClass} />
            ) : (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>Select an image to inspect</div>
            )}
          </div>
        </section>
      </div>

      <section className="dashboard-table-panel" aria-label="Results table">
        <div className="dashboard-panel-label">
          Results · {filteredResults.length} row{filteredResults.length === 1 ? '' : 's'}
          <span style={{ marginLeft: 'auto', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
            Click a row to preview on map
          </span>
        </div>
        <BatchResultsTable
          results={filteredResults}
          selectedIndex={displayIndex}
          onSelect={setIndex}
          filterClass={filterClass}
          loadingMore={loadingMore}
        />
      </section>
      </div>

      {showDeleteConfirm && (
        <div className="dashboard-modal-backdrop" role="presentation" onClick={() => setShowDeleteConfirm(false)}>
          <div
            className="dashboard-modal"
            role="dialog"
            aria-labelledby="delete-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="delete-modal-title">Delete all batch data?</h3>
            <p>
              This permanently removes all saved batch jobs, detection results, and annotated images from the
              server.
            </p>
            <div className="dashboard-modal-actions">
              <button
                type="button"
                className="dashboard-btn dashboard-btn-ghost"
                onClick={() => setShowDeleteConfirm(false)}
              >
                Cancel
              </button>
              <button type="button" className="dashboard-btn dashboard-btn-danger" onClick={handleDeleteAll}>
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
