import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Map, { NavigationControl } from 'react-map-gl/maplibre'
import 'maplibre-gl/dist/maplibre-gl.css'
import {
  MAP3D_DEFAULTS,
  MAP3D_STYLE_URL,
  enhanceMap3d,
  fitMap3dBounds,
  flyMap3dTo,
  resetMap3dView,
  setMap3dBasemap,
  setMap3dBuildingsEnabled,
  setMap3dTerrainEnabled,
} from '../lib/map3d/map3dConfig'

export default function Map3DBase({
  center,
  zoom = MAP3D_DEFAULTS.zoom,
  pitch = MAP3D_DEFAULTS.pitch,
  bearing = MAP3D_DEFAULTS.bearing,
  basemap = 'street',
  fitPoints = [],
  fitResetKey = 0,
  fitMaxZoom = MAP3D_DEFAULTS.fitBoundsMaxZoom,
  flyTarget = null,
  flyZoom = MAP3D_DEFAULTS.flyToZoom,
  show3dControls = true,
  children,
  extraControls = null,
  legend = null,
  onMapReady,
}) {
  const mapRef = useRef(null)
  const fittedRef = useRef(false)
  const [terrainEnabled, setTerrainEnabled] = useState(true)
  const [buildingsEnabled, setBuildingsEnabled] = useState(true)
  const savedViewRef = useRef(null)

  const initialViewState = useMemo(
    () => ({
      longitude: center.lng,
      latitude: center.lat,
      zoom,
      pitch,
      bearing,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const handleLoad = useCallback(
    (evt) => {
      const map = evt.target
      enhanceMap3d(map, { basemap, terrainEnabled, buildingsEnabled })
      savedViewRef.current = {
        center: [center.lng, center.lat],
        zoom,
        pitch,
        bearing,
      }
      onMapReady?.(map)
    },
    [basemap, buildingsEnabled, center.lat, center.lng, bearing, onMapReady, pitch, terrainEnabled, zoom]
  )

  useEffect(() => {
    const map = mapRef.current?.getMap?.()
    if (!map?.isStyleLoaded?.()) return
    setMap3dBasemap(map, basemap, buildingsEnabled)
  }, [basemap, buildingsEnabled])

  useEffect(() => {
    const map = mapRef.current?.getMap?.()
    if (!map) return
    setMap3dTerrainEnabled(map, terrainEnabled)
  }, [terrainEnabled])

  useEffect(() => {
    const map = mapRef.current?.getMap?.()
    if (!map) return
    setMap3dBuildingsEnabled(map, buildingsEnabled, basemap)
  }, [buildingsEnabled, basemap])

  useEffect(() => {
    fittedRef.current = false
  }, [fitResetKey])

  useEffect(() => {
    if (fittedRef.current || !fitPoints.length) return
    const map = mapRef.current?.getMap?.()
    if (!map?.isStyleLoaded?.()) return
    fittedRef.current = true
    fitMap3dBounds(map, fitPoints, { padding: 40, maxZoom: fitMaxZoom })
  }, [fitPoints, fitResetKey, fitMaxZoom])

  useEffect(() => {
    if (flyTarget?.lat == null || flyTarget?.lng == null) return
    const map = mapRef.current?.getMap?.()
    if (map) flyMap3dTo(map, flyTarget.lat, flyTarget.lng, flyZoom)
  }, [flyTarget, flyZoom])

  useEffect(() => {
    const map = mapRef.current?.getMap?.()
    if (!map) return undefined
    const run = () => map.resize()
    run()
    const t = window.setTimeout(run, 100)
    window.addEventListener('resize', run)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', run)
    }
  }, [])

  const handleReset3d = () => {
    const map = mapRef.current?.getMap?.()
    const v = savedViewRef.current
    if (!map || !v) return
    resetMap3dView(map, {
      center: v.center,
      zoom: v.zoom,
      pitch: v.pitch,
      bearing: v.bearing,
    })
  }

  return (
    <div className="dashboard-map-wrap map3d-wrap">
      <Map
        ref={mapRef}
        mapStyle={MAP3D_STYLE_URL}
        initialViewState={initialViewState}
        style={{ width: '100%', height: '100%' }}
        onLoad={handleLoad}
        scrollZoom
        maxPitch={85}
        attributionControl
        canvasContextAttributes={{ antialias: true }}
      >
        <NavigationControl visualizePitch position="top-left" />
        {children}
      </Map>

      {show3dControls && (
        <div className="map3d-control-bar">
          <button type="button" className="dashboard-map-toggle" onClick={handleReset3d}>
            Reset 3D view
          </button>
          <button
            type="button"
            className={`dashboard-map-toggle${terrainEnabled ? ' active' : ''}`}
            onClick={() => setTerrainEnabled((v) => !v)}
          >
            {terrainEnabled ? 'Terrain on' : 'Terrain off'}
          </button>
          <button
            type="button"
            className={`dashboard-map-toggle${buildingsEnabled ? ' active' : ''}`}
            onClick={() => setBuildingsEnabled((v) => !v)}
          >
            {buildingsEnabled ? 'Buildings on' : 'Buildings off'}
          </button>
        </div>
      )}

      {extraControls}
      {legend}
    </div>
  )
}
