import { useEffect, useMemo, useState } from 'react';
import {
  LifeBuoy, ArrowLeft, ArrowRight, ChevronRight, Lightbulb, AlertTriangle, SearchX, Rocket, Plane, HandCoins,
  Wallet, Users, Wrench, ShieldCheck, MessageCircleQuestion, BookOpen,
} from 'lucide-react';
import { useAuth } from './auth/AuthContext.jsx';
import { useNavigation } from './hooks/useNavigation.jsx';
import { Badge, Button, EmptyState, PageHeader, SearchInput } from './ui';
import { HELP_GROUPS, HELP_TOPICS } from './help/topics';
import { searchTopics, visibleTopics } from './help/helpSearch';

const DEFAULT_TOPIC = 'start';
const GROUP_ICONS = {
  start: Rocket, sell: Plane, collect: HandCoins, money: Wallet, customers: Users, tools: Wrench, admin: ShieldCheck, faq: MessageCircleQuestion,
};
const groupLabel = (id) => HELP_GROUPS.find((g) => g.id === id)?.label || '';

/** Văn bản có **chữ đậm** (tên nút / ô trên giao diện). */
function Rich({ text }) {
  const parts = String(text).split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((p, i) => (i % 2 ? <b key={i} className="font-semibold text-ink">{p}</b> : p))}</>;
}

function Block({ block }) {
  switch (block.type) {
    case 'steps':
      return (
        <ol className="space-y-3">
          {block.items.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white tabular" aria-hidden="true">
                {i + 1}
              </span>
              <p className="text-[14.5px] leading-relaxed text-ink-soft"><Rich text={s} /></p>
            </li>
          ))}
        </ol>
      );
    case 'tips':
      return (
        <div className="rounded-xl border border-brand-100 bg-brand-50 p-4">
          <p className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-brand-700"><Lightbulb size={15} /> Mẹo</p>
          <ul className="space-y-1.5">
            {block.items.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-soft">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden="true" />
                <span><Rich text={s} /></span>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'warn':
      return (
        <div role="note" className="flex gap-2.5 rounded-xl border border-warning-100 bg-warning-50 p-4 text-sm leading-relaxed text-ink-soft">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-warning-600" />
          <p><Rich text={block.text} /></p>
        </div>
      );
    default:
      return <p className="text-[14.5px] leading-relaxed text-ink-soft"><Rich text={block.text} /></p>;
  }
}

function TopicButton({ topic, active, onSelect, showSummary }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(topic.id)}
      aria-current={active ? 'page' : undefined}
      className={`group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition ${active ? 'bg-brand-50 text-brand-700' : 'text-ink-soft hover:bg-surface-subtle hover:text-ink'}`}
    >
      <span className="min-w-0 flex-1">
        <span className={`block text-sm ${active ? 'font-semibold' : 'font-medium'}`}>{topic.title}</span>
        {showSummary && <span className="mt-0.5 block text-xs text-ink-muted line-clamp-2">{topic.summary}</span>}
      </span>
      <ChevronRight size={15} className={`shrink-0 ${active ? 'text-brand-600' : 'text-ink-faint lg:opacity-0 lg:group-hover:opacity-100'}`} />
    </button>
  );
}

/**
 * Trang "Hướng dẫn sử dụng": #help (mặc định chủ đề Bắt đầu nhanh) và #help/<id>.
 * Desktop: danh sách chủ đề bên trái + nội dung bên phải. Mobile: danh sách trước, chọn → nội dung + nút quay lại.
 */
