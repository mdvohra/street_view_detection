import { useEffect } from 'react'
import { CircleMarker, Polygon, Polyline, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

const POLY_STYLE = {
  color: '#05CB63',
  weight: 2,
  fillColor: '#05CB63',
  fillOpacity: 0.15,
}

const VERTEX_STYLE = {
  radius: 7,
  color: '#fff',
  weight: 2,
  fillColor: '#05CB63',
  fillOpacity: 1,
}

const FIRST_VERTEX_STYLE = {
  ...VERTEX_STYLE,
  radius: 9,
  fillColor: '#3B82F6',
  color: '#05CB63',
  weight: 3,
}

/** Close polygon when click is within this many meters of the first vertex. */
const CLOSE_RADIUS_M = 25

function DraftClickHandler({ drawMode, draftPoints, onAddPoint, onClosePolygon }) {
  const map = useMap()

  useMapEvents({
    click(e) {
      if (!drawMode) return

      const lng = e.latlng.lng
      const lat = e.latlng.lat

      if (draftPoints.length >= 3) {
        const [flng, flat] = draftPoints[0]
        const distM = map.distance(e.latlng, L.latLng(flat, flng))
        if (distM <= CLOSE_RADIUS_M) {
          onClosePolygon()
          return
        }
      }

      onAddPoint([lng, lat])
    },
  })

  return null
}

export default function PolygonDrawControl({
  polygon,
  draftPoints,
  drawMode,
  onAddPoint,
  onClosePolygon,
}) {
  const map = useMap()

  useEffect(() => {
    if (!drawMode) return undefined
    map.doubleClickZoom.disable()
    return () => {
      map.doubleClickZoom.enable()
    }
  }, [drawMode, map])

  const finishedLatLngs = polygon?.length >= 3 ? polygon.map(([lng, lat]) => [lat, lng]) : null
  const draftLatLngs = draftPoints.map(([lng, lat]) => [lat, lng])
  const canClose = drawMode && draftPoints.length >= 3

  return (
    <>
      <DraftClickHandler
        drawMode={drawMode}
        draftPoints={draftPoints}
        onAddPoint={onAddPoint}
        onClosePolygon={onClosePolygon}
      />

      {finishedLatLngs && !drawMode && <Polygon positions={finishedLatLngs} pathOptions={POLY_STYLE} />}

      {drawMode && draftLatLngs.length >= 2 && (
        <Polyline positions={draftLatLngs} pathOptions={{ ...POLY_STYLE, dashArray: '6 6', fill: false }} />
      )}

      {drawMode && draftLatLngs.length >= 3 && (
        <Polygon positions={draftLatLngs} pathOptions={{ ...POLY_STYLE, fillOpacity: 0.08, weight: 1 }} />
      )}

      {drawMode &&
        draftPoints.map(([lng, lat], i) => (
          <CircleMarker
            key={`draft-${i}-${lng}-${lat}`}
            center={[lat, lng]}
            pathOptions={i === 0 && canClose ? FIRST_VERTEX_STYLE : VERTEX_STYLE}
          />
        ))}

      {!drawMode && finishedLatLngs &&
        polygon.map(([lng, lat], i) => (
          <CircleMarker key={`done-${i}`} center={[lat, lng]} pathOptions={VERTEX_STYLE} />
        ))}
    </>
  )
}
