import { createContext, useCallback, useContext, useState } from 'react'

const Ctx = createContext(null)

const EMPTY_COUNTS = {
  Car: 0,
  Tree: 0,
  'Street Light': 0,
  Pole: 0,
  Building: 0,
  Motorcycle: 0,
  Person: 0,
  'Traffic Signal': 0,
}

export function DetectionProvider({ children }) {
  const [markers, setMarkers] = useState([])
  const [globalCounts, setGlobalCounts] = useState({ ...EMPTY_COUNTS })
  const [activeDetection, setActiveDetection] = useState(null)
  const [mapillaryToken, setMapillaryToken] = useState(null)
  const [showMapillaryCoverage, setShowMapillaryCoverage] = useState(true)
  const [modelInfo, setModelInfo] = useState(null)
  const [models, setModels] = useState(null)

  const addDetection = useCallback((result) => {
    setMarkers((prev) => [...prev, { ...result, id: Date.now() + Math.random() }])
    setGlobalCounts((prev) => {
      const next = { ...prev }
      for (const [cls, n] of Object.entries(result.counts || {})) {
        next[cls] = (next[cls] || 0) + n
      }
      return next
    })
    setActiveDetection({ ...result, timestamp: new Date().toISOString() })
  }, [])

  return (
    <Ctx.Provider
      value={{
        markers,
        globalCounts,
        activeDetection,
        mapillaryToken,
        setMapillaryToken,
        showMapillaryCoverage,
        setShowMapillaryCoverage,
        modelInfo,
        setModelInfo,
        models,
        setModels,
        addDetection,
        setActiveDetection,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export const useDetections = () => useContext(Ctx)