export default function HelpApp({ param }) {
  const { user, hasFeature } = useAuth();
  const { navigate } = useNavigation();
  const [search, setSearch] = useState('');

  const topics = useMemo(() => visibleTopics(HELP_TOPICS, { role: user?.role, hasFeature }), [user?.role, hasFeature]);
  const byId = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);
  const results = useMemo(() => (search.trim() ? searchTopics(topics, search) : null), [topics, search]);

  const requested = param ? byId.get(param) : null;
  const current = requested || byId.get(DEFAULT_TOPIC) || topics[0];
  const notFound = !!param && !requested;
  const related = (current?.related || []).map((id) => byId.get(id)).filter(Boolean);
  const showTopicOnMobile = !!param;

  // Mobile: mở chủ đề → cuộn lên đầu để thấy tiêu đề.
  useEffect(() => {
    if (!param || typeof window === 'undefined' || window.innerWidth >= 1024) return;
    try { window.scrollTo({ top: 0 }); } catch { /* trình duyệt cũ */ }
  }, [param]);

  const open = (id) => navigate('help', id);

  return (
    <div>
      <PageHeader
        icon={LifeBuoy}
        title="Hướng dẫn sử dụng"
        description="Cách dùng từng trang, ngắn gọn. Gõ từ khoá để tìm nhanh, ví dụ: vé down, huỷ vé, ví."
      />

      <div className="lg:grid lg:grid-cols-[300px_minmax(0,1fr)] lg:items-start lg:gap-5">
        {/* Danh sách chủ đề */}
        <aside className={`${showTopicOnMobile ? 'hidden lg:block' : ''} card p-3 lg:sticky lg:top-4`} aria-label="Danh sách chủ đề">
          <SearchInput value={search} onChange={setSearch} placeholder="Tìm hướng dẫn…" className="mb-3" />
          {results ? (
            results.length ? (
              <div>
                <p className="px-3 pb-1 text-xs text-ink-muted">{results.length} chủ đề khớp</p>
                <ul className="space-y-0.5">
                  {results.map((t) => (
                    <li key={t.id}><TopicButton topic={t} active={t.id === current?.id} onSelect={open} showSummary /></li>
                  ))}
                </ul>
              </div>
            ) : (
              <EmptyState compact icon={SearchX} title="Không tìm thấy hướng dẫn" description="Thử từ khoá ngắn hơn, ví dụ: thanh toán, ví, sao kê." />
            )
          ) : (
            <nav className="space-y-3">
              {HELP_GROUPS.map((g) => {
                const items = topics.filter((t) => t.group === g.id);
                if (!items.length) return null;
                const GIcon = GROUP_ICONS[g.id] || BookOpen;
                return (
                  <div key={g.id}>
                    <p className="mb-1 flex items-center gap-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                      <GIcon size={13} /> {g.label}
                    </p>
                    <ul className="space-y-0.5">
                      {items.map((t) => (
                        <li key={t.id}><TopicButton topic={t} active={t.id === current?.id} onSelect={open} /></li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </nav>
          )}
        </aside>

        {/* Nội dung chủ đề */}
        {current && (
          <article className={`${showTopicOnMobile ? '' : 'hidden lg:block'} card p-5 sm:p-6`} aria-labelledby="help-topic-title">
            <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => navigate('help')} className="mb-3 -ml-2 lg:hidden">
              Danh sách chủ đề
            </Button>
            {notFound && (
              <p className="mb-3 text-sm text-ink-muted">Không tìm thấy chủ đề này, đang hiện phần {current.title}.</p>
            )}
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <Badge tone="brand">{groupLabel(current.group)}</Badge>
                <h2 id="help-topic-title" className="mt-2 text-lg sm:text-xl font-bold tracking-tight text-ink">{current.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">{current.summary}</p>
              </div>
              {current.page && (
                <Button variant="secondary" size="sm" iconRight={ArrowRight} onClick={() => navigate(current.page)}>Mở trang này</Button>
              )}
            </div>

            <div className="space-y-4" data-testid="help-topic-body">
              {current.body.map((b, i) => <Block key={i} block={b} />)}
            </div>

            {related.length > 0 && (
              <div className="mt-6 border-t border-surface-border pt-4">
                <p className="mb-2 text-[13px] font-semibold text-ink">Xem thêm</p>
                <div className="flex flex-wrap gap-2">
                  {related.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => open(t.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-surface-border bg-surface-muted px-3 py-1 text-[13px] font-medium text-ink-soft transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700"
                    >
                      {t.title} <ChevronRight size={13} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
