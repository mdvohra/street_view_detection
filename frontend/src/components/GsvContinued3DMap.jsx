import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Layer, Marker, Source } from 'react-map-gl/maplibre'
import Map3DBase from './Map3DBase'
import { MAP3D_DEFAULTS } from '../lib/map3d/map3dConfig'
import {
  computeMapCenter,
  fitPointsFromMarkers,
  pointsToClusterGeoJSON,
  trailToGeoJSON,
  uniqueLegendClasses,
} from '../lib/map3d/map3dLayers'
import { cameraMarkerHtml, detectionEmoji, detectionMarkerHtml } from '../lib/map3d/map3dMarkers'

export default function GsvContinued3DMap({
  points = [],
  selectedId,
  onSelectPoint,
  basemap = 'street',
  onBasemapToggle,
  trailPoints = [],
  compact = false,
  selectedPinColor = '#05CB63',
  selectedPinSize = 14,
  detectionMarkers = [],
  selectedDetectionId,
  onSelectDetection,
  showSessionLegend = false,
}) {
  const mapRef = useRef(null)
  const [markersReady, setMarkersReady] = useState(false)
  const selected = points.find((p) => p.id === selectedId)

  const fitPoints = useMemo(
    () => fitPointsFromMarkers({ points, detectionMarkers }),
    [points, detectionMarkers]
  )

  const center = useMemo(
    () =>
      computeMapCenter({
        points,
        flyTarget: selected ? { lat: selected.lat, lng: selected.lng } : null,
        fallback: [20, 0],
      }),
    [selected, points]
  )

  const trailGeoJSON = useMemo(() => trailToGeoJSON(trailPoints), [trailPoints])
  const clusterGeoJSON = useMemo(
    () => pointsToClusterGeoJSON(points, selectedId),
    [points, selectedId]
  )

  const legendClasses = useMemo(() => uniqueLegendClasses(detectionMarkers), [detectionMarkers])

  useEffect(() => {
    setMarkersReady(false)
    if (!points.length) return undefined
    const t = window.setTimeout(() => setMarkersReady(true), 200)
    return () => window.clearTimeout(t)
  }, [points])

  const handleMapReady = useCallback(
    (map) => {
      mapRef.current = map

      map.on('click', 'location-clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['location-clusters'] })
        const clusterId = features[0]?.properties?.cluster_id
        if (clusterId == null) return
        const source = map.getSource('location-points')
        if (!source?.getClusterExpansionZoom) return
        source.getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return
          map.easeTo({
            center: features[0].geometry.coordinates,
            zoom,
            duration: 400,
          })
        })
      })

      map.on('click', 'location-unclustered', (e) => {
        const rawId = e.features?.[0]?.properties?.id
        if (rawId == null) return
        const match = points.find((p) => String(p.id) === String(rawId))
        onSelectPoint?.(match?.id ?? rawId)
      })

      map.on('mouseenter', 'location-clusters', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'location-clusters', () => {
        map.getCanvas().style.cursor = ''
      })
      map.on('mouseenter', 'location-unclustered', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'location-unclustered', () => {
        map.getCanvas().style.cursor = ''
      })
    },
    [onSelectPoint]
  )

  const extraControls = onBasemapToggle ? (
    <div className="dashboard-map-controls map3d-session-controls">
      <button type="button" className="dashboard-map-toggle" onClick={onBasemapToggle}>
        {basemap === 'street' ? 'Satellite' : 'Street map'}
      </button>
    </div>
  ) : null

  const legend =
    showSessionLegend && detectionMarkers.length > 0 ? (
      <div className="dashboard-map-legend">
        <span>
          <i className="legend-dot camera" /> Camera
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
    ) : null

  return (
    <Map3DBase
      center={center}
      zoom={3}
      basemap={basemap}
      fitPoints={fitPoints}
      fitResetKey={points.length}
      fitMaxZoom={MAP3D_DEFAULTS.continuedFitBoundsMaxZoom}
      flyTarget={selected ? { lat: selected.lat, lng: selected.lng } : null}
      flyZoom={compact ? MAP3D_DEFAULTS.compactFlyToZoom : MAP3D_DEFAULTS.flyToZoom}
      extraControls={extraControls}
      legend={legend}
      onMapReady={handleMapReady}
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

      {markersReady && clusterGeoJSON.features.length > 0 && (
        <Source
          id="location-points"
          type="geojson"
          data={clusterGeoJSON}
          cluster
          clusterMaxZoom={14}
          clusterRadius={MAP3D_DEFAULTS.clusterRadius}
        >
          <Layer
            id="location-clusters"
            type="circle"
            filter={['has', 'point_count']}
            paint={{
              'circle-color': '#3B82F6',
              'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 100, 22],
              'circle-opacity': 0.85,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#fff',
            }}
          />
          <Layer
            id="location-cluster-count"
            type="symbol"
            filter={['has', 'point_count']}
            layout={{
              'text-field': ['get', 'point_count_abbreviated'],
              'text-size': 11,
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            }}
            paint={{ 'text-color': '#fff' }}
          />
          <Layer
            id="location-unclustered"
            type="circle"
            filter={['!', ['has', 'point_count']]}
            paint={{
              'circle-color': '#3B82F6',
              'circle-radius': 6,
              'circle-opacity': 0.9,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#fff',
            }}
          />
        </Source>
      )}

      {markersReady && selected && (
        <Marker longitude={selected.lng} latitude={selected.lat} anchor="center">
          <div
            className="map3d-html-marker map3d-camera-marker"
            dangerouslySetInnerHTML={{
              __html: cameraMarkerHtml(selectedPinColor, selectedPinSize),
            }}
          />
        </Marker>
      )}

      {detectionMarkers.map((d) => {
        const isSelected = d.detection_id === selectedDetectionId
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
                __html: detectionMarkerHtml(
                  d.class,
                  isSelected,
                  d.tier === 'estimated' || d.geo_quality === 'low',
                ),
              }}
            />
          </Marker>
        )
      })}
    </Map3DBase>
  )
}
