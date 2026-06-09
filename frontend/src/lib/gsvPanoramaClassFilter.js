import { useEffect, useState } from 'react'
import { gsvContinuedImageUrl } from '../api'
import { CLASS_COLORS } from '../constants/classes'

const PANORAMA_TITLE = '360 Degree Street Asset Panorama'
const TITLE_BAND_HEIGHT = 48

export function filterDetections(detections, filterClass) {
  const list = detections || []
  if (!filterClass) return list
  return list.filter((d) => d.class === filterClass)
}

export function extractViewsData(detectionResult) {
  const views = detectionResult?.views
  if (!views || typeof views !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(views)) {
    const viewNum = Number(key)
    if (!Number.isNaN(viewNum)) {
      out[viewNum] = value
    }
  }
  return out
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    img.src = src
  })
}

function hexToRgb(hex) {
  const h = (hex || '#b4b4b4').replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function drawAnnotatedView(ctx, detections, filterClass) {
  const list = filterDetections(detections, filterClass)
  for (const d of list) {
    const bbox = d.bbox
    if (!bbox || bbox.length < 4) continue
    const [x1, y1, x2, y2] = bbox
    const { r, g, b } = hexToRgb(CLASS_COLORS[d.class])
    const color = `rgb(${r}, ${g}, ${b})`

    ctx.save()
    ctx.globalAlpha = 0.15
    ctx.fillStyle = color
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1)
    ctx.restore()

    ctx.strokeStyle = color
    ctx.lineWidth = 2
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1)

    const label = `${d.class} ${Math.round((d.confidence ?? 0) * 100)}%`
    ctx.font = '600 12px system-ui, sans-serif'
    const tw = ctx.measureText(label).width
    const th = 14
    const labelY = Math.max(y1 - th - 4, 0)
    ctx.fillStyle = color
    ctx.fillRect(x1, labelY, tw + 6, th + 4)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, x1 + 3, labelY + th)
  }
}

function stitchCanvases(tiles) {
  if (!tiles.length) throw new Error('No tiles to stitch')

  const targetH = Math.max(...tiles.map((t) => t.height))
  const normalized = tiles.map((t) => {
    if (t.height === targetH) return t
    const scale = targetH / t.height
    const w = Math.round(t.width * scale)
    const c = document.createElement('canvas')
    c.width = w
    c.height = targetH
    c.getContext('2d').drawImage(t, 0, 0, w, targetH)
    return c
  })

  const stripW = normalized.reduce((sum, t) => sum + t.width, 0)
  const strip = document.createElement('canvas')
  strip.width = stripW
  strip.height = targetH
  const stripCtx = strip.getContext('2d')
  let x = 0
  for (const tile of normalized) {
    stripCtx.drawImage(tile, x, 0)
    x += tile.width
  }

  const combined = document.createElement('canvas')
  combined.width = stripW
  combined.height = targetH + TITLE_BAND_HEIGHT
  const ctx = combined.getContext('2d')
  ctx.fillStyle = '#1e1e1e'
  ctx.fillRect(0, 0, stripW, TITLE_BAND_HEIGHT)
  ctx.fillStyle = '#dcdcdc'
  ctx.font = '600 16px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(PANORAMA_TITLE, stripW / 2, TITLE_BAND_HEIGHT / 2)
  ctx.drawImage(strip, 0, TITLE_BAND_HEIGHT)

  return combined.toDataURL('image/jpeg', 0.88)
}

export async function buildFilteredPanoramaB64({
  panoViews,
  viewsByKey,
  getRawViewSrc,
  filterClass,
}) {
  if (!filterClass) return null

  const tiles = []
  for (const view of panoViews) {
    const src = await getRawViewSrc(view)
    const img = await loadImage(src)
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const viewDets = viewsByKey[view]?.detections || []
    drawAnnotatedView(ctx, viewDets, filterClass)
    tiles.push(canvas)
  }

  return stitchCanvases(tiles)
}

export async function fetchViewAsB64(locationId, view, maxWidth = 1920) {
  const url = gsvContinuedImageUrl(locationId, view, maxWidth)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch view ${view} for location ${locationId}`)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function buildViewTilesFromResponse(locationId, response) {
  const panoViews = response?.pano_views || [1, 2, 3, 4]
  const viewsByKey = extractViewsData(response)
  const viewTiles = {}

  for (const view of panoViews) {
    const viewData = viewsByKey[view]
    if (!viewData) continue
    viewTiles[String(view)] = {
      detections: (viewData.detections || []).map((d) => ({
        class: d.class,
        confidence: d.confidence,
        bbox: d.bbox,
      })),
    }
  }

  return { panoViews, viewTiles }
}

export async function enrichImageryWithViewTiles(locationId, response, viewTiles) {
  const panoViews = response?.pano_views || [1, 2, 3, 4]
  const enriched = { ...viewTiles }

  await Promise.all(
    panoViews.map(async (view) => {
      const key = String(view)
      if (!enriched[key]) enriched[key] = { detections: [] }
      if (enriched[key].raw_b64) return
      enriched[key].raw_b64 = await fetchViewAsB64(locationId, view)
    })
  )

  return enriched
}

export function useFilteredPanorama({ detectionResult, filterClass, locationId }) {
  const [displayB64, setDisplayB64] = useState(null)
  const [rebuilding, setRebuilding] = useState(false)

  const panoramaB64 = detectionResult?.panorama_image_b64 ?? null
  const panoViews = detectionResult?.pano_views || [1, 2, 3, 4]

  useEffect(() => {
    if (!filterClass || !detectionResult || !locationId) {
      setDisplayB64(null)
      setRebuilding(false)
      return undefined
    }

    let cancelled = false
    setRebuilding(true)

    const viewsByKey = extractViewsData(detectionResult)

    buildFilteredPanoramaB64({
      panoViews,
      viewsByKey,
      filterClass,
      getRawViewSrc: (view) => gsvContinuedImageUrl(locationId, view, 1920),
    })
      .then((b64) => {
        if (!cancelled) {
          setDisplayB64(b64)
          setRebuilding(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDisplayB64(null)
          setRebuilding(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [filterClass, detectionResult, locationId, panoViews, panoramaB64])

  return {
    displayB64: filterClass ? displayB64 : panoramaB64,
    rebuilding: filterClass ? rebuilding : false,
  }
}
