import { useDetections } from '../context/DetectionContext'

const CLASS_EMOJIS = {
  Car: '🚗',
  Tree: '🌳',
  'Street Light': '💡',
  Pole: '🪧',
  Building: '🏢',
  Motorcycle: '🏍️',
  Person: '🚶',
  'Traffic Signal': '🚦',
}

export default function MarkerPopup({ data }) {
  const { setActiveDetection } = useDetections()
  const date = data.captured_at
    ? new Date(data.captured_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })
    : ''

  return (
    <div style={{ width: 220, fontFamily: 'var(--font-ui)' }}>
      {data.image_url && (
        <img
          src={data.image_url}
          alt="Street view"
          style={{ width: '100%', height: 120, objectFit: 'cover', borderRadius: 6, marginBottom: 8 }}
        />
      )}

      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, fontFamily: 'var(--font-mono)' }}>
        📍 {data.lat?.toFixed(4)}, {data.lng?.toFixed(4)}
        {date && <> · 📅 {date}</>}
        {data.distance_m && <> · {data.distance_m}m away</>}
      </div>

      <div style={{ fontSize: 12, marginBottom: 8 }}>
        {Object.entries(data.counts || {}).map(([cls, n]) => (
          <div key={cls} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
            <span>
              {CLASS_EMOJIS[cls] || '📦'} {cls}
            </span>
            <span style={{ color: 'var(--green)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>×{n}</span>
          </div>
        ))}
        {Object.keys(data.counts || {}).length === 0 && (
          <span style={{ color: 'var(--muted)' }}>No objects detected</span>
        )}
      </div>

      <button
        onClick={() => setActiveDetection(data)}
        style={{
          width: '100%',
          padding: '6px 0',
          borderRadius: 6,
          background: 'var(--green-dim)',
          border: '1px solid var(--border)',
          color: 'var(--green)',
          fontSize: 12,
          cursor: 'pointer',
          fontFamily: 'var(--font-ui)',
        }}
      >
        View Full Detection →
      </button>
    </div>
  )
}
