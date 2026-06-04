import { CLASS_COLORS, CLASS_EMOJIS } from '../constants/classes'
import { datasetImageUrl } from '../api'

export default function DatasetImagePanel({
  selectedId,
  point,
  detectionResult,
  detecting,
  onRunDetection,
}) {
  if (selectedId == null || !point) {
    return (
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          gap: 12,
        }}
      >
        <div style={{ fontSize: 40 }}>📍</div>
        <div style={{ color: 'var(--muted)', textAlign: 'center', fontSize: 13, lineHeight: 1.6 }}>
          Click a dot on the map to view a dataset image.
          <br />
          <span style={{ fontSize: 12 }}>Use Run detection to analyze the selected image.</span>
        </div>
      </div>
    )
  }

  const imageSrc = detectionResult?.annotated_image_b64 || datasetImageUrl(selectedId)
  const total = Object.values(detectionResult?.counts || {}).reduce((a, b) => a + b, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--surface)',
          position: 'sticky',
          top: 0,
          zIndex: 1,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>
          📡 DATASET · {selectedId}.png
        </div>
        <button
          type="button"
          onClick={onRunDetection}
          disabled={detecting}
          style={{
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: detecting ? 'var(--surface2)' : 'var(--green)',
            color: detecting ? 'var(--muted)' : '#000',
            fontSize: 12,
            fontWeight: 700,
            cursor: detecting ? 'wait' : 'pointer',
            fontFamily: 'var(--font-ui)',
          }}
        >
          {detecting ? 'Detecting…' : 'Run detection'}
        </button>
      </div>

      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
        <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)', marginBottom: 4 }}>
          Row {point.row ?? selectedId + 1} · Image {selectedId}.png
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
          {Number(point.lat).toFixed(6)}, {Number(point.lng).toFixed(6)}
        </div>
        {detectionResult && (
          <div style={{ marginTop: 6, color: 'var(--green)', fontFamily: 'var(--font-mono)' }}>
            {total} object{total === 1 ? '' : 's'} detected
          </div>
        )}
      </div>

      <div style={{ padding: 12 }}>
        <img
          src={imageSrc}
          alt={`Dataset image ${selectedId}`}
          style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }}
        />
      </div>

      {detectionResult && (
        <div style={{ padding: '0 12px 12px' }}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted)',
              marginBottom: 8,
              fontFamily: 'var(--font-mono)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            Detections ({detectionResult.detections?.length || 0})
          </div>
          {(detectionResult.detections || []).length === 0 && (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0' }}>No objects detected</div>
          )}
          {(detectionResult.detections || []).map((det, i) => {
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
      )}
    </div>
  )
}
