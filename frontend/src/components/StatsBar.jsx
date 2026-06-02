import { useEffect, useRef, useState } from 'react'
import { useDetections } from '../context/DetectionContext'

const CLASS_META = [
  { key: 'Car', emoji: '🚗', label: 'Cars' },
  { key: 'Tree', emoji: '🌳', label: 'Trees' },
  { key: 'Street Light', emoji: '💡', label: 'Lights' },
  { key: 'Pole', emoji: '🪧', label: 'Poles' },
  { key: 'Building', emoji: '🏢', label: 'Buildings' },
  { key: 'Motorcycle', emoji: '🏍️', label: 'Motos' },
  { key: 'Person', emoji: '🚶', label: 'People' },
  { key: 'Traffic Signal', emoji: '🚦', label: 'Signals' },
]

function AnimatedCount({ value }) {
  const [display, setDisplay] = useState(value)
  const prev = useRef(value)

  useEffect(() => {
    if (value === prev.current) return
    const start = prev.current
    const end = value
    const dur = 400
    const startTime = performance.now()

    const animate = (now) => {
      const p = Math.min((now - startTime) / dur, 1)
      setDisplay(Math.round(start + (end - start) * p))
      if (p < 1) requestAnimationFrame(animate)
    }
    requestAnimationFrame(animate)
    prev.current = value
  }, [value])

  return <span>{display}</span>
}

export default function StatsBar() {
  const { globalCounts, markers, modelInfo, models } = useDetections()
  const streetLightModel = models?.find((m) => m.role === 'street_light' && m.enabled)
  const total = Object.values(globalCounts).reduce((a, b) => a + b, 0)

  return (
    <div
      style={{
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        flexWrap: 'nowrap',
        overflowX: 'auto',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-ui)',
          fontWeight: 800,
          fontSize: 15,
          color: 'var(--green)',
          whiteSpace: 'nowrap',
          marginRight: 20,
          letterSpacing: '-0.02em',
        }}
      >
        🏙️ Urban<span style={{ color: 'var(--text)' }}>Detector</span>
        {modelInfo && (
          <div
            style={{
              fontSize: 9,
              color: 'var(--muted)',
              fontWeight: 500,
              marginTop: 2,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {modelInfo.workspace}/{modelInfo.project} v{modelInfo.version}
            {streetLightModel && (
              <>
                <br />+ {streetLightModel.project} v{streetLightModel.version}
              </>
            )}
          </div>
        )}
      </div>

      {CLASS_META.map(({ key, emoji, label }) => {
        const n = globalCounts[key] || 0
        return (
          <div
            key={key}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 12px',
              borderRight: '1px solid var(--border)',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontSize: 14 }}>{emoji}</span>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              <div style={{ color: 'var(--muted)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {label}
              </div>
              <div style={{ color: n > 0 ? 'var(--green)' : 'var(--muted)', fontWeight: 600, fontSize: 13 }}>
                <AnimatedCount value={n} />
              </div>
            </div>
          </div>
        )
      })}

      <div style={{ marginLeft: 'auto', paddingLeft: 16, fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
        <span style={{ color: 'var(--muted)' }}>{markers.length} scans · </span>
        <span style={{ color: 'var(--green)', fontWeight: 600 }}>{total} total objects</span>
      </div>
    </div>
  )
}
