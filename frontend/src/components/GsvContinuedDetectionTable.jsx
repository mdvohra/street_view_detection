import { CLASS_COLORS, CLASS_EMOJIS } from '../constants/classes'

function formatCoord(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toFixed(6)
}

export default function GsvContinuedDetectionTable({
  detectionResult,
  detecting,
  cameraLat,
  cameraLng,
}) {
  const detections = detectionResult?.detections || []
  const fallbackLat = cameraLat ?? detectionResult?.lat
  const fallbackLng = cameraLng ?? detectionResult?.lng

  if (detecting && !detections.length) {
    return (
      <div className="dashboard-table-empty" style={{ padding: '12px 16px' }}>
        Running detection…
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
      <table className="dashboard-table">
        <thead>
          <tr>
            <th className="dashboard-table-col-num">#</th>
            <th>Object</th>
            <th>Conf</th>
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

            return (
              <tr key={`${det.class}-${i}`} className="dashboard-table-row">
                <td className="dashboard-table-num">{i + 1}</td>
                <td>
                  <span style={{ marginRight: 4 }}>{CLASS_EMOJIS[det.class] || '📦'}</span>
                  <span style={{ fontWeight: 600, color }}>{det.class}</span>
                </td>
                <td className="dashboard-table-coord" style={{ fontFamily: 'var(--font-mono)' }}>
                  {(det.confidence * 100).toFixed(0)}%
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
