import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HelpApp from '../HelpApp';
import { PageHeader } from '../ui';
import { useNavigation } from '../hooks/useNavigation.jsx';
import { mockApi } from '../test/mockApi';
import { storage } from '../services/client';
import { ME, renderWithApp, setupSession } from '../modules/money/testUtils';
import { HELP_GROUPS, HELP_TOPICS } from './topics';
import { normalize, searchTopics, visibleTopics } from './helpSearch';

const ids = new Set(HELP_TOPICS.map((t) => t.id));

// Mã nguồn mọi file .jsx (trừ test) — kiểm tra kiểu grep: id dùng ở help="…" / helpTopic phải tồn tại.
const SOURCES = import.meta.glob(['../**/*.jsx', '!../**/*.test.jsx'], { query: '?raw', import: 'default', eager: true });

function usedHelpIds() {
  const used = [];
  for (const [file, src] of Object.entries(SOURCES)) {
    for (const m of src.matchAll(/\bhelp="([^"]+)"/g)) used.push({ file, id: m[1] });
    for (const m of src.matchAll(/\bhelpTopic:\s*'([^']+)'/g)) used.push({ file, id: m[1] });
  }
  return used;
}

/** Đọc param từ hash như AppLauncher, để bấm chủ đề là đổi nội dung thật. */
function HelpHarness() {
  const { key, param } = useNavigation();
  return <HelpApp param={key === 'help' ? param : null} />;
}

function loginAs(user) {
  storage.set('token', 'tok');
  storage.setJSON('authUser', user);
  mockApi({ 'GET /auth/profile': user });
}

beforeEach(() => {
  setupSession();
  mockApi({ 'GET /auth/profile': ME });
});

