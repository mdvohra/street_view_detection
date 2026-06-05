const VIEW_LABELS = ['0', '1', '2', '3', '4', '5']

export default function GsvContinuedImagePanel({
  selectedId,
  point,
  nav,
  selectedView,
  onViewChange,
  detectionResult,
  detecting,
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
  const modelStatus = detectionResult?.model_status || []
  const modelsOk = modelStatus.filter((m) => m.status === 'ok').length
  const modelsTotal = modelStatus.length
  const modelsFailed = modelStatus.filter((m) => m.status === 'failed').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
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
        {detecting && (
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
            Detecting…
          </div>
        )}
        {!detecting && detectionResult && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>
              {total} detected
            </div>
            {modelsTotal > 0 && (
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: modelsFailed ? '#f59e0b' : 'var(--muted)',
                }}
              >
                {modelsOk}/{modelsTotal} models OK
              </div>
            )}
          </div>
        )}
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

      <div style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
        {Number(point.lat).toFixed(6)}, {Number(point.lng).toFixed(6)}
      </div>
    </div>
  )
}
