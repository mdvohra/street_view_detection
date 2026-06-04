import { useCallback, useEffect, useMemo, useState } from 'react'

import { Link } from 'react-router-dom'

import toast from 'react-hot-toast'

import { Toaster } from 'react-hot-toast'

import { apiErrorMessage, detectDatasetImage, getDatasetMeta, getDatasetPoints } from '../api'

import DatasetImagePanel from '../components/DatasetImagePanel'

import DatasetMap from '../components/DatasetMap'

import '../dashboard.css'



export default function DatasetExplorerPage() {

  const [points, setPoints] = useState([])

  const [meta, setMeta] = useState(null)

  const [loadingMeta, setLoadingMeta] = useState(true)

  const [loadingPoints, setLoadingPoints] = useState(true)

  const [selectedId, setSelectedId] = useState(null)

  const [detectionResult, setDetectionResult] = useState(null)

  const [detecting, setDetecting] = useState(false)

  const [basemap, setBasemap] = useState('street')



  useEffect(() => {

    let cancelled = false



    async function loadDataset() {

      setLoadingMeta(true)

      setLoadingPoints(true)

      setMeta(null)

      setPoints([])



      try {

        const metaRes = await getDatasetMeta()

        if (cancelled) return

        setMeta(metaRes.data)

        setLoadingMeta(false)



        const pointsRes = await getDatasetPoints()

        if (cancelled) return

        setPoints(pointsRes.data.points || [])

      } catch (err) {

        if (cancelled) return

        toast.error(apiErrorMessage(err, 'Failed to load dataset'))

      } finally {

        if (!cancelled) {

          setLoadingMeta(false)

          setLoadingPoints(false)

        }

      }

    }



    loadDataset()

    return () => {

      cancelled = true

    }

  }, [])



  const selectedPoint = useMemo(

    () => points.find((p) => p.id === selectedId) || null,

    [points, selectedId]

  )



  const handleSelectPoint = useCallback((id) => {

    setSelectedId(id)

    setDetectionResult(null)

  }, [])



  const handleRunDetection = useCallback(async () => {

    if (selectedId == null) return

    setDetecting(true)

    try {

      const res = await detectDatasetImage(selectedId)

      setDetectionResult(res.data)

      toast.success('Detection complete')

    } catch (err) {

      toast.error(apiErrorMessage(err, 'Detection failed'))

    } finally {

      setDetecting(false)

    }

  }, [selectedId])



  const subtitle = loadingMeta

    ? 'Loading dataset…'

    : meta

      ? loadingPoints

        ? `${meta.count.toLocaleString()} images · loading map points…`

        : `${meta.count.toLocaleString()} images · click a dot to preview`

      : 'Dataset unavailable'



  return (

    <div className="dashboard-root">

      <header className="dashboard-header">

        <Link to="/" className="dashboard-back">

          ← Map

        </Link>

        <div className="dashboard-title-block">

          <h1 className="dashboard-title">Google Street View &amp; Detection</h1>

          <p className="dashboard-subtitle">{subtitle}</p>

        </div>

      </header>



      <div className="dashboard-body" style={{ gap: 0, flex: 1, minHeight: 0 }}>

        <section

          className="dashboard-panel dashboard-panel-map"

          style={{ flex: '0 0 60%', borderRadius: 0, borderTop: 'none', borderBottom: 'none', borderLeft: 'none' }}

        >

          {loadingMeta ? (

            <div

              style={{

                flex: 1,

                display: 'flex',

                alignItems: 'center',

                justifyContent: 'center',

                color: 'var(--muted)',

              }}

            >

              Loading map…

            </div>

          ) : (

            <DatasetMap

              points={points}

              selectedId={selectedId}

              onSelectPoint={handleSelectPoint}

              basemap={basemap}

              onBasemapToggle={() => setBasemap((b) => (b === 'street' ? 'satellite' : 'street'))}

            />

          )}

        </section>



        <section

          className="dashboard-panel"

          style={{

            flex: '0 0 40%',

            borderRadius: 0,

            borderTop: 'none',

            borderBottom: 'none',

            borderRight: 'none',

            minWidth: 0,

          }}

        >

          <DatasetImagePanel

            selectedId={selectedId}

            point={selectedPoint}

            detectionResult={detectionResult}

            detecting={detecting}

            onRunDetection={handleRunDetection}

          />

        </section>

      </div>



      <Toaster

        position="bottom-left"

        toastOptions={{

          style: {

            background: 'var(--surface2)',

            color: 'var(--text)',

            border: '1px solid var(--border)',

          },

        }}

      />

    </div>

  )

}


