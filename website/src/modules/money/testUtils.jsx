import { render } from '@testing-library/react';
import { AuthProvider } from '../../auth/AuthContext';
import { NavigationProvider } from '../../hooks/useNavigation.jsx';
import { FeedbackProvider } from '../../ui/FeedbackContext';
import { storage } from '../../services/client';
import { invalidateMoneyCache } from '../../services/money';

export const ME = { id: 1, username: 'me', fullName: 'Tôi', role: 'agency', features: {} };

/** Đăng nhập giả + xoá cache dòng tiền trước mỗi test. */
export function setupSession() {
  storage.set('token', 'tok');
  storage.setJSON('authUser', ME);
  window.location.hash = '';
  invalidateMoneyCache();
}

/** Render trong đủ provider như app thật. */
export function renderWithApp(ui) {
  return render(
    <FeedbackProvider>
      <AuthProvider>
        <NavigationProvider>{ui}</NavigationProvider>
      </AuthProvider>
    </FeedbackProvider>,
  );
}
