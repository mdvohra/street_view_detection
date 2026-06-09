/** Free 3D map configuration — OpenFreeMap + AWS Terrarium DEM, no API keys. */

import maplibregl from 'maplibre-gl'

export const MAP3D_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty'

export const MAP3D_OPENFREEMAP_TILES = 'https://tiles.openfreemap.org/planet'

export const MAP3D_TERRAIN = {
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  tileSize: 256,
  encoding: 'terrarium',
  maxzoom: 15,
}

export const MAP3D_SATELLITE = {
  tiles: [
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  ],
  tileSize: 256,
  maxzoom: 19,
  attribution: 'Tiles © Esri',
}

export const MAP3D_DEFAULTS = {
  pitch: 58,
  bearing: 0,
  zoom: 14,
  terrainExaggeration: 1.2,
  flyToZoom: 17,
  compactFlyToZoom: 18,
  fitBoundsMaxZoom: 17,
  continuedFitBoundsMaxZoom: 12,
  clusterRadius: 50,
}

export const MAP3D_LAYER_IDS = {
  buildings: 'map3d-buildings',
  satellite: 'map3d-satellite',
  sky: 'map3d-sky',
  terrainSource: 'map3d-terrain',
  buildingSource: 'map3d-building-tiles',
  satelliteSource: 'map3d-satellite',
}

export const MAP3D_BUILDINGS_LAYER = {
  id: MAP3D_LAYER_IDS.buildings,
  source: MAP3D_LAYER_IDS.buildingSource,
  'source-layer': 'building',
  type: 'fill-extrusion',
  minzoom: 15,
  filter: ['!=', ['get', 'hide_3d'], true],
  paint: {
    'fill-extrusion-color': [
      'interpolate',
      ['linear'],
      ['get', 'render_height'],
      0,
      '#c8d0dc',
      80,
      '#9aa8bc',
      200,
      '#7a8fa8',
      400,
      '#5a7090',
    ],
    'fill-extrusion-height': [
      'interpolate',
      ['linear'],
      ['zoom'],
      15,
      0,
      16,
      ['get', 'render_height'],
    ],
    'fill-extrusion-base': [
      'case',
      ['>=', ['get', 'zoom'], 16],
      ['get', 'render_min_height'],
      0,
    ],
    'fill-extrusion-opacity': 0.85,
  },
}

export const MAP3D_SKY_LAYER = {
  id: MAP3D_LAYER_IDS.sky,
  type: 'sky',
  paint: {
    'sky-type': 'atmosphere',
    'sky-atmosphere-sun': [0.0, 45.0],
    'sky-atmosphere-sun-intensity': 12,
  },
}

export const MAP3D_LIGHT = {
  anchor: 'viewport',
  color: '#ffffff',
  intensity: 0.4,
  position: [1.5, 210, 30],
}

/** Apply terrain, sky, buildings, and optional satellite overlay to a MapLibre map instance. */
export function enhanceMap3d(map, { basemap = 'street', terrainEnabled = true, buildingsEnabled = true } = {}) {
  const ids = MAP3D_LAYER_IDS

  if (!map.getSource(ids.terrainSource)) {
    map.addSource(ids.terrainSource, {
      type: 'raster-dem',
      ...MAP3D_TERRAIN,
    })
  }

  if (!map.getSource(ids.buildingSource)) {
    map.addSource(ids.buildingSource, {
      type: 'vector',
      url: MAP3D_OPENFREEMAP_TILES,
    })
  }

  if (!map.getSource(ids.satelliteSource)) {
    map.addSource(ids.satelliteSource, {
      type: 'raster',
      tiles: MAP3D_SATELLITE.tiles,
      tileSize: MAP3D_SATELLITE.tileSize,
      maxzoom: MAP3D_SATELLITE.maxzoom,
    })
  }

  if (!map.getLayer(ids.satellite)) {
    const layers = map.getStyle()?.layers || []
    let beforeId = layers.find((l) => l.type === 'symbol')?.id
    map.addLayer(
      {
        id: ids.satellite,
        type: 'raster',
        source: ids.satelliteSource,
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': basemap === 'satellite' ? 1 : 0 },
      },
      beforeId
    )
  }

  if (!map.getLayer(ids.buildings)) {
    const layers = map.getStyle()?.layers || []
    let labelLayerId
    for (let i = 0; i < layers.length; i++) {
      if (layers[i].type === 'symbol' && layers[i].layout?.['text-field']) {
        labelLayerId = layers[i].id
        break
      }
    }
    map.addLayer({ ...MAP3D_BUILDINGS_LAYER }, labelLayerId)
  }

  if (!map.getLayer(ids.sky)) {
    map.addLayer(MAP3D_SKY_LAYER)
  }

  map.setLight(MAP3D_LIGHT)

  if (terrainEnabled) {
    map.setTerrain({
      source: ids.terrainSource,
      exaggeration: MAP3D_DEFAULTS.terrainExaggeration,
    })
  } else {
    map.setTerrain(null)
  }

  map.setLayoutProperty(
    ids.buildings,
    'visibility',
    buildingsEnabled && basemap === 'street' ? 'visible' : 'none'
  )
  map.setLayoutProperty(
    ids.satellite,
    'visibility',
    basemap === 'satellite' ? 'visible' : 'none'
  )
}

export function setMap3dTerrainEnabled(map, enabled) {
  if (!map) return
  if (enabled) {
    map.setTerrain({
      source: MAP3D_LAYER_IDS.terrainSource,
      exaggeration: MAP3D_DEFAULTS.terrainExaggeration,
    })
  } else {
    map.setTerrain(null)
  }
}

export function setMap3dBuildingsEnabled(map, enabled, basemap = 'street') {
  if (!map?.getLayer(MAP3D_LAYER_IDS.buildings)) return
  map.setLayoutProperty(
    MAP3D_LAYER_IDS.buildings,
    'visibility',
    enabled && basemap === 'street' ? 'visible' : 'none'
  )
}

export function setMap3dBasemap(map, basemap, buildingsEnabled = true) {
  if (!map) return
  const satLayer = map.getLayer(MAP3D_LAYER_IDS.satellite)
  if (satLayer) {
    map.setLayoutProperty(
      MAP3D_LAYER_IDS.satellite,
      'visibility',
      basemap === 'satellite' ? 'visible' : 'none'
    )
  }
  setMap3dBuildingsEnabled(map, buildingsEnabled, basemap)
}

export function resetMap3dView(map, { center, zoom, pitch = MAP3D_DEFAULTS.pitch, bearing = MAP3D_DEFAULTS.bearing } = {}) {
  if (!map) return
  map.easeTo({
    center,
    zoom,
    pitch,
    bearing,
    duration: 600,
  })
}

export function flyMap3dTo(map, lat, lng, zoom = MAP3D_DEFAULTS.flyToZoom) {
  if (!map || lat == null || lng == null) return
  map.flyTo({
    center: [lng, lat],
    zoom,
    pitch: map.getPitch() || MAP3D_DEFAULTS.pitch,
    duration: 450,
  })
}

export function fitMap3dBounds(map, points, { padding = 40, maxZoom = MAP3D_DEFAULTS.fitBoundsMaxZoom } = {}) {
  if (!map || !points?.length) return
  const bounds = new maplibregl.LngLatBounds()
  points.forEach(([lat, lng]) => {
    if (lat != null && lng != null) bounds.extend([lng, lat])
  })
  if (bounds.isEmpty()) return
  map.fitBounds(bounds, { padding, maxZoom, duration: 0 })
}
