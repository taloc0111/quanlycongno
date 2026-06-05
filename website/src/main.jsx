import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { AuthProvider } from './auth/AuthContext.jsx'
import AppLauncher from './AppLauncher.jsx'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('React crash:', error, info); }
  render() {
    if (this.state.error) return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2>Đã xảy ra lỗi</h2>
        <pre style={{ color: 'red', whiteSpace: 'pre-wrap', textAlign: 'left', maxWidth: 600, margin: '20px auto' }}>
          {this.state.error.message}{'\n'}{this.state.error.stack}
        </pre>
        <button onClick={() => window.location.reload()} style={{ padding: '8px 20px', marginTop: 16 }}>Tải lại</button>
      </div>
    );
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <AppLauncher />
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
)
