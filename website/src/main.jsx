import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthProvider } from './auth/AuthContext.jsx'
import AppLauncher from './AppLauncher.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <AppLauncher />
    </AuthProvider>
  </StrictMode>,
)
