import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'
import DebtApp from '../DebtApp.jsx'
import PassportApp from '../PassportApp.jsx'

function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/debt" element={<DebtApp />} />
        <Route path="/passport" element={<PassportApp />} />
        <Route path="/" element={<Navigate to="/debt" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)