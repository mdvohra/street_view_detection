/** Toggle between flat Leaflet map and MapLibre 3D map. */
export default function MapModeToggle({ map3dEnabled, onToggle }) {
  return (
    <div className="map-mode-toggle">
      <button type="button" className="dashboard-map-toggle" onClick={onToggle}>
        {map3dEnabled ? '2D map' : '3D map'}
      </button>
    </div>
  )
}
