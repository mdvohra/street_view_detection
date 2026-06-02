import React from 'react'
import ReactDOM from 'react-dom/client'
import L from './leaflet-globals.js'
import './leaflet-plugins.js'
import './index.css'
import App from './App'
import ErrorBoundary from './components/ErrorBoundary'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href,
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href,
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
