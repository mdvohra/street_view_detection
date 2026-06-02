import { Link } from 'react-router-dom'

export default function PolygonToolbar({
  drawMode,
  onDrawMode,
  onClear,
  onPredict,
  onFinish,
  onUndo,
  hasPolygon,
  draftCount,
  predicting,
  activeJobId,
}) {
  const canFinish = drawMode && draftCount >= 3

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: 12,
        zIndex: 550,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        maxWidth: 280,
      }}
    >
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => onDrawMode(!drawMode)}
          style={toolBtn(drawMode)}
        >
          {drawMode ? '✕ Stop drawing' : '▣ Draw area'}
        </button>
        {drawMode && (
          <>
            <button
              type="button"
              onClick={onFinish}
              disabled={!canFinish}
              style={{
                ...toolBtn(false),
                background: canFinish ? 'var(--blue)' : 'var(--surface2)',
                color: canFinish ? '#fff' : 'var(--muted)',
              }}
            >
              Finish polygon
            </button>
            <button
              type="button"
              onClick={onUndo}
              disabled={draftCount === 0}
              style={toolBtn(false)}
            >
              Undo
            </button>
          </>
        )}
        <button type="button" onClick={onClear} disabled={!hasPolygon && draftCount === 0} style={toolBtn(false)}>
          Clear
        </button>
        <button
          type="button"
          onClick={onPredict}
          disabled={!hasPolygon || predicting}
          style={{
            ...toolBtn(false),
            background: hasPolygon && !predicting ? 'var(--green)' : 'var(--surface2)',
            color: hasPolygon && !predicting ? '#000' : 'var(--muted)',
          }}
        >
          {predicting ? 'Running…' : 'Predict'}
        </button>
      </div>

      {drawMode && (
        <div
          style={{
            padding: '8px 10px',
            borderRadius: 8,
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            fontSize: 11,
            lineHeight: 1.5,
            color: 'var(--muted)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          }}
        >
          <strong style={{ color: 'var(--green)' }}>Click</strong> map corners to add points ({draftCount}{' '}
          placed).
          <br />
          {draftCount >= 3 ? (
            <>
              <strong style={{ color: 'var(--blue)' }}>Click the blue dot</strong> or press{' '}
              <strong>Finish polygon</strong> to close.
            </>
          ) : (
            <>Need at least 3 points to close the area.</>
          )}
        </div>
      )}

      {activeJobId && (
        <Link
          to={`/dashboard/${activeJobId}`}
          style={{
            fontSize: 11,
            color: 'var(--green)',
            fontFamily: 'var(--font-mono)',
            textDecoration: 'none',
          }}
        >
          View batch dashboard →
        </Link>
      )}
      <Link
        to="/dashboard"
        style={{
          fontSize: 11,
          color: 'var(--muted)',
          fontFamily: 'var(--font-mono)',
          textDecoration: 'none',
        }}
      >
        All batch results
      </Link>
    </div>
  )
}

function toolBtn(active) {
  return {
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: active ? 'var(--green-dim)' : 'var(--surface)',
    color: 'var(--text)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  }
}
