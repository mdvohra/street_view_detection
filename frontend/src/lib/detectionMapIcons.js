import L from 'leaflet'
import { detectionMarkerHtml, detectionEmoji } from './map3d/map3dMarkers'

export { detectionEmoji }

export function makeDetectionSymbolIcon(className, selected = false, estimated = false) {
  const html = detectionMarkerHtml(className, selected, estimated)
  const size = selected ? 30 : 24

  return L.divIcon({
    className: '',
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}
