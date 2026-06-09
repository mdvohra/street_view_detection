const STORAGE_PREFIX = 'gsv-map-session:'

export const STATIC_MAP_CLASSES = new Set([
  'Pole',
  'Street Light',
  'Traffic Signal',
  'Traffic Sign',
])

export function isStaticMapClass(className) {
  return STATIC_MAP_CLASSES.has(className)
}

export function filterMapMarkers(markers, { staticOnly = false, verifiedOnly = false } = {}) {
  let list = markers || []
  if (staticOnly) {
    list = list.filter((d) => isStaticMapClass(d.class))
  }
  if (verifiedOnly) {
    list = list.filter((d) => d.tier === 'official' || d.geo_quality === 'high')
  }
  return list
}

export function buildGsvDetectionId(locationId, view, index) {
  return `${locationId}:${view}:${index}`
}

export function buildGsvOfficialId(locationId, objectId) {
  return `official:${locationId}:${objectId}`
}

function newSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `gsv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function storageKey(sessionId) {
  return `${STORAGE_PREFIX}${sessionId}`
}

function recomputeAggregateCounts(detections) {
  const counts = {}
  for (const d of detections) {
    counts[d.class] = (counts[d.class] || 0) + 1
  }
  return counts
}

function mergeCountMaps(...maps) {
  const counts = {}
  for (const m of maps) {
    if (!m) continue
    for (const [cls, n] of Object.entries(m)) {
      counts[cls] = (counts[cls] || 0) + n
    }
  }
  return counts
}

export function createSession() {
  return {
    sessionId: newSessionId(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    locations: [],
    detections: [],
    raw_detections: [],
    official_objects_by_location: {},
    location_panorama_cache: {},
    aggregate_counts: {},
    official_counts: {},
    verified_counts: {},
    geo_pipeline_version: 3,
  }
}

function flattenRawDetections(locationId, detections) {
  const markers = []
  detections.forEach((det, index) => {
    const view = det.view ?? 0
    if (det.geo_lat == null || det.geo_lng == null) return
    markers.push({
      detection_id: buildGsvDetectionId(locationId, view, index),
      location_id: locationId,
      view,
      class: det.class,
      confidence: det.confidence,
      lat: det.geo_lat,
      lng: det.geo_lng,
      bearing_deg: det.bearing_deg,
      geo_method: det.geo_method,
      geo_quality: det.geo_quality,
      geo_distance_m: det.geo_distance_m,
      camera_lat: det.camera_lat,
      camera_lng: det.camera_lng,
      ray_end_lat: det.ray_end_lat,
      ray_end_lng: det.ray_end_lng,
      tier: 'raw',
    })
  })
  return markers
}

function flattenOfficialObjects(locationId, officialObjects) {
  return (officialObjects || []).map((obj, index) => {
    const objectId = obj.object_id || `obj${index}`
    return {
      detection_id: buildGsvOfficialId(locationId, objectId),
      object_id: objectId,
      location_id: locationId,
      view: obj.support_views?.[0] ?? null,
      class: obj.class,
      confidence: obj.confidence,
      lat: obj.geo_lat,
      lng: obj.geo_lng,
      bearing_deg: obj.bearing_deg,
      geo_method: obj.geo_method,
      geo_quality: obj.geo_quality,
      geo_distance_m: obj.geo_distance_m,
      camera_lat: obj.camera_lat,
      camera_lng: obj.camera_lng,
      ray_end_lat: obj.ray_end_lat,
      ray_end_lng: obj.ray_end_lng,
      support_views: obj.support_views,
      support_count: obj.support_count,
      support_locations: obj.support_locations,
      tier: obj.tier || (obj.geo_quality === 'high' ? 'official' : 'estimated'),
      snap_source: obj.snap_source,
      placement_confidence: obj.placement_confidence,
      centerline_distance_m: obj.centerline_distance_m,
    }
  })
}

export function appendLocationResult(session, panoramaResponse) {
  if (!session || !panoramaResponse) return session

  const locationId = panoramaResponse.id
  const rawMarkers = flattenRawDetections(locationId, panoramaResponse.detections || [])
  const officialObjects = panoramaResponse.official_objects || []
  const officialMarkers = flattenOfficialObjects(locationId, officialObjects)
  const mapMarkers = officialMarkers.length ? officialMarkers : rawMarkers

  const remainingDetections = session.detections.filter((d) => d.location_id !== locationId)
  const remainingRaw = (session.raw_detections || []).filter((d) => d.location_id !== locationId)
  const allDetections = [...remainingDetections, ...mapMarkers]
  const allRaw = [...remainingRaw, ...rawMarkers]

  const officialByLoc = { ...(session.official_objects_by_location || {}) }
  officialByLoc[locationId] = officialObjects

  const panoramaCache = { ...(session.location_panorama_cache || {}) }
  panoramaCache[locationId] = {
    compass: panoramaResponse.compass,
    detections: panoramaResponse.detections || [],
    image_width: panoramaResponse.views?.['4']?.image_size?.width
      || panoramaResponse.views?.['1']?.image_size?.width
      || 1280,
  }

  const existingLoc = session.locations.find((l) => l.id === locationId)
  const order = existingLoc?.order ?? session.locations.length
  const locationEntry = {
    id: locationId,
    lat: panoramaResponse.lat,
    lng: panoramaResponse.lng,
    order,
    counts: panoramaResponse.counts || {},
    official_counts: panoramaResponse.official_counts || {},
    verified_counts: panoramaResponse.verified_counts || {},
    compass: panoramaResponse.compass,
  }

  const remainingLocations = session.locations.filter((l) => l.id !== locationId)
  const allLocations = [...remainingLocations, locationEntry].sort((a, b) => a.order - b.order)

  const officialCounts = mergeCountMaps(
    ...allLocations.map((l) => l.official_counts),
  )
  const verifiedCounts = mergeCountMaps(
    ...allLocations.map((l) => l.verified_counts),
  )

  return {
    ...session,
    locations: allLocations,
    detections: allDetections,
    raw_detections: allRaw,
    official_objects_by_location: officialByLoc,
    location_panorama_cache: panoramaCache,
    aggregate_counts: Object.keys(officialCounts).length
      ? officialCounts
      : recomputeAggregateCounts(allDetections),
    official_counts: Object.keys(officialCounts).length ? officialCounts : recomputeAggregateCounts(allDetections),
    verified_counts: verifiedCounts,
    geo_pipeline_version: 3,
  }
}

export function applySessionRefine(session, refineResponse) {
  if (!session || !refineResponse?.official_objects) return session

  const markers = refineResponse.official_objects.flatMap((obj) =>
    flattenOfficialObjects(obj.location_id, [obj]),
  )
  return {
    ...session,
    detections: markers,
    aggregate_counts: refineResponse.official_counts || recomputeAggregateCounts(markers),
    official_counts: refineResponse.official_counts || recomputeAggregateCounts(markers),
    verified_counts: refineResponse.verified_counts || {},
    session_refined: true,
  }
}

export function finalizeSession(session) {
  const finalized = {
    ...session,
    endedAt: new Date().toISOString(),
  }
  try {
    sessionStorage.setItem(storageKey(finalized.sessionId), JSON.stringify(finalized))
  } catch (_) {
    // sessionStorage full or unavailable
  }
  return finalized
}

export function loadSession(sessionId) {
  if (!sessionId) return null
  try {
    const raw = sessionStorage.getItem(storageKey(sessionId))
    if (!raw) return null
    return JSON.parse(raw)
  } catch (_) {
    return null
  }
}

export function listSessions() {
  const sessions = []
  try {
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i)
      if (!key?.startsWith(STORAGE_PREFIX)) continue
      try {
        const data = JSON.parse(sessionStorage.getItem(key))
        if (data?.sessionId) sessions.push(data)
      } catch (_) {
        // skip corrupt entries
      }
    }
  } catch (_) {
    return []
  }
  return sessions.sort((a, b) => (b.endedAt || b.startedAt).localeCompare(a.endedAt || a.startedAt))
}

export function sessionHasGeoDetections(session) {
  return (session?.detections?.length ?? 0) > 0
}

export function sessionLocationCount(session) {
  return session?.locations?.length ?? 0
}

export function sessionObjectCount(session) {
  const official = session?.official_counts
  if (official && Object.keys(official).length) {
    return Object.values(official).reduce((a, b) => a + b, 0)
  }
  return session?.detections?.length ?? 0
}

export function sessionVerifiedCount(session) {
  const verified = session?.verified_counts
  if (!verified || !Object.keys(verified).length) return sessionObjectCount(session)
  return Object.values(verified).reduce((a, b) => a + b, 0)
}

export function sessionSummaryCounts(session) {
  const official = session?.official_counts || session?.aggregate_counts || {}
  const verified = session?.verified_counts || {}
  const totalOfficial = Object.values(official).reduce((a, b) => a + b, 0)
  const totalVerified = Object.values(verified).reduce((a, b) => a + b, 0)
  const estimated = Math.max(0, totalOfficial - totalVerified)
  return { totalOfficial, totalVerified, estimated, byClass: official, verifiedByClass: verified }
}

export function buildRefinePayload(session) {
  return (session.locations || []).map((loc) => {
    const cached = session.location_panorama_cache?.[loc.id]
    return {
      id: loc.id,
      lat: loc.lat,
      lng: loc.lng,
      compass: cached?.compass ?? loc.compass,
      image_width: cached?.image_width || 1280,
      detections: cached?.detections || [],
    }
  })
}
