import { StrictMode, Component } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { applyTheme } from './theme';
applyTheme(); // đồng bộ class .dark với lựa chọn đã lưu (index.html đã đặt sẵn trước khi tải)
import { AuthProvider } from './auth/AuthContext.jsx';
import { NavigationProvider } from './hooks/useNavigation.jsx';
import { FeedbackProvider } from './ui/FeedbackContext.jsx';
import AppLauncher from './AppLauncher.jsx';
import ZaloButton from './components/ZaloButton.jsx';

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('React crash:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-surface-muted">
          <div className="card max-w-xl w-full p-6 text-center">
            <h2 className="text-xl font-bold text-ink">Đã xảy ra lỗi</h2>
            <p className="text-sm text-ink-muted mt-1">Xin lỗi, có lỗi không mong muốn. Hãy tải lại trang.</p>
            <pre className="mt-4 max-h-56 overflow-auto rounded-lg bg-surface-subtle p-3 text-left text-xs text-danger-700 whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
            <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              Tải lại
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <FeedbackProvider>
        <AuthProvider>
          <NavigationProvider>
            <AppLauncher />
          </NavigationProvider>
        </AuthProvider>
      </FeedbackProvider>
      <ZaloButton />
    </ErrorBoundary>
  </StrictMode>,
);
