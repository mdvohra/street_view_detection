import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { useDetections } from '../context/DetectionContext'
import { detectCamera } from '../api'

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Could not read file'))
    reader.readAsDataURL(file)
  })
}

export default function CameraView() {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const fileInputRef = useRef(null)
  const streamRef = useRef(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
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
    setPreviewImage(null)
    await startCamera()
  }

  const handleCloseCamera = () => {
    stopCamera()
    setCameraOpen(false)
  }

  const runDetection = async (b64, source, sourceLabel) => {
    setDetecting(true)
    setPreviewImage(b64)

    try {
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
      addDetection({ ...data, source })

      const total = Object.values(data.counts || {}).reduce((a, b) => a + b, 0)
      toast.success(`${sourceLabel}: ${total} objects detected`, { icon: '🔍' })
    } catch (_) {
      toast.error(`${sourceLabel} detection failed.`)
    } finally {
      setDetecting(false)
    }
  }

  const handleDetectFromCamera = async () => {
    if (!streaming || detecting) return

    const canvas = canvasRef.current
    const video = videoRef.current
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const b64 = canvas.toDataURL('image/jpeg', 0.85)
    await runDetection(b64, 'camera', 'Camera')
  }

  const handleUploadClick = () => {
    if (detecting) return
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || detecting) return

    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file (JPEG, PNG, etc.)')
      return
    }

    const maxMb = 15
    if (file.size > maxMb * 1024 * 1024) {
      toast.error(`Image must be under ${maxMb} MB`)
      return
    }

    try {
      const b64 = await readFileAsDataUrl(file)
      await runDetection(b64, 'upload', 'Upload')
    } catch (_) {
      toast.error('Could not read that image.')
    }
  }

  const btnBase = {
    padding: '10px 0',
    borderRadius: 8,
    fontFamily: 'var(--font-ui)',
    fontWeight: 700,
    fontSize: 13,
    cursor: 'pointer',
    flex: 1,
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
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <div
          style={{
            fontSize: 11,
            color: 'var(--muted)',
            fontFamily: 'var(--font-mono)',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
          }}
        >
          📷 Camera or upload
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>
          Map clicks use street photos. Use the camera or upload your own image to run detection.
        </p>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={handleOpenCamera}
            disabled={detecting}
            style={{
              ...btnBase,
              border: '1px solid var(--border)',
              background: 'var(--green-dim)',
              color: 'var(--green)',
              opacity: detecting ? 0.6 : 1,
            }}
          >
            Open Camera
          </button>
          <button
            type="button"
            onClick={handleUploadClick}
            disabled={detecting}
            style={{
              ...btnBase,
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              color: 'var(--text)',
              opacity: detecting ? 0.6 : 1,
            }}
          >
            {detecting ? '⏳ Detecting…' : '📁 Upload Image'}
          </button>
        </div>

        {previewImage && (
          <img
            src={previewImage}
            alt="Last capture or upload"
            style={{ width: '100%', borderRadius: 6, border: '1px solid var(--border)' }}
          />
        )}
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
        onClick={handleDetectFromCamera}
        disabled={!streaming || detecting}
        style={{
          ...btnBase,
          flex: 'none',
          border: 'none',
          background: detecting ? 'var(--surface2)' : 'var(--green)',
          color: detecting ? 'var(--muted)' : '#000',
          cursor: streaming && !detecting ? 'pointer' : 'default',
        }}
      >
        {detecting ? '⏳ Detecting…' : '📸 Detect Now'}
      </button>

      {previewImage && (
        <img
          src={previewImage}
          alt="Captured"
          style={{ width: '100%', borderRadius: 6, border: '1px solid var(--border)' }}
        />
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  )
}
