import { useCallback, useEffect } from 'react'
import { gsvContinuedImageUrl } from '../api'
import { useFilteredPanorama } from '../lib/gsvPanoramaClassFilter'
import GsvPanoramaViewer from './GsvPanoramaViewer'

const ARROW_STYLE = {
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  borderRadius: 8,
  background: 'rgba(0,0,0,0.45)',
  color: '#fff',
  fontSize: 22,
  fontWeight: 700,
  cursor: 'pointer',
  zIndex: 2,
  boxShadow: '0 2px 10px rgba(0,0,0,0.35)',
  transition: 'background 0.15s',
}

function NavArrow({ direction, targetId, onNavigate, style }) {
  if (!targetId) return null
  const labels = { forward: '▲', backward: '▼', left: '◀', right: '▶' }
  return (
    <button
      type="button"
      title={`Go ${direction}`}
      aria-label={`Go ${direction}`}
      style={{ ...ARROW_STYLE, ...style }}
      onClick={(e) => {
        e.stopPropagation()
        onNavigate(direction)
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(5,203,99,0.75)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'rgba(0,0,0,0.45)'
      }}
    >
      {labels[direction]}
    </button>
  )
}

export default function GsvStreetViewViewer({
  locationId,
  view,
  activeView,
  nav,
  detectionResult,
  detecting,
  onNavigate,
  onForwardClickZone,
  filterClass,
}) {
  const isPanoramaMode = view >= 1 && view <= 4
  const panoViews = detectionResult?.pano_views || nav?.side_views || [1, 2, 3, 4]
  const scrollView = activeView ?? view
  const { displayB64, rebuilding } = useFilteredPanorama({
    detectionResult,
    filterClass,
    locationId,
  })

  const handleKeyDown = useCallback(
    (e) => {
      if (!nav?.nav) return
      const map = {
        ArrowUp: 'forward',
        ArrowDown: 'backward',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      }
      const dir = map[e.key]
      if (!dir || !nav.nav[dir]) return
      e.preventDefault()
      onNavigate(dir)
    },
    [nav, onNavigate]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const viewLabels = nav?.view_labels || {}
  const heading = nav?.view_heading?.[view] ?? null
  const viewLabel =
    viewLabels[view] ||
    (view >= 1 && view <= 4 ? `Side ${view}` : view === 0 ? 'Overlay' : view === 5 ? 'Sky' : `View ${view}`)

  const hudTitle =
    heading != null
      ? `${viewLabel} · ${Number(heading).toFixed(0)}°`
      : viewLabel

  if (isPanoramaMode) {
    return (
      <div style={{ position: 'relative', flex: 1, minHeight: 280, display: 'flex', flexDirection: 'column' }}>
        <GsvPanoramaViewer
          locationId={locationId}
          panoramaImageB64={
            filterClass ? displayB64 : detectionResult?.panorama_image_b64
          }
          activeView={scrollView}
          panoViews={panoViews}
          detecting={detecting}
          rebuilding={rebuilding}
          onNavigate={onNavigate}
          nav={nav}
        />
        <div
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgba(0,0,0,0.55)',
            color: '#fff',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            zIndex: 3,
            pointerEvents: 'none',
          }}
        >
          Loc {locationId} · {hudTitle}
        </div>
      </div>
    )
  }

  const imageSrc = gsvContinuedImageUrl(locationId, view, 1920)

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 280,
        background: '#111',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <img
        key={`${locationId}-${view}`}
        src={imageSrc}
        alt={`Location ${locationId} view ${view}`}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
          userSelect: 'none',
        }}
        draggable={false}
      />

      {nav?.nav?.forward && (
        <button
          type="button"
          aria-label="Go forward"
          onClick={onForwardClickZone}
          style={{
            position: 'absolute',
            left: '25%',
            right: '25%',
            bottom: 0,
            height: '40%',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            zIndex: 1,
          }}
        />
      )}

      <NavArrow
        direction="forward"
        targetId={nav?.nav?.forward}
        onNavigate={onNavigate}
        style={{ left: '50%', bottom: 16, transform: 'translateX(-50%)', width: 56, height: 48 }}
      />
      <NavArrow
        direction="backward"
        targetId={nav?.nav?.backward}
        onNavigate={onNavigate}
        style={{ left: '50%', top: 16, transform: 'translateX(-50%)', width: 56, height: 40 }}
      />
      <NavArrow
        direction="left"
        targetId={nav?.nav?.left}
        onNavigate={onNavigate}
        style={{ left: 16, bottom: 16, width: 48, height: 48 }}
      />
      <NavArrow
        direction="right"
        targetId={nav?.nav?.right}
        onNavigate={onNavigate}
        style={{ right: 16, bottom: 16, width: 48, height: 48 }}
      />

      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          padding: '6px 10px',
          borderRadius: 6,
          background: 'rgba(0,0,0,0.55)',
          color: '#fff',
          fontSize: 11,
          fontFamily: 'var(--font-mono)',
          zIndex: 3,
          pointerEvents: 'none',
        }}
      >
        Loc {locationId} · {hudTitle}
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          fontSize: 10,
          color: 'rgba(255,255,255,0.5)',
          fontFamily: 'var(--font-mono)',
          zIndex: 3,
          pointerEvents: 'none',
        }}
      >
        ↑↓←→ navigate
      </div>
    </div>
  )
}
