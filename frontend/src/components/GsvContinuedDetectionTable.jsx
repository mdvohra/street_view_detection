import { CLASS_COLORS, CLASS_EMOJIS } from '../constants/classes'
import { buildGsvDetectionId } from '../api'
import { filterDetections } from '../lib/gsvPanoramaClassFilter'

function formatCoord(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toFixed(6)
}

function formatMethod(method) {
  if (!method) return '—'
  if (method === 'bearing_single') return 'bearing'
  if (method === 'bearing_size') return 'size'
  if (method === 'intersection_corner_snap') return 'corner'
  if (method === 'road_edge_snap') return 'road edge'
  if (method === 'gsv_horizon_ray') return 'horizon'
  if (method === 'gsv_lob_triangulation') return 'multi-loc'
  return method
}

function formatQuality(det) {
  const q = det.geo_quality
  if (q === 'high') return 'verified'
  if (q === 'low') return 'estimated'
  return '—'
}

function formatView(view) {
  if (view == null) return '—'
  if (view >= 1 && view <= 4) return `Side ${view}`
  if (view === 0) return 'Overlay'
  if (view === 5) return 'Sky'
  return `View ${view}`
}

export default function GsvContinuedDetectionTable({
  detectionResult,
  detecting,
  cameraLat,
  cameraLng,
  highlightDetectionId,
  locationId,
  filterClass,
  onFilterClassChange,
}) {
  const allDetections = detectionResult?.detections || []
  const detections = filterDetections(allDetections, filterClass)
  const fallbackLat = cameraLat ?? detectionResult?.lat
  const fallbackLng = cameraLng ?? detectionResult?.lng
  const geoSkipped = detectionResult?.geo_skipped_reason === 'non_horizontal_view'

  function handleRowClick(det) {
    if (!onFilterClassChange || !det.class) return
    onFilterClassChange(filterClass === det.class ? null : det.class)
  }

  if (detecting && !allDetections.length) {
    return (
      <div className="dashboard-table-empty" style={{ padding: '12px 16px' }}>
        Building 360° panorama… views 1–4
      </div>
    )
  }

  if (!detectionResult) {
    return (
      <div className="dashboard-table-empty" style={{ padding: '12px 16px' }}>
        Select a location to run detection
      </div>
    )
  }

  if (!allDetections.length) {
    return (
      <div className="dashboard-table-empty" style={{ padding: '12px 16px' }}>
        No objects detected
      </div>
    )
  }

  if (filterClass && !detections.length) {
    return (
      <div className="dashboard-table-empty" style={{ padding: '12px 16px' }}>
        No {filterClass} detections at this location
      </div>
    )
  }

  const indexedRows = allDetections
    .map((det, origIndex) => ({ det, origIndex }))
    .filter(({ det }) => !filterClass || det.class === filterClass)

  return (
    <div className="dashboard-table-scroll" style={{ flex: 1, minHeight: 0 }}>
      {filterClass && (
        <div
          style={{
            padding: '8px 12px',
            fontSize: 11,
            color: 'var(--green)',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(5, 203, 99, 0.08)',
          }}
        >
          Showing {filterClass} only · click row again to show all
        </div>
      )}
      {geoSkipped && (
        <div
          style={{
            padding: '8px 12px',
            fontSize: 11,
            color: 'var(--muted)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          Map estimates unavailable for this view (overlay/sky).
        </div>
      )}
      <table className="dashboard-table">
        <thead>
          <tr>
            <th className="dashboard-table-col-num">#</th>
            <th>Object</th>
            <th>View</th>
            <th>Conf</th>
            <th>Bearing</th>
            <th>Dist</th>
            <th>Method</th>
            <th>Quality</th>
            <th className="dashboard-table-col-coord">Cam lat</th>
            <th className="dashboard-table-col-coord">Cam lng</th>
            <th className="dashboard-table-col-coord">Est lat</th>
            <th className="dashboard-table-col-coord">Est lng</th>
            <th>Model</th>
          </tr>
        </thead>
        <tbody>
          {indexedRows.map(({ det, origIndex }, i) => {
            const color = CLASS_COLORS[det.class] || 'var(--text)'
            const camLat = det.camera_lat ?? fallbackLat
            const camLng = det.camera_lng ?? fallbackLng
            const detId =
              locationId != null
                ? buildGsvDetectionId(locationId, det.view ?? 0, origIndex)
                : null
            const highlighted = highlightDetectionId && detId === highlightDetectionId
            const classActive = filterClass && det.class === filterClass
            const clickable = Boolean(onFilterClassChange)

            return (
              <tr
                key={`${det.class}-${origIndex}`}
                className={`dashboard-table-row${highlighted ? ' dashboard-table-row--highlight' : ''}${classActive ? ' dashboard-table-row--filter-active' : ''}`}
                onClick={clickable ? () => handleRowClick(det) : undefined}
                style={clickable ? { cursor: 'pointer' } : undefined}
                title={clickable ? 'Click to filter by this class' : undefined}
              >
                <td className="dashboard-table-num">{i + 1}</td>
                <td>
                  <span style={{ marginRight: 4 }}>{CLASS_EMOJIS[det.class] || '📦'}</span>
                  <span style={{ fontWeight: 600, color }}>{det.class}</span>
                </td>
                <td style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                  {formatView(det.view)}
                </td>
                <td className="dashboard-table-coord" style={{ fontFamily: 'var(--font-mono)' }}>
                  {(det.confidence * 100).toFixed(0)}%
                </td>
                <td className="dashboard-table-coord" style={{ fontFamily: 'var(--font-mono)' }}>
                  {det.bearing_deg != null ? `${Number(det.bearing_deg).toFixed(1)}°` : '—'}
                </td>
                <td className="dashboard-table-coord" style={{ fontFamily: 'var(--font-mono)' }}>
                  {det.geo_distance_m != null ? `${Number(det.geo_distance_m).toFixed(0)} m` : '—'}
                </td>
                <td style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                  {formatMethod(det.geo_method)}
                </td>
                <td style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: det.geo_quality === 'high' ? 'var(--green)' : 'var(--muted)' }}>
                  {formatQuality(det)}
                </td>
                <td className="dashboard-table-coord">{formatCoord(camLat)}</td>
                <td className="dashboard-table-coord">{formatCoord(camLng)}</td>
                <td className="dashboard-table-coord dashboard-table-coord-est">
                  {formatCoord(det.geo_lat)}
                </td>
                <td className="dashboard-table-coord dashboard-table-coord-est">
                  {formatCoord(det.geo_lng)}
                </td>
                <td style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
                  {det.source_model || '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
