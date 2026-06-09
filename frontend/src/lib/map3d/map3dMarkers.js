import { CLASS_COLORS, CLASS_EMOJIS } from '../../constants/classes'

export function detectionEmoji(className) {
  return CLASS_EMOJIS[className] || '📦'
}

export function detectionMarkerHtml(className, selected = false, estimated = false) {
  const emoji = detectionEmoji(className)
  const color = CLASS_COLORS[className] || '#888'
  const size = selected ? 30 : 24
  const fontSize = selected ? 17 : 14
  const border = selected ? '#05CB63' : color
  const selClass = selected ? ' map-detection-symbol--selected' : ''
  const estClass = estimated ? ' map-detection-symbol--estimated' : ''
  const opacity = estimated ? 'opacity:0.55;' : ''

  return `<div class="map-detection-symbol${selClass}${estClass}" style="width:${size}px;height:${size}px;border-color:${border};font-size:${fontSize}px;${opacity}">${emoji}</div>`
}

export function cameraMarkerHtml(color, size = 8) {
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 8px ${color}99;"></div>`
}

export function clusterMarkerHtml(count) {
  const size = count < 10 ? 28 : count < 100 ? 34 : 40
  const fontSize = count < 100 ? 12 : 11
  return `<div class="map3d-cluster-marker" style="width:${size}px;height:${size}px;font-size:${fontSize}px;">${count}</div>`
}
