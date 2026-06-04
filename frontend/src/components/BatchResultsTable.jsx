import { useEffect, useRef } from 'react'
import { CLASS_COLORS, CLASS_EMOJIS } from '../constants/classes'

function primaryGeo(row) {
  const dets = (row.detections || []).filter((d) => d.geo_lat != null && d.geo_lng != null)
  if (!dets.length) return null
  const d = dets[0]
  return { lat: d.geo_lat, lng: d.geo_lng, method: d.geo_method }
}

function detectionSummary(result, filterClass) {
  const counts = result.counts || {}
  const entries = Object.entries(counts).filter(([, n]) => n > 0)
  if (filterClass) {
    const n = counts[filterClass] || 0
    if (!n) return null
    return [{ class: filterClass, count: n }]
  }
  return entries.map(([cls, count]) => ({ class: cls, count }))
}

export default function BatchResultsTable({
  results,
  selectedIndex,
  onSelect,
  filterClass,
  loadingMore,
}) {
  const activeRef = useRef(null)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedIndex])

  if (!results.length) {
    return (
      <div className="dashboard-table-empty">
        {filterClass ? 'No rows match this class filter' : 'No results loaded yet'}
      </div>
    )
  }

  return (
    <div className="dashboard-table-scroll">
      <table className="dashboard-table">
        <thead>
          <tr>
            <th className="dashboard-table-col-num">#</th>
            <th className="dashboard-table-col-coord">Cam lat</th>
            <th className="dashboard-table-col-coord">Cam lng</th>
            <th className="dashboard-table-col-coord">Est lat</th>
            <th className="dashboard-table-col-coord">Est lng</th>
            <th>Detections</th>
            <th className="dashboard-table-col-total">Total</th>
          </tr>
        </thead>
        <tbody>
          {results.map((row, i) => {
            const summary = detectionSummary(row, filterClass)
            const total =
              summary?.reduce((s, x) => s + x.count, 0) ??
              Object.values(row.counts || {}).reduce((a, b) => a + b, 0)
            const isActive = i === selectedIndex
            const geo = primaryGeo(row)

            return (
              <tr
                key={row.image_id}
                ref={isActive ? activeRef : null}
                className={`dashboard-table-row${isActive ? ' active' : ''}`}
                onClick={() => onSelect(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSelect(i)
                  }
                }}
                tabIndex={0}
                role="button"
                aria-selected={isActive}
                aria-label={`Row ${i + 1}, ${total} detections`}
              >
                <td className="dashboard-table-num">{i + 1}</td>
                <td className="dashboard-table-coord">
                  {row.lat != null ? Number(row.lat).toFixed(6) : '—'}
                </td>
                <td className="dashboard-table-coord">
                  {row.lng != null ? Number(row.lng).toFixed(6) : '—'}
                </td>
                <td className="dashboard-table-coord dashboard-table-coord-est">
                  {geo?.lat != null ? Number(geo.lat).toFixed(6) : '—'}
                </td>
                <td className="dashboard-table-coord dashboard-table-coord-est">
                  {geo?.lng != null ? Number(geo.lng).toFixed(6) : '—'}
                </td>
                <td>
                  <div className="dashboard-table-tags">
                    {summary?.length ? (
                      summary.map(({ class: cls, count }) => (
                        <span
                          key={cls}
                          className="dashboard-table-tag"
                          style={{
                            borderColor: `${CLASS_COLORS[cls] || '#666'}55`,
                            color: CLASS_COLORS[cls] || 'var(--text)',
                          }}
                        >
                          {CLASS_EMOJIS[cls] || '•'} {cls}
                          <span className="dashboard-table-tag-count">×{count}</span>
                        </span>
                      ))
                    ) : (
                      <span className="dashboard-table-none">—</span>
                    )}
                  </div>
                </td>
                <td className="dashboard-table-total">{total}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {loadingMore && (
        <div className="dashboard-table-loading">Loading more rows…</div>
      )}
    </div>
  )
}
