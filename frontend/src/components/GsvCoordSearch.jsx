import { useCallback, useState } from 'react'
import toast from 'react-hot-toast'
import { apiErrorMessage, getGsvContinuedNearby } from '../api'

const COORD_EPS = 1e-5

function parseCoordQuery(raw) {
  const text = raw.trim()
  if (!text) return null

  const parts = text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
  if (parts.length < 2) return null

  const lat = Number(parts[0])
  const lng = Number(parts[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat, lng }
}

function findInPoints(points, lat, lng) {
  let best = null
  let bestDist = Infinity
  for (const p of points) {
    const dlat = p.lat - lat
    const dlng = p.lng - lng
    const dist = Math.hypot(dlat, dlng)
    if (dist < COORD_EPS && dist < bestDist) {
      best = p
      bestDist = dist
    }
  }
  return best
}

export default function GsvCoordSearch({ points, onSelectLocation, disabled }) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)

  const runSearch = useCallback(async () => {
    const parsed = parseCoordQuery(query)
    if (!parsed) {
      toast.error('Enter latitude and longitude (e.g. 40.440309, -80.0)')
      return
    }

    const { lat, lng } = parsed
    const local = findInPoints(points, lat, lng)
    if (local) {
      onSelectLocation(local.id)
      toast.success(`Location ${local.id} · ${local.lat.toFixed(6)}, ${local.lng.toFixed(6)}`)
      return
    }

    setSearching(true)
    try {
      const res = await getGsvContinuedNearby(lat, lng, 3)
      const hit = res.data
      onSelectLocation(hit.id)
      toast.success(
        `Location ${hit.id} · ${Number(hit.lat).toFixed(6)}, ${Number(hit.lng).toFixed(6)}` +
          (hit.distance_m > 0 ? ` (${hit.distance_m} m)` : '')
      )
    } catch (err) {
      toast.error(
        apiErrorMessage(err, `No image at ${lat.toFixed(6)}, ${lng.toFixed(6)} in this dataset`)
      )
    } finally {
      setSearching(false)
    }
  }, [query, points, onSelectLocation])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!disabled && !searching) runSearch()
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginLeft: 16,
        flex: '1 1 280px',
        maxWidth: 420,
        minWidth: 200,
      }}
    >
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="lat, lng — e.g. 40.440309, -80.0"
        disabled={disabled || searching}
        aria-label="Search by latitude and longitude"
        style={{
          flex: 1,
          minWidth: 0,
          padding: '6px 10px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--surface2)',
          color: 'var(--text)',
          fontSize: 12,
          fontFamily: 'var(--font-mono)',
        }}
      />
      <button
        type="submit"
        disabled={disabled || searching || !query.trim()}
        style={{
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid var(--border)',
          background: 'var(--green)',
          color: '#000',
          fontSize: 12,
          fontWeight: 600,
          cursor: disabled || searching ? 'not-allowed' : 'pointer',
          opacity: disabled || searching || !query.trim() ? 0.5 : 1,
          whiteSpace: 'nowrap',
        }}
      >
        {searching ? '…' : 'Go'}
      </button>
    </form>
  )
}
