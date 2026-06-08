const VIEW_CHIPS = [
  { idx: 1, label: 'Side 1', side: true },
  { idx: 2, label: 'Side 2', side: true },
  { idx: 3, label: 'Side 3', side: true },
  { idx: 4, label: 'Side 4', side: true },
  { idx: 0, label: 'Overlay (0)', side: false },
  { idx: 5, label: 'Sky (5)', side: false },
]

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
  const view = views.includes(selectedView) ? selectedView : (nav?.suggested_view ?? 4)
  const viewLabels = nav?.view_labels || {}
  const filename = `${String(selectedId).padStart(6, '0')}_${view}.jpg`
  const isPanorama = detectionResult?.panorama === true
  const panoViewCount = detectionResult?.pano_views?.length || 4
  const total = Object.values(detectionResult?.counts || {}).reduce((a, b) => a + b, 0)
  const modelStatus = detectionResult?.model_status || []
  const modelsOk = modelStatus.filter((m) => m.status === 'ok').length
  const modelsTotal = modelStatus.length
  const modelsFailed = modelStatus.filter((m) => m.status === 'failed').length
  const geoSkipped = detectionResult?.geo_skipped_reason === 'non_horizontal_view'
  const isNonHorizontal = view === 0 || view === 5

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
          {viewLabels[view] ? ` · ${viewLabels[view]}` : ''}
        </div>
        {detecting && (
          <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
            Building 360° panorama…
          </div>
        )}
        {!detecting && detectionResult && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>
              {isPanorama
                ? `${total} detected across ${panoViewCount} views`
                : `${total} detected`}
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
        {VIEW_CHIPS.map(({ idx, label, side }) => {
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
                border: `1px solid ${active ? 'var(--green)' : side ? 'var(--border)' : 'var(--border)'}`,
                background: active ? 'var(--green)' : side ? 'var(--surface2)' : 'var(--surface)',
                color: !available ? 'var(--muted)' : active ? '#000' : side ? 'var(--text)' : 'var(--muted)',
                fontSize: 10,
                fontWeight: side ? 600 : 500,
                fontFamily: 'var(--font-mono)',
                cursor: available ? 'pointer' : 'not-allowed',
                opacity: available ? 1 : 0.4,
              }}
            >
              {label}
            </button>
          )
        })}
      </div>

      {view >= 1 && view <= 4 && (
        <div
          style={{
            padding: '6px 12px',
            fontSize: 11,
            color: 'var(--muted)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          Scroll or use mouse wheel to look around · views 1–4
        </div>
      )}

      {(isNonHorizontal || geoSkipped) && (
        <div
          style={{
            padding: '6px 12px',
            fontSize: 11,
            color: '#f59e0b',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(245, 158, 11, 0.08)',
          }}
        >
          No map estimate for overlay/sky views — use Side 1–4 for geolocation.
        </div>
      )}

      <div style={{ padding: '6px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
        {Number(point.lat).toFixed(6)}, {Number(point.lng).toFixed(6)}
      </div>
    </div>
  )
}
