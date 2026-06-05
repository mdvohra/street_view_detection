import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '/api' : 'http://localhost:8000')

async function withRetry(request, { retries = 3, delayMs = 1000 } = {}) {
  let lastError
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await request()
    } catch (err) {
      lastError = err
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)))
      }
    }
  }
  throw lastError
}

function apiErrorMessage(err, fallback) {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg
  if (err?.message) return err.message
  return fallback
}

export const getConfig = () => axios.get(`${BASE}/config`)
export const getHealth = () => axios.get(`${BASE}/health`)
export const detectStreet = (lat, lng, image_id = null) =>
  axios.post(`${BASE}/detect/street`, { lat, lng, image_id })
export const detectCamera = (image_b64, lat = null, lng = null) =>
  axios.post(`${BASE}/detect/camera`, { image_b64, lat, lng })

export const startBatchPolygon = (polygon) =>
  axios.post(`${BASE}/batch/polygon`, { polygon })
export const getBatchJob = (jobId) => axios.get(`${BASE}/batch/${jobId}`)
export const cancelBatchJob = (jobId) => axios.post(`${BASE}/batch/${jobId}/cancel`)
export const getBatchResults = (jobId, offset = 0, limit = 50) =>
  axios.get(`${BASE}/batch/${jobId}/results`, { params: { offset, limit } })
export const getBatchGeo = (jobId) => axios.get(`${BASE}/batch/${jobId}/geo`)
export const getBatchDetectionsGeo = (jobId) =>
  axios.get(`${BASE}/batch/${jobId}/detections/geo`)
export const getBatchObjectsGeo = (jobId) => axios.get(`${BASE}/batch/${jobId}/objects/geo`)
export const runBatchGeolocate = (jobId) => axios.post(`${BASE}/batch/${jobId}/geolocate`)
export const listBatchJobs = () => axios.get(`${BASE}/batch`)
export const deleteAllBatches = () => axios.delete(`${BASE}/batch`)
export const deleteBatchJob = (jobId) => axios.delete(`${BASE}/batch/${jobId}`)

export const annotatedImageUrl = (jobId, imageId) =>
  `${BASE}/batch/${jobId}/images/${imageId}/annotated`

export const getDatasetMeta = () =>
  withRetry(() => axios.get(`${BASE}/dataset/meta`, { timeout: 30000 }))
export const getDatasetPoints = () =>
  withRetry(() => axios.get(`${BASE}/dataset/points`, { timeout: 120000 }))
export const datasetImageUrl = (id) => `${BASE}/dataset/images/${id}`
export const detectDatasetImage = (id) => axios.post(`${BASE}/dataset/images/${id}/detect`, null, { timeout: 120000 })

export const getGsvContinuedMeta = () =>
  withRetry(() => axios.get(`${BASE}/gsv-continued/meta`, { timeout: 30000 }))
export const getGsvContinuedPoints = () =>
  withRetry(() => axios.get(`${BASE}/gsv-continued/points`, { timeout: 120000 }))
export const gsvContinuedImageUrl = (id, view = 0, maxWidth = 1280) => {
  const params = new URLSearchParams({ view: String(view) })
  if (maxWidth) params.set('max_width', String(maxWidth))
  return `${BASE}/gsv-continued/locations/${id}/image?${params}`
}
export const detectGsvContinuedLocation = (id, view = 0, options = {}) =>
  axios.post(`${BASE}/gsv-continued/locations/${id}/detect`, null, {
    params: { view },
    timeout: 150000,
    signal: options.signal,
  })
export const getGsvContinuedModelsHealth = () =>
  axios.get(`${BASE}/gsv-continued/models/health`, { timeout: 150000 })
export const getGsvContinuedNav = (id, fromId = null) =>
  axios.get(`${BASE}/gsv-continued/locations/${id}/nav`, {
    params: fromId != null ? { from: fromId } : {},
  })
export const getGsvContinuedNearby = (lat, lng, maxDistM = 25) =>
  axios.get(`${BASE}/gsv-continued/nearby`, { params: { lat, lng, max_dist_m: maxDistM } })

export { apiErrorMessage }
export const apiBase = BASE
