import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

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
export const listBatchJobs = () => axios.get(`${BASE}/batch`)
export const deleteAllBatches = () => axios.delete(`${BASE}/batch`)
export const deleteBatchJob = (jobId) => axios.delete(`${BASE}/batch/${jobId}`)

export const annotatedImageUrl = (jobId, imageId) =>
  `${BASE}/batch/${jobId}/images/${imageId}/annotated`

export const apiBase = BASE
