import { BrowserRouter, Route, Routes } from 'react-router-dom'
import MapPage from './pages/MapPage'
import BatchDashboard from './pages/BatchDashboard'
import DatasetExplorerPage from './pages/DatasetExplorerPage'
import GsvContinuedPage from './pages/GsvContinuedPage'
import GsvMapResultsPage from './pages/GsvMapResultsPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MapPage />} />
        <Route path="/dataset" element={<DatasetExplorerPage />} />
        <Route path="/gsv-continued" element={<GsvContinuedPage />} />
        <Route path="/gsv-continued/map-results/:sessionId" element={<GsvMapResultsPage />} />
        <Route path="/dashboard" element={<BatchDashboard />} />
        <Route path="/dashboard/:jobId" element={<BatchDashboard />} />
      </Routes>
    </BrowserRouter>
  )
}
