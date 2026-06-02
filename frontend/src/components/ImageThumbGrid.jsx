import { useEffect, useRef } from 'react'
import { annotatedImageUrl } from '../api'

export default function ImageThumbGrid({ jobId, results, selectedIndex, onSelect }) {
  const activeRef = useRef(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [selectedIndex])

  if (!jobId || !results.length) {
    return (
      <div className="dashboard-thumbs" style={{ justifyContent: 'center' }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', padding: '8px 0' }}>No thumbnails</span>
      </div>
    )
  }

  return (
    <div className="dashboard-thumbs">
      {results.map((r, i) => (
        <button
          key={r.image_id}
          type="button"
          ref={i === selectedIndex ? activeRef : null}
          className={`dashboard-thumb${i === selectedIndex ? ' active' : ''}`}
          onClick={() => onSelect(i)}
          aria-label={`Image ${i + 1}`}
        >
          <img src={annotatedImageUrl(jobId, r.image_id)} alt="" loading="lazy" />
        </button>
      ))}
    </div>
  )
}
