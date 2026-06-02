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

const CLASS_COLORS = {
  Car: '#FF7800',
  Tree: '#50C800',
  'Street Light': '#00DCF0',
  Pole: '#FF50C8',
  Building: '#3264FF',
  Motorcycle: '#FFC832',
  Person: '#6432FF',
  'Traffic Signal': '#00FFC8',
}

export default function DetectionPanel() {
  const { activeDetection } = useDetections()

  if (!activeDetection) {
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
        <div style={{ fontSize: 40 }}>🗺️</div>
        <div style={{ color: 'var(--muted)', textAlign: 'center', fontSize: 13, lineHeight: 1.6 }}>
          Zoom in until you see <span style={{ color: 'var(--green)', fontWeight: 600 }}>green coverage</span>.
          <br />
          Click on or near a <span style={{ color: 'var(--green)', fontWeight: 600 }}>dot or line</span> to detect.
          <br />
          <span style={{ fontSize: 12 }}>Camera panel below is optional for live capture.</span>
        </div>
      </div>
    )
  }

  const d = activeDetection
  const total = Object.values(d.counts || {}).reduce((a, b) => a + b, 0)
  const time = d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : ''

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
        }}
      >
        <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--green)' }}>
          {d.source === 'camera' ? '📷 CAMERA' : '📡 STREET VIEW'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {time} · {total} objects
        </div>
      </div>

      {d.annotated_image_b64 && (
        <div style={{ padding: 12 }}>
          <img
            src={d.annotated_image_b64}
            alt="Detection result"
            style={{ width: '100%', borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </div>
      )}

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
          Detections ({d.detections?.length || 0})
        </div>
        {(d.detections || []).length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: '12px 0' }}>No objects detected</div>
        )}
        {(d.detections || []).map((det, i) => {
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
                      transition: 'width 0.4s ease',
                    }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
