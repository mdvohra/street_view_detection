import { CLASS_COLORS, CLASS_EMOJIS } from '../constants/classes'
import { buildGsvDetectionId } from '../api'

function formatCoord(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toFixed(6)
}

function formatMethod(method) {
  if (!method) return '—'
  if (method === 'bearing_single') return 'bearing'
  if (method === 'bearing_size') return 'size'
  return method
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
}) {
  const detections = detectionResult?.detections || []
  const fallbackLat = cameraLat ?? detectionResult?.lat
  const fallbackLng = cameraLng ?? detectionResult?.lng
  const geoSkipped = detectionResult?.geo_skipped_reason === 'non_horizontal_view'

  if (detecting && !detections.length) {
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

  if (!detections.length) {
    return (
      <div className="dashboard-table-empty" style={{ padding: '12px 16px' }}>
        No objects detected
      </div>
    )
  }

  return (
    <div className="dashboard-table-scroll" style={{ flex: 1, minHeight: 0 }}>
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
            <th className="dashboard-table-col-coord">Cam lat</th>
            <th className="dashboard-table-col-coord">Cam lng</th>
            <th className="dashboard-table-col-coord">Est lat</th>
            <th className="dashboard-table-col-coord">Est lng</th>
            <th>Model</th>
          </tr>
        </thead>
        <tbody>
          {detections.map((det, i) => {
            const color = CLASS_COLORS[det.class] || 'var(--text)'
            const camLat = det.camera_lat ?? fallbackLat
            const camLng = det.camera_lng ?? fallbackLng
            const detId =
              locationId != null
                ? buildGsvDetectionId(locationId, det.view ?? 0, i)
                : null
            const highlighted = highlightDetectionId && detId === highlightDetectionId

            return (
              <tr
                key={`${det.class}-${i}`}
                className={`dashboard-table-row${highlighted ? ' dashboard-table-row--highlight' : ''}`}
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
