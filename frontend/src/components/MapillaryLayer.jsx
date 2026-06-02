import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'

const GREEN = '#05CB63'
const GREEN_BRIGHT = '#39FF14'
const MAX_NATIVE_ZOOM = 14

/** Vector tiles overzoom past native z — canvas is scaled; shrink draw size to match. */
function overzoomScale(mapZoom) {
  return 2 ** Math.max(0, mapZoom - MAX_NATIVE_ZOOM)
}

function screenPx(mapZoom, px) {
  return Math.max(1.25, px / overzoomScale(mapZoom))
}

function coverageStyles(satellite, mapZoom) {
  const lineColor = satellite ? GREEN_BRIGHT : GREEN
  const dotStroke = satellite ? '#111' : '#fff'
  const dotRadius = satellite ? 5.5 : 5
  const lineWeight = satellite ? 3.5 : 3
  const dotStrokeWeight = satellite ? 2.5 : 2

  return {
    overview: {
      color: lineColor,
      weight: screenPx(mapZoom, lineWeight),
      opacity: satellite ? 0.95 : 0.7,
    },
    sequence: () => ({
      color: lineColor,
      weight: screenPx(mapZoom, lineWeight),
      opacity: 1,
    }),
    image: () => ({
      radius: screenPx(mapZoom, dotRadius),
      fill: true,
      fillColor: lineColor,
      fillOpacity: 1,
      color: dotStroke,
      weight: screenPx(mapZoom, dotStrokeWeight),
      opacity: 1,
    }),
  }
}

function refreshCoverageStyles(layer, styles) {
  const tiles = layer._vectorTiles
  if (!tiles) return

  for (const key of Object.keys(tiles)) {
    const tile = tiles[key]
    const features = tile._features
    if (!features) continue

    for (const id of Object.keys(features)) {
      const data = features[id]
      const styleFn = styles[data.layerName]
      if (styleFn) {
        layer._updateStyles(data.feature, tile, styleFn)
      }
    }
  }
}

export default function MapillaryLayer({ token, basemap = 'street' }) {
  const map = useMap()
  const satellite = basemap === 'satellite'

  useEffect(() => {
    if (!token) return undefined

    const url = `https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${token}`

    const layer = L.vectorGrid.protobuf(url, {
      pane: 'overlayPane',
      vectorTileLayerStyles: coverageStyles(satellite, map.getZoom()),
      interactive: false,
      maxNativeZoom: MAX_NATIVE_ZOOM,
      maxZoom: 19,
      rendererFactory: L.canvas.tile,
    })

    layer.addTo(map)

    const onZoom = () => {
      refreshCoverageStyles(layer, coverageStyles(satellite, map.getZoom()))
    }

    map.on('zoomend', onZoom)

    return () => {
      map.off('zoomend', onZoom)
      try {
        map.removeLayer(layer)
      } catch (_) {
        // no-op cleanup guard
      }
    }
  }, [map, token, satellite])

  return null
}
