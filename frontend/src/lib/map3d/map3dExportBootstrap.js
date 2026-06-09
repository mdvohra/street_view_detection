import {
  MAP3D_BUILDINGS_LAYER,
  MAP3D_DEFAULTS,
  MAP3D_LAYER_IDS,
  MAP3D_OPENFREEMAP_TILES,
  MAP3D_SATELLITE,
  MAP3D_SKY_LAYER,
  MAP3D_STYLE_URL,
  MAP3D_TERRAIN,
} from './map3dConfig'
import { serializeMap3dExportHelpers } from './map3dLayers'

/** Inline MapLibre 3D setup + render helpers for offline HTML export. */
export function buildMap3dExportScript() {
  const config = JSON.stringify({
    styleUrl: MAP3D_STYLE_URL,
    openFreeMapTiles: MAP3D_OPENFREEMAP_TILES,
    terrain: MAP3D_TERRAIN,
    satellite: MAP3D_SATELLITE,
    layerIds: MAP3D_LAYER_IDS,
    buildingsLayer: MAP3D_BUILDINGS_LAYER,
    skyLayer: MAP3D_SKY_LAYER,
    defaults: MAP3D_DEFAULTS,
  })

  return `
var MAP3D_CFG = ${config};

function enhanceMap3dExport(map, opts) {
  opts = opts || {};
  var basemap = opts.basemap || 'street';
  var terrainEnabled = opts.terrainEnabled !== false;
  var buildingsEnabled = opts.buildingsEnabled !== false;
  var ids = MAP3D_CFG.layerIds;

  if (!map.getSource(ids.terrainSource)) {
    map.addSource(ids.terrainSource, { type: 'raster-dem', tiles: MAP3D_CFG.terrain.tiles, tileSize: MAP3D_CFG.terrain.tileSize, encoding: MAP3D_CFG.terrain.encoding, maxzoom: MAP3D_CFG.terrain.maxzoom });
  }
  if (!map.getSource(ids.buildingSource)) {
    map.addSource(ids.buildingSource, { type: 'vector', url: MAP3D_CFG.openFreeMapTiles });
  }
  if (!map.getSource(ids.satelliteSource)) {
    map.addSource(ids.satelliteSource, { type: 'raster', tiles: MAP3D_CFG.satellite.tiles, tileSize: MAP3D_CFG.satellite.tileSize, maxzoom: MAP3D_CFG.satellite.maxzoom });
  }
  if (!map.getLayer(ids.satellite)) {
    var styleLayers = map.getStyle().layers || [];
    var beforeId = null;
    for (var i = 0; i < styleLayers.length; i++) {
      if (styleLayers[i].type === 'symbol') { beforeId = styleLayers[i].id; break; }
    }
    map.addLayer({ id: ids.satellite, type: 'raster', source: ids.satelliteSource, layout: { visibility: basemap === 'satellite' ? 'visible' : 'none' } }, beforeId);
  }
  if (!map.getLayer(ids.buildings)) {
    var labelLayerId;
    var layers = map.getStyle().layers || [];
    for (var j = 0; j < layers.length; j++) {
      if (layers[j].type === 'symbol' && layers[j].layout && layers[j].layout['text-field']) { labelLayerId = layers[j].id; break; }
    }
    map.addLayer(MAP3D_CFG.buildingsLayer, labelLayerId);
  }
  if (!map.getLayer(ids.sky)) {
    map.addLayer(MAP3D_CFG.skyLayer);
  }
  map.setLight({ anchor: 'viewport', color: '#ffffff', intensity: 0.4, position: [1.5, 210, 30] });
  map.setTerrain(terrainEnabled ? { source: ids.terrainSource, exaggeration: MAP3D_CFG.defaults.terrainExaggeration } : null);
  map.setLayoutProperty(ids.buildings, 'visibility', buildingsEnabled && basemap === 'street' ? 'visible' : 'none');
  map.setLayoutProperty(ids.satellite, 'visibility', basemap === 'satellite' ? 'visible' : 'none');
}

function ensureGeoJsonSource(map, id, data) {
  if (map.getSource(id)) {
    map.getSource(id).setData(data);
  } else {
    map.addSource(id, { type: 'geojson', data: data });
  }
}

function ensureLineLayer(map, sourceId, layerId, paint) {
  if (!map.getLayer(layerId)) {
    map.addLayer({ id: layerId, type: 'line', source: sourceId, paint: paint || {} });
  }
}

${serializeMap3dExportHelpers()}
`
}
