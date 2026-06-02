import { Link } from 'react-router-dom'

const ACTIVE = new Set(['queued', 'discovering', 'running', 'cancelling'])

export default function BatchProgressOverlay({ job, onCancel, cancelling }) {
  if (!job) return null

  const { status, processed, total, job_id: jobId } = job
  const active = ACTIVE.has(status)
  const pct = total > 0 ? Math.round((processed / total) * 100) : 0
  const phase =
    status === 'discovering' || status === 'queued'
      ? 'Discovering imagery…'
      : status === 'cancelling' || cancelling
        ? 'Cancelling…'
        : 'Detecting objects…'

  const terminal = status === 'completed' || status === 'cancelled' || status === 'failed'

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: 12,
        transform: 'translateX(-50%)',
        zIndex: 600,
        width: 'min(420px, 92%)',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '12px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{phase}</div>
      {total > 0 && (
        <>
          <div
            style={{
              height: 6,
              background: 'var(--surface2)',
              borderRadius: 3,
              overflow: 'hidden',
              marginBottom: 6,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${pct}%`,
                background: 'var(--green)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
            {processed} / {total} images
            {status === 'cancelled' && ' · cancelled'}
          </div>
        </>
      )}
      {status === 'discovering' && total === 0 && (
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Querying Mapillary…
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {active && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling || status === 'cancelling'}
            style={btnStyle('#ff4444')}
          >
            {cancelling || status === 'cancelling' ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
        {terminal && jobId && (
          <Link
            to={`/dashboard/${jobId}`}
            style={{ ...btnStyle('var(--green)'), textDecoration: 'none', display: 'inline-block' }}
          >
            Open dashboard
          </Link>
        )}
      </div>
    </div>
  )
}

function btnStyle(bg) {
  return {
    padding: '6px 12px',
    borderRadius: 6,
    border: 'none',
    background: bg,
    color: '#fff',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
  }
}
