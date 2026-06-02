import { BrowserRouter, Route, Routes } from 'react-router-dom'
import MapPage from './pages/MapPage'
import BatchDashboard from './pages/BatchDashboard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MapPage />} />
        <Route path="/dashboard" element={<BatchDashboard />} />
        <Route path="/dashboard/:jobId" element={<BatchDashboard />} />
      </Routes>
    </BrowserRouter>
  )
}
