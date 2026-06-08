const STORAGE_PREFIX = 'gsv-map-session:'

export function buildGsvDetectionId(locationId, view, index) {
  return `${locationId}:${view}:${index}`
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

export function createSession() {
  return {
    sessionId: newSessionId(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    locations: [],
    detections: [],
    aggregate_counts: {},
  }
}

function flattenDetections(locationId, detections) {
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
      geo_distance_m: det.geo_distance_m,
      camera_lat: det.camera_lat,
      camera_lng: det.camera_lng,
      ray_end_lat: det.ray_end_lat,
      ray_end_lng: det.ray_end_lng,
    })
  })
  return markers
}

export function appendLocationResult(session, panoramaResponse) {
  if (!session || !panoramaResponse) return session

  const locationId = panoramaResponse.id
  const detections = panoramaResponse.detections || []
  const newMarkers = flattenDetections(locationId, detections)

  const remainingDetections = session.detections.filter((d) => d.location_id !== locationId)
  const allDetections = [...remainingDetections, ...newMarkers]

  const existingLoc = session.locations.find((l) => l.id === locationId)
  const order = existingLoc?.order ?? session.locations.length
  const locationEntry = {
    id: locationId,
    lat: panoramaResponse.lat,
    lng: panoramaResponse.lng,
    order,
    counts: panoramaResponse.counts || {},
  }

  const remainingLocations = session.locations.filter((l) => l.id !== locationId)
  const allLocations = [...remainingLocations, locationEntry].sort((a, b) => a.order - b.order)

  return {
    ...session,
    locations: allLocations,
    detections: allDetections,
    aggregate_counts: recomputeAggregateCounts(allDetections),
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
  return session?.detections?.length ?? 0
}
