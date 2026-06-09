import { useMemo } from 'react'
import { Layer, Marker, Source } from 'react-map-gl/maplibre'
import Map3DBase from './Map3DBase'
import { MAP3D_DEFAULTS } from '../lib/map3d/map3dConfig'
import {
  computeMapCenter,
  fitPointsFromMarkers,
  raysToGeoJSON,
  trailToGeoJSON,
  uniqueLegendClasses,
} from '../lib/map3d/map3dLayers'
import { cameraMarkerHtml, detectionEmoji, detectionMarkerHtml } from '../lib/map3d/map3dMarkers'

export default function GsvMapResults3DMap({
  cameraMarkers = [],
  detectionMarkers = [],
  trailPoints = [],
  selectedLocationId,
  selectedDetectionId,
  onSelectCamera,
  onSelectDetection,
  basemap = 'street',
  onBasemapToggle,
  showRays = false,
  onToggleRays,
  showRawDetections = false,
  onToggleRawDetections,
  showVerifiedOnly = true,
  onToggleVerifiedOnly,
}) {
  const activeCamera = cameraMarkers.find((m) => m.id === selectedLocationId)
  const activeDetection = detectionMarkers.find((d) => d.detection_id === selectedDetectionId)

  const flyTarget = useMemo(() => {
    if (activeDetection?.lat != null) {
      return { lat: activeDetection.lat, lng: activeDetection.lng }
    }
    if (activeCamera?.lat != null) {
      return { lat: activeCamera.lat, lng: activeCamera.lng }
    }
    return null
  }, [activeCamera, activeDetection])

  const center = useMemo(
    () => computeMapCenter({ cameraMarkers, detectionMarkers, flyTarget }),
    [cameraMarkers, detectionMarkers, flyTarget]
  )

  const fitPoints = useMemo(
    () => fitPointsFromMarkers({ cameraMarkers, detectionMarkers }),
    [cameraMarkers, detectionMarkers]
  )

  const trailGeoJSON = useMemo(() => trailToGeoJSON(trailPoints), [trailPoints])
  const raysGeoJSON = useMemo(
    () => raysToGeoJSON(detectionMarkers, showRays),
    [detectionMarkers, showRays]
  )

  const legendClasses = useMemo(() => uniqueLegendClasses(detectionMarkers), [detectionMarkers])

  const extraControls = (
    <div className="dashboard-map-controls map3d-session-controls">
      {onToggleRawDetections && (
        <button type="button" className="dashboard-map-toggle" onClick={onToggleRawDetections}>
          {showRawDetections ? 'Official pins' : 'Raw detections (debug)'}
        </button>
      )}
      {onToggleVerifiedOnly && !showRawDetections && (
        <button type="button" className="dashboard-map-toggle" onClick={onToggleVerifiedOnly}>
          {showVerifiedOnly ? 'Show estimated' : 'Verified only'}
        </button>
      )}
      {onToggleRays && (
        <button type="button" className="dashboard-map-toggle" onClick={onToggleRays}>
          {showRays ? 'Hide sight lines' : 'Show sight lines'}
        </button>
      )}
      {onBasemapToggle && (
        <button type="button" className="dashboard-map-toggle" onClick={onBasemapToggle}>
          {basemap === 'street' ? 'Satellite' : 'Street map'}
        </button>
      )}
    </div>
  )

  const legend = (
    <div className="dashboard-map-legend">
      <span>
        <i className="legend-dot camera" /> GSV camera
      </span>
      {legendClasses.map((cls) => (
        <span key={cls}>
          <span className="legend-symbol" aria-hidden="true">
            {detectionEmoji(cls)}
          </span>
          {cls}
        </span>
      ))}
    </div>
  )

  return (
    <Map3DBase
      center={center}
      zoom={MAP3D_DEFAULTS.zoom}
      basemap={basemap}
      fitPoints={fitPoints}
      fitResetKey={fitPoints.length}
      flyTarget={flyTarget}
      flyZoom={MAP3D_DEFAULTS.flyToZoom}
      extraControls={extraControls}
      legend={legend}
    >
      {trailGeoJSON.features.length > 0 && (
        <Source id="trail" type="geojson" data={trailGeoJSON}>
          <Layer
            id="trail-line"
            type="line"
            paint={{
              'line-color': '#05CB63',
              'line-width': 3,
              'line-opacity': 0.85,
            }}
          />
        </Source>
      )}

      {raysGeoJSON.features.length > 0 && (
        <Source id="rays" type="geojson" data={raysGeoJSON}>
          <Layer
            id="ray-lines"
            type="line"
            paint={{
              'line-color': ['get', 'color'],
              'line-width': 2,
              'line-opacity': 0.75,
              'line-dasharray': [2, 2],
            }}
          />
        </Source>
      )}

      {cameraMarkers.map((m) => {
        const selected = m.id === selectedLocationId
        return (
          <Marker
            key={`cam-${m.id}`}
            longitude={m.lng}
            latitude={m.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation()
              onSelectCamera?.(m.id)
            }}
          >
            <div
              className="map3d-html-marker map3d-camera-marker"
              dangerouslySetInnerHTML={{
                __html: cameraMarkerHtml(selected ? '#05CB63' : '#3B82F6', selected ? 14 : 8),
              }}
            />
          </Marker>
        )
      })}

      {detectionMarkers.map((d) => {
        const selected = d.detection_id === selectedDetectionId
        const estimated = d.tier === 'estimated' || d.geo_quality === 'low'
        return (
          <Marker
            key={d.detection_id}
            longitude={d.lng}
            latitude={d.lat}
            anchor="center"
            onClick={(e) => {
              e.originalEvent.stopPropagation()
              onSelectDetection?.(d.detection_id)
            }}
          >
            <div
              className="map3d-html-marker"
              dangerouslySetInnerHTML={{
                __html: detectionMarkerHtml(d.class, selected, estimated),
              }}
            />
          </Marker>
        )
      })}
    </Map3DBase>
  )
}
