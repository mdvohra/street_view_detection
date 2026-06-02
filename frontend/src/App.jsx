import { useEffect } from 'react'
import { Toaster } from 'react-hot-toast'
import { DetectionProvider, useDetections } from './context/DetectionContext'
import MapView from './components/MapView'
import DetectionPanel from './components/DetectionPanel'
import CameraView from './components/CameraView'
import StatsBar from './components/StatsBar'
import { getConfig } from './api'

function Inner() {
  const { setMapillaryToken, setModelInfo, setModels } = useDetections()

  useEffect(() => {
    getConfig().then((r) => {
      setMapillaryToken(r.data.mapillary_token)
      setModelInfo(r.data.model_info)
      setModels(r.data.models ?? null)
    })
  }, [setMapillaryToken, setModelInfo, setModels])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <StatsBar />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: '0 0 60%', position: 'relative' }}>
          <MapView />
        </div>

        <div
          style={{
            flex: '0 0 40%',
            display: 'flex',
            flexDirection: 'column',
            borderLeft: '1px solid var(--border)',
            overflow: 'hidden',
          }}
        >
          <div style={{ flex: '0 0 60%', overflow: 'auto' }}>
            <DetectionPanel />
          </div>
          <div style={{ flex: '0 0 40%', borderTop: '1px solid var(--border)', overflow: 'auto' }}>
            <CameraView />
          </div>
        </div>
      </div>

      <Toaster
        position="bottom-left"
        toastOptions={{
          style: {
            background: 'var(--surface2)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
          },
        }}
      />
    </div>
  )
}

export default function App() {
  return (
    <DetectionProvider>
      <Inner />
    </DetectionProvider>
  )
}
