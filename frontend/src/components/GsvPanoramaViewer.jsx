import { useCallback, useEffect, useRef } from 'react'

const DRAG_THRESHOLD_PX = 4

export default function GsvPanoramaViewer({
  locationId,
  panoramaImageB64,
  activeView,
  panoViews = [1, 2, 3, 4],
  detecting,
  onNavigate,
  nav,
}) {
  const scrollRef = useRef(null)
  const imgRef = useRef(null)
  const dragRef = useRef({ active: false, moved: false, startX: 0, startScrollLeft: 0 })

  const scrollToView = useCallback(
    (view) => {
      const container = scrollRef.current
      const img = imgRef.current
      if (!container || !img || !panoViews.includes(view)) return

      const idx = panoViews.indexOf(view)
      const tileCount = panoViews.length
      if (idx < 0 || tileCount === 0) return

      const tileWidth = img.clientWidth / tileCount
      const targetLeft = idx * tileWidth + tileWidth / 2 - container.clientWidth / 2
      container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' })
    },
    [panoViews]
  )

  useEffect(() => {
    if (activeView != null && panoViews.includes(activeView)) {
      scrollToView(activeView)
    }
  }, [activeView, locationId, panoramaImageB64, panoViews, scrollToView])

  const handleWheel = useCallback((e) => {
    const container = scrollRef.current
    if (!container) return
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault()
      container.scrollLeft += e.deltaY
    }
  }, [])

  const endDrag = useCallback(() => {
    dragRef.current.active = false
    const container = scrollRef.current
    if (container) container.classList.remove('gsv-pano-scroll--dragging')
  }, [])

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    const container = scrollRef.current
    if (!container) return
    dragRef.current = {
      active: true,
      moved: false,
      startX: e.pageX,
      startScrollLeft: container.scrollLeft,
    }
    container.classList.add('gsv-pano-scroll--dragging')
  }, [])

  const handleMouseMove = useCallback((e) => {
    if (!dragRef.current.active) return
    const container = scrollRef.current
    if (!container) return
    const dx = e.pageX - dragRef.current.startX
    if (Math.abs(dx) >= DRAG_THRESHOLD_PX) dragRef.current.moved = true
    container.scrollLeft = dragRef.current.startScrollLeft - dx
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', endDrag)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', endDrag)
    }
  }, [handleMouseMove, endDrag])

  const handleDownload = useCallback(() => {
    if (!panoramaImageB64) return
    const link = document.createElement('a')
    link.href = panoramaImageB64
    link.download = `location_${String(locationId).padStart(6, '0')}_panoramic_assets.jpg`
    link.click()
  }, [panoramaImageB64, locationId])

  return (
    <div
      className="gsv-pano-root"
      style={{
        position: 'relative',
        flex: 1,
        minHeight: 280,
        background: '#111',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        ref={scrollRef}
        className="gsv-pano-scroll"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={{ flex: 1, minHeight: 0 }}
      >
        {detecting && !panoramaImageB64 ? (
          <div className="gsv-pano-loading">
            Building 360° panorama… views 1–4
          </div>
        ) : panoramaImageB64 ? (
          <img
            ref={imgRef}
            key={`pano-${locationId}-${panoramaImageB64.slice(0, 32)}`}
            src={panoramaImageB64}
            alt={`Location ${locationId} 360° panorama`}
            className="gsv-pano-img"
            draggable={false}
          />
        ) : (
          <div className="gsv-pano-loading">No panorama available</div>
        )}
      </div>

      {panoramaImageB64 && (
        <button
          type="button"
          className="gsv-pano-download"
          onClick={handleDownload}
        >
          Download
        </button>
      )}

      <div className="gsv-pano-nav-layer" aria-hidden="false">
      {['forward', 'backward', 'left', 'right'].map((direction) => {
        const targetId = nav?.nav?.[direction]
        if (!targetId) return null
        const labels = { forward: '▲', backward: '▼', left: '◀', right: '▶' }
        const positions = {
          forward: { left: '50%', bottom: 28, transform: 'translateX(-50%)', width: 56, height: 48 },
          backward: { left: '50%', top: 12, transform: 'translateX(-50%)', width: 56, height: 40 },
          left: { left: 16, bottom: 28, width: 48, height: 48 },
          right: { right: 16, bottom: 28, width: 48, height: 48 },
        }
        const style = positions[direction]
        return (
          <button
            key={direction}
            type="button"
            title={`Go ${direction}`}
            aria-label={`Go ${direction}`}
            className="gsv-pano-nav-btn"
            style={style}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onNavigate(direction)
            }}
          >
            {labels[direction]}
          </button>
        )
      })}
      </div>
    </div>
  )
}
