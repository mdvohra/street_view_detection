import L from 'leaflet'
import { CLASS_COLORS, CLASS_EMOJIS } from '../constants/classes'

export function detectionEmoji(className) {
  return CLASS_EMOJIS[className] || '📦'
}

export function makeDetectionSymbolIcon(className, selected = false) {
  const emoji = detectionEmoji(className)
  const color = CLASS_COLORS[className] || '#888'
  const size = selected ? 30 : 24
  const fontSize = selected ? 17 : 14

  return L.divIcon({
    className: '',
    html: `<div class="map-detection-symbol${selected ? ' map-detection-symbol--selected' : ''}" style="
      width:${size}px;height:${size}px;
      border-color:${selected ? '#05CB63' : color};
      font-size:${fontSize}px;
    ">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}