describe('help topics data', () => {
  it('every topic has id, group, title, summary and body', () => {
    const groups = new Set(HELP_GROUPS.map((g) => g.id));
    expect(ids.size).toBe(HELP_TOPICS.length); // id không trùng
    for (const t of HELP_TOPICS) {
      expect(t.id, t.id).toMatch(/^[a-z-]+$/);
      expect(groups.has(t.group), `${t.id}.group`).toBe(true);
      expect(t.title?.trim(), `${t.id}.title`).toBeTruthy();
      expect(t.summary?.trim(), `${t.id}.summary`).toBeTruthy();
      expect(Array.isArray(t.body) && t.body.length > 0, `${t.id}.body`).toBe(true);
      for (const b of t.body) {
        expect(['p', 'steps', 'tips', 'warn']).toContain(b.type);
        if (b.type === 'steps' || b.type === 'tips') expect(b.items.length).toBeGreaterThan(0);
        else expect(b.text?.trim()).toBeTruthy();
      }
    }
  });

  it('has the fixed topic ids other pages link to', () => {
    for (const id of ['start', 'debts', 'cost', 'cost-pending', 'payments', 'receipts', 'cancel', 'change', 'wallets', 'accounts',
      'transfers', 'statement', 'expenses', 'suppliers', 'qr', 'customers', 'other-services', 'upcoming', 'fare-watch', 'agency',
      'deposits', 'invoices', 'audit', 'notes', 'faq']) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it('all related ids exist and are not self links', () => {
    for (const t of HELP_TOPICS) {
      for (const r of t.related || []) {
        expect(ids.has(r), `${t.id} → ${r}`).toBe(true);
        expect(r).not.toBe(t.id);
      }
    }
  });

  it('every help="…" / helpTopic used in the codebase points to an existing topic', () => {
    const used = usedHelpIds();
    expect(used.length).toBeGreaterThanOrEqual(20); // PageHeader các trang + 4 config dịch vụ
    for (const u of used) expect(ids.has(u.id), `${u.file}: ${u.id}`).toBe(true);
    expect(used.some((u) => u.file.endsWith('serviceConfigs.jsx') && u.id === 'debts')).toBe(true);
  });

  it('page fields point to real menu keys', () => {
    const app = Object.entries(SOURCES).find(([f]) => f.endsWith('AppLauncher.jsx'))[1];
    for (const t of HELP_TOPICS.filter((x) => x.page)) expect(app, `${t.id}.page`).toContain(`key: '${t.page}'`);
  });
});

describe('help search', () => {
  it('is diacritic-insensitive', () => {
    expect(normalize('Vé Đổi **Hoàn tác huỷ**')).toBe('ve doi hoan tac huy');
    const res = searchTopics(HELP_TOPICS, 've down');
    expect(res[0].id).toBe('cost');
    expect(res.map((t) => t.id)).not.toContain('notes');
    expect(searchTopics(HELP_TOPICS, 'SAO KE').map((t) => t.id)).toContain('statement');
  });

  it('hides topics by role and feature', () => {
    const user = visibleTopics(HELP_TOPICS, { role: 'user', hasFeature: () => false }).map((t) => t.id);
    expect(user).not.toContain('agency');
    expect(user).not.toContain('audit');
    expect(user).not.toContain('fare-watch');
    const agency = visibleTopics(HELP_TOPICS, { role: 'agency', hasFeature: (k) => k === 'fareWatch' }).map((t) => t.id);
    expect(agency).toEqual(expect.arrayContaining(['agency', 'audit', 'fare-watch']));
  });
});

describe('HelpApp', () => {
  it('renders the default topic (Bắt đầu nhanh) with numbered steps', async () => {
    renderWithApp(<HelpApp />);
    expect(screen.getByRole('heading', { name: 'Hướng dẫn sử dụng' })).toBeInTheDocument();
    const article = screen.getByRole('article');
    expect(within(article).getByRole('heading', { name: 'Bắt đầu nhanh' })).toBeInTheDocument();
    expect(within(article).getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
    expect(within(article).getByText('Mẹo')).toBeInTheDocument();
  });

  it('opens the topic given by param', () => {
    renderWithApp(<HelpApp param="cancel" />);
    const article = screen.getByRole('article');
    expect(within(article).getByRole('heading', { name: 'Huỷ / hoàn vé và Hoàn tác huỷ' })).toBeInTheDocument();
    expect(within(article).getByRole('note')).toHaveTextContent('Hoàn tác huỷ');
    expect(within(article).getByRole('button', { name: /Mở trang này/ })).toBeInTheDocument();
  });

  it('falls back to the default topic for an unknown id', () => {
    renderWithApp(<HelpApp param="khong-co" />);
    expect(within(screen.getByRole('article')).getByRole('heading', { name: 'Bắt đầu nhanh' })).toBeInTheDocument();
    expect(screen.getByText(/Không tìm thấy chủ đề này/)).toBeInTheDocument();
  });

  it('search filters topics without diacritics and clicking opens the topic', async () => {
    window.location.hash = '#help';
    renderWithApp(<HelpHarness />);
    await userEvent.type(screen.getByPlaceholderText('Tìm hướng dẫn…'), 've down');
    const list = screen.getByRole('complementary', { name: 'Danh sách chủ đề' });
    expect(within(list).getByText(/chủ đề khớp/)).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /^Ghi chú/ })).not.toBeInTheDocument();
    await userEvent.click(within(list).getByRole('button', { name: /Giá vốn nhiều khoản & Vé down/ }));
    expect(window.location.hash).toBe('#help/cost');
    expect(await within(screen.getByRole('article')).findByRole('heading', { name: 'Giá vốn nhiều khoản & Vé down' })).toBeInTheDocument();

    await userEvent.clear(screen.getByPlaceholderText('Tìm hướng dẫn…'));
    await userEvent.type(screen.getByPlaceholderText('Tìm hướng dẫn…'), 'zzzz');
    expect(screen.getByText('Không tìm thấy hướng dẫn')).toBeInTheDocument();
  });

  it('related chips navigate to the related topic', async () => {
    window.location.hash = '#help/cost-pending';
    renderWithApp(<HelpHarness />);
    const article = screen.getByRole('article');
    await userEvent.click(within(article).getByRole('button', { name: /Giá vốn nhiều khoản & Vé down/ }));
    expect(window.location.hash).toBe('#help/cost');
  });

  it('hides role-restricted topics for role user', () => {
    loginAs({ ...ME, role: 'user', features: {} });
    renderWithApp(<HelpApp />);
    const list = screen.getByRole('complementary', { name: 'Danh sách chủ đề' });
    expect(within(list).queryByRole('button', { name: /Quản lý đại lý/ })).not.toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /Nhật ký thao tác/ })).not.toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /Canh vé & Check vé/ })).not.toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Ví trả trước/ })).toBeInTheDocument();
  });

  it('shows role-restricted topics for agency', () => {
    renderWithApp(<HelpApp param="agency" />);
    expect(within(screen.getByRole('article')).getByRole('heading', { name: 'Quản lý đại lý' })).toBeInTheDocument();
  });
});

describe('PageHeader help button', () => {
  it('renders the help button and sets location.hash', async () => {
    window.location.hash = '';
    render(<PageHeader title="Tài khoản tiền" help="accounts" />);
    await userEvent.click(screen.getByRole('button', { name: 'Hướng dẫn trang này' }));
    expect(window.location.hash).toBe('#help/accounts');
  });

  it('has no help button without the prop', () => {
    render(<PageHeader title="Tổng quan" />);
    expect(screen.queryByRole('button', { name: 'Hướng dẫn trang này' })).not.toBeInTheDocument();
  });
});
