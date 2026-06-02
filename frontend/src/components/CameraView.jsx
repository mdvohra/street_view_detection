import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useDetections } from '../context/DetectionContext'
import { detectCamera } from '../api'

export default function CameraView() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [capturedImage, setCapturedImage] = useState(null)
  const { addDetection } = useDetections()

  useEffect(() => {
    return () => stopCamera()
  }, [])

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setStreaming(true)
      }
    } catch (_) {
      toast.error('Camera access denied. Check browser permissions.')
      setCameraOpen(false)
    }
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setStreaming(false)
  }

  const handleOpenCamera = async () => {
    setCameraOpen(true)
    setCapturedImage(null)
    await startCamera()
  }

  const handleCloseCamera = () => {
    stopCamera()
    setCameraOpen(false)
  }

  const handleDetect = async () => {
    if (!streaming || detecting) return
    setDetecting(true)

    try {
      const canvas = canvasRef.current
      const video = videoRef.current
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      canvas.getContext('2d').drawImage(video, 0, 0)
      const b64 = canvas.toDataURL('image/jpeg', 0.85)
      setCapturedImage(b64)

      let lat = null
      let lng = null
      try {
        const pos = await new Promise((res, rej) =>
          navigator.geolocation.getCurrentPosition(res, rej, { timeout: 5000 })
        )
        lat = pos.coords.latitude
        lng = pos.coords.longitude
      } catch (_) {
        toast('GPS unavailable — marker not placed on map', { icon: '📍' })
      }

      const { data } = await detectCamera(b64, lat, lng)
      addDetection(data)

      const total = Object.values(data.counts || {}).reduce((a, b) => a + b, 0)
      toast.success(`Camera: ${total} objects detected`, { icon: '📷' })
    } catch (_) {
      toast.error('Camera detection failed.')
    } finally {
      setDetecting(false)
    }
  }

  if (!cameraOpen) {
    return (
      <div
        style={{
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          height: '100%',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          📷 Camera (optional)
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>
          Map clicks detect street photos by default. Open the camera only when you want a live capture.
        </p>
        <button
          type="button"
          onClick={handleOpenCamera}
          style={{
            padding: '10px 0',
            borderRadius: 8,
            border: '1px solid var(--border)',
            cursor: 'pointer',
            background: 'var(--green-dim)',
            color: 'var(--green)',
            fontFamily: 'var(--font-ui)',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          Open Camera
        </button>
      </div>
    )
  }

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 11,
          color: 'var(--muted)',
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        <span>📷 Live Camera</span>
        <button
          type="button"
          onClick={handleCloseCamera}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--muted)',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
          }}
        >
          Close ✕
        </button>
      </div>

      <div
        style={{
          position: 'relative',
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid var(--border)',
          background: '#000',
          flex: 1,
          minHeight: 0,
        }}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
        {!streaming && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--muted)',
              fontSize: 13,
            }}
          >
            Starting camera…
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleDetect}
        disabled={!streaming || detecting}
        style={{
          padding: '10px 0',
          borderRadius: 8,
          border: 'none',
          cursor: streaming && !detecting ? 'pointer' : 'default',
          background: detecting ? 'var(--surface2)' : 'var(--green)',
          color: detecting ? 'var(--muted)' : '#000',
          fontFamily: 'var(--font-ui)',
          fontWeight: 700,
          fontSize: 13,
          transition: 'all 0.2s',
          letterSpacing: '0.02em',
        }}
      >
        {detecting ? '⏳ Detecting…' : '📸 Detect Now'}
      </button>

      {capturedImage && (
        <img
          src={capturedImage}
          alt="Captured"
          style={{ width: '100%', borderRadius: 6, border: '1px solid var(--border)' }}
        />
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  )
}
