import { CLASS_COLORS, CLASS_EMOJIS } from '../constants/classes'

const VIEW_LABELS = ['0', '1', '2', '3', '4', '5']

export default function GsvContinuedImagePanel({
  selectedId,
  point,
  nav,
  selectedView,
  onViewChange,
  detectionResult,
  detecting,
  onRunDetection,
}) {
  if (selectedId == null || !point) {
    return (
      <div
        style={{
          padding: 16,
          color: 'var(--muted)',
          fontSize: 13,
          textAlign: 'center',
          lineHeight: 1.6,
        }}
      >
        Click the map or use arrows to enter street view along a covered road.
      </div>
    )
  }

  const views = point.views || nav?.views || [0, 1, 2, 3, 4, 5]
  const view = views.includes(selectedView) ? selectedView : views[0]
  const filename = `${String(selectedId).padStart(6, '0')}_${view}.jpg`
  const total = Object.values(detectionResult?.counts || {}).reduce((a, b) => a + b, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>
          {filename}
        </div>
        <button
          type="button"
          onClick={onRunDetection}
          disabled={detecting}
          style={{
            padding: '5px 10px',
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: detecting ? 'var(--surface2)' : 'var(--green)',
            color: detecting ? 'var(--muted)' : '#000',
            fontSize: 11,
            fontWeight: 700,
            cursor: detecting ? 'wait' : 'pointer',
          }}
        >
          {detecting ? 'Detecting…' : 'Run detection'}
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 4,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}
      >
        {VIEW_LABELS.map((label, idx) => {
          const available = views.includes(idx)
          const active = view === idx
          return (
            <button
              key={label}
              type="button"
              disabled={!available}
              onClick={() => available && onViewChange(idx)}
              style={{
                padding: '3px 8px',
                borderRadius: 5,
                border: `1px solid ${active ? 'var(--green)' : 'var(--border)'}`,
                background: active ? 'var(--green)' : 'var(--surface2)',
                color: !available ? 'var(--muted)' : active ? '#000' : 'var(--text)',
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'var(--font-mono)',
                cursor: available ? 'pointer' : 'not-allowed',
                opacity: available ? 1 : 0.4,
              }}
            >
              V{label}
            </button>
          )
        })}
      </div>

      <div style={{ padding: '8px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
        {Number(point.lat).toFixed(6)}, {Number(point.lng).toFixed(6)}
        {detectionResult && (
          <span style={{ color: 'var(--green)', marginLeft: 8 }}>
            {total} detected
          </span>
        )}
      </div>

      {detectionResult && (
        <div style={{ padding: '0 12px 12px', flex: 1, overflow: 'auto' }}>
          {(detectionResult.detections || []).length === 0 ? (
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>No objects detected</div>
          ) : (
            (detectionResult.detections || []).map((det, i) => {
              const color = CLASS_COLORS[det.class] || '#aaa'
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 8px',
                    marginBottom: 4,
                    borderRadius: 6,
                    background: 'var(--surface2)',
                    fontSize: 11,
                  }}
                >
                  <span>{CLASS_EMOJIS[det.class] || '📦'}</span>
                  <span style={{ fontWeight: 600 }}>{det.class}</span>
                  <span style={{ marginLeft: 'auto', color, fontFamily: 'var(--font-mono)' }}>
                    {(det.confidence * 100).toFixed(0)}%
                  </span>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
