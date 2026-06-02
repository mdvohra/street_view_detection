import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  annotatedImageUrl,
  cancelBatchJob,
  deleteAllBatches,
  getBatchGeo,
  getBatchJob,
  getBatchResults,
  getConfig,
  listBatchJobs,
} from '../api'
import BatchDashboardMap from '../components/BatchDashboardMap'
import ImageThumbGrid from '../components/ImageThumbGrid'
import { CLASS_COLORS, CLASS_EMOJIS, CLASS_META } from '../constants/classes'

const PAGE_SIZE = 30
const ACTIVE = new Set(['queued', 'discovering', 'running', 'cancelling'])

function DetectionList({ detections, filterClass }) {
  const list = (detections || []).filter((d) => !filterClass || d.class === filterClass)
  if (list.length === 0) {
    return <div style={{ color: 'var(--muted)', fontSize: 13, padding: 12 }}>No detections</div>
  }
  return (
    <div style={{ padding: '0 12px 12px' }}>
      {list.map((det, i) => {
        const color = CLASS_COLORS[det.class] || '#aaa'
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '7px 10px',
              marginBottom: 4,
              borderRadius: 6,
              background: 'var(--surface2)',
              border: `1px solid ${color}22`,
            }}
          >
            <span style={{ fontSize: 16 }}>{CLASS_EMOJIS[det.class] || '📦'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{det.class}</span>
                <span style={{ fontSize: 11, color, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  {(det.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div style={{ height: 3, background: 'var(--surface)', borderRadius: 2 }}>
                <div
                  style={{
                    height: '100%',
                    width: `${det.confidence * 100}%`,
                    background: color,
                    borderRadius: 2,
                  }}
                />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LocationMeta({ result }) {
  if (!result) return null
  const lat = result.lat
  const lng = result.lng
  return (
    <div
      style={{
        padding: '12px 14px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface2)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--muted)',
          marginBottom: 8,
        }}
      >
        Location
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: 12 }}>
        <span style={{ color: 'var(--muted)' }}>Latitude</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)', fontWeight: 600 }}>
          {lat != null ? Number(lat).toFixed(6) : '—'}
        </span>
        <span style={{ color: 'var(--muted)' }}>Longitude</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)', fontWeight: 600 }}>
          {lng != null ? Number(lng).toFixed(6) : '—'}
        </span>
        <span style={{ color: 'var(--muted)' }}>Image</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, wordBreak: 'break-all' }}>
          {result.image_id}
        </span>
        {result.captured_at && (
          <>
            <span style={{ color: 'var(--muted)' }}>Captured</span>
            <span style={{ fontFamily: 'var(--font-mono)' }}>
              {new Date(Number(result.captured_at)).toLocaleString()}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

export default function BatchDashboard() {
  const { jobId: paramJobId } = useParams()
  const navigate = useNavigate()
  const [jobs, setJobs] = useState([])
  const [job, setJob] = useState(null)
  const [results, setResults] = useState([])
  const [geoMarkers, setGeoMarkers] = useState([])
  const [polygon, setPolygon] = useState(null)
  const [mapillaryToken, setMapillaryToken] = useState(null)
  const [basemap, setBasemap] = useState('street')
  const [index, setIndex] = useState(0)
  const [filterClass, setFilterClass] = useState(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const touchStartX = useRef(null)
  const pollRef = useRef(null)

  const jobId = paramJobId || job?.job_id || jobs[0]?.job_id

  useEffect(() => {
    getConfig().then((r) => setMapillaryToken(r.data.mapillary_token)).catch(() => {})
  }, [])

  const loadJobs = useCallback(async () => {
    try {
      const { data } = await listBatchJobs()
      setJobs(data.jobs || [])
      if (!paramJobId && data.jobs?.length) {
        setJob(data.jobs[0])
      }
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
      loadGeo(jobId)
    }
  }, [jobId])

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
        loadGeo(jobId)
      }
    }, 1500)
    return () => clearInterval(pollRef.current)
  }, [jobId, job?.status, loadResults, loadGeo])

  const filteredGeoMarkers = useMemo(() => {
    if (!filterClass) return geoMarkers
    return geoMarkers.filter((m) => (m.counts?.[filterClass] || 0) > 0)
  }, [geoMarkers, filterClass])

  const filteredResults = useMemo(() => {
    if (!filterClass) return results
    return results.filter((r) => (r.counts?.[filterClass] || 0) > 0)
  }, [results, filterClass])

  useEffect(() => {
    setIndex(0)
  }, [filterClass, jobId])

  const displayIndex = filteredResults.length ? Math.min(index, filteredResults.length - 1) : 0
  const current = filteredResults[displayIndex] || filteredResults[0]
  const selectedImageId = current?.image_id ?? null

  const goPrev = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1))
  }, [])

  const goNext = useCallback(() => {
    setIndex((i) => Math.min(filteredResults.length - 1, i + 1))
  }, [filteredResults.length])

  const handleSelectFromMap = useCallback(
    (imageId) => {
      const idx = filteredResults.findIndex((r) => r.image_id === imageId)
      if (idx >= 0) {
        setIndex(idx)
        return
      }
      const geo = filteredGeoMarkers.find((m) => m.image_id === imageId)
      if (geo) {
        const inResults = results.findIndex((r) => r.image_id === imageId)
        if (inResults >= 0) {
          const filteredIdx = filterClass
            ? results
                .filter((r) => (r.counts?.[filterClass] || 0) > 0)
                .findIndex((r) => r.image_id === imageId)
            : inResults
          if (filteredIdx >= 0) setIndex(filteredIdx)
        }
      }
    },
    [filteredResults, filteredGeoMarkers, results, filterClass]
  )

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
      toast.success('All batch data deleted')
      navigate('/dashboard')
    } catch (_) {
      toast.error('Delete failed')
    }
  }

  const agg = job?.aggregate_counts || {}
  const totalObjects = Object.values(agg).reduce((a, b) => a + b, 0)

  if (!jobId && jobs.length === 0) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
        <h2 style={{ marginBottom: 8 }}>No batch results yet</h2>
        <p style={{ color: 'var(--muted)', marginBottom: 24 }}>
          Draw a polygon on the map and click Predict to run batch detection.
        </p>
        <Link to="/" style={{ color: 'var(--green)', fontWeight: 600 }}>
          ← Back to map
        </Link>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--bg)' }}>
      <header
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <Link to="/" style={{ color: 'var(--green)', textDecoration: 'none', fontWeight: 600, fontSize: 14 }}>
          ← Map
        </Link>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>
            Detection dashboard
            {job?.status === 'cancelled' && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: 'rgba(255,100,100,0.2)',
                  color: '#ff8888',
                }}
              >
                Cancelled
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            {job
              ? `${job.processed}/${job.total} images · ${job.failed} failed · ${totalObjects} objects`
              : 'Loading…'}
            {ACTIVE.has(job?.status) && ` · ${job.status}`}
          </div>
        </div>
        {jobs.length > 1 && (
          <select
            value={jobId || ''}
            onChange={(e) => navigate(`/dashboard/${e.target.value}`)}
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              background: 'var(--surface2)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              fontSize: 12,
            }}
          >
            {jobs.map((j) => (
              <option key={j.job_id} value={j.job_id}>
                {j.job_id.slice(0, 8)}… — {j.status} ({j.processed}/{j.total})
              </option>
            ))}
          </select>
        )}
        {job && ACTIVE.has(job.status) && (
          <button type="button" onClick={handleCancel} disabled={cancelling} style={headerBtn('#c44')}>
            {cancelling ? 'Cancelling…' : 'Cancel job'}
          </button>
        )}
        <button type="button" onClick={() => setShowDeleteConfirm(true)} style={headerBtn('var(--surface2)')}>
          Delete all
        </button>
      </header>

      {ACTIVE.has(job?.status) && (
        <div style={{ padding: '8px 20px', background: 'var(--green-dim)', fontSize: 12 }}>
          Batch in progress… {job.processed} / {job.total}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '10px 20px',
          overflowX: 'auto',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
        }}
      >
        <button type="button" onClick={() => setFilterClass(null)} style={chipStyle(!filterClass)}>
          All
        </button>
        {CLASS_META.map(({ key, emoji, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilterClass(key)}
            style={chipStyle(filterClass === key)}
          >
            {emoji} {label} ({agg[key] || 0})
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        {/* Map column */}
        <div
          style={{
            flex: '0 0 38%',
            minWidth: 280,
            borderRight: '1px solid var(--border)',
            position: 'relative',
          }}
        >
          {jobId && (
            <BatchDashboardMap
              key={jobId}
              markers={filteredGeoMarkers}
              polygon={polygon}
              selectedImageId={selectedImageId}
              onSelect={handleSelectFromMap}
              mapillaryToken={mapillaryToken}
              basemap={basemap}
              onBasemapToggle={() => setBasemap((b) => (b === 'street' ? 'satellite' : 'street'))}
            />
          )}
        </div>

        {/* Viewer + thumbs */}
        <div style={{ flex: '0 0 37%', minWidth: 260, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              background: '#000',
              touchAction: 'pan-y',
              minHeight: 0,
            }}
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
              <img
                src={annotatedImageUrl(jobId, current.image_id)}
                alt="Detection"
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ color: 'var(--muted)', padding: 16, textAlign: 'center', fontSize: 13 }}>
                {filterClass ? 'No images with this class in loaded results' : 'No images to display'}
              </div>
            )}
            <button type="button" onClick={goPrev} style={navBtn('left')} aria-label="Previous">
              ‹
            </button>
            <button type="button" onClick={goNext} style={navBtn('right')} aria-label="Next">
              ›
            </button>
            <div
              style={{
                position: 'absolute',
                bottom: 12,
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                color: 'var(--muted)',
                background: 'rgba(0,0,0,0.6)',
                padding: '4px 10px',
                borderRadius: 6,
              }}
            >
              {filteredResults.length ? displayIndex + 1 : 0} / {filteredResults.length}
            </div>
          </div>
          <ImageThumbGrid
            jobId={jobId}
            results={filteredResults}
            selectedIndex={displayIndex}
            onSelect={setIndex}
          />
        </div>

        {/* Details column */}
        <div
          style={{
            flex: '1',
            minWidth: 240,
            borderLeft: '1px solid var(--border)',
            overflow: 'auto',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <LocationMeta result={current} />
          <div
            style={{
              padding: '8px 14px',
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              color: 'var(--muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              borderBottom: '1px solid var(--border)',
            }}
          >
            Detections ({current?.detections?.length || 0})
          </div>
          {current ? (
            <DetectionList detections={current.detections} filterClass={filterClass} />
          ) : (
            <div style={{ padding: 12, color: 'var(--muted)', fontSize: 13 }}>Select an image</div>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 400,
            }}
          >
            <h3 style={{ marginBottom: 8 }}>Delete all batch data?</h3>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
              This removes all saved batch jobs, detection results, and annotated images from the server.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowDeleteConfirm(false)} style={headerBtn('var(--surface2)')}>
                Cancel
              </button>
              <button type="button" onClick={handleDeleteAll} style={headerBtn('#c44')}>
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function headerBtn(bg) {
  return {
    padding: '8px 14px',
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: bg,
    color: 'var(--text)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
  }
}

function chipStyle(active) {
  return {
    padding: '6px 12px',
    borderRadius: 20,
    border: `1px solid ${active ? 'var(--green)' : 'var(--border)'}`,
    background: active ? 'var(--green-dim)' : 'transparent',
    color: 'var(--text)',
    fontSize: 11,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontFamily: 'var(--font-ui)',
  }
}

function navBtn(side) {
  return {
    position: 'absolute',
    ...(side === 'left' ? { left: 12 } : { right: 12 }),
    top: '50%',
    transform: 'translateY(-50%)',
    width: 40,
    height: 40,
    borderRadius: '50%',
    border: '1px solid var(--border)',
    background: 'rgba(15,21,32,0.85)',
    color: 'var(--text)',
    fontSize: 24,
    cursor: 'pointer',
    lineHeight: 1,
  }
}
