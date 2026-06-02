import axios from 'axios'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const getConfig = () => axios.get(`${BASE}/config`)
export const getHealth = () => axios.get(`${BASE}/health`)
export const detectStreet = (lat, lng, image_id = null) =>
  axios.post(`${BASE}/detect/street`, { lat, lng, image_id })
export const detectCamera = (image_b64, lat = null, lng = null) =>
  axios.post(`${BASE}/detect/camera`, { image_b64, lat, lng })
