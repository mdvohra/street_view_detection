import { useEffect, useRef } from 'react'
import { annotatedImageUrl } from '../api'

export default function ImageThumbGrid({ jobId, results, selectedIndex, onSelect }) {
  const scrollRef = useRef(null)
  const activeRef = useRef(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [selectedIndex])

  if (!jobId || !results.length) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: 'var(--muted)', textAlign: 'center' }}>
        No thumbnails
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      style={{
        display: 'flex',
        gap: 6,
        padding: 8,
        overflowX: 'auto',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface)',
      }}
    >
      {results.map((r, i) => (
        <button
          key={r.image_id}
          type="button"
          ref={i === selectedIndex ? activeRef : null}
          onClick={() => onSelect(i)}
          style={{
            flex: '0 0 60px',
            height: 45,
            padding: 0,
            border: i === selectedIndex ? '2px solid var(--green)' : '1px solid var(--border)',
            borderRadius: 6,
            overflow: 'hidden',
            cursor: 'pointer',
            background: '#000',
            opacity: i === selectedIndex ? 1 : 0.85,
          }}
        >
          <img
            src={annotatedImageUrl(jobId, r.image_id)}
            alt=""
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        </button>
      ))}
    </div>
  )
}
