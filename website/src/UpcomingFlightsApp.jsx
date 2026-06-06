import React, { useEffect, useMemo, useState } from 'react';
import { PlaneTakeoff, Check, Clock, RefreshCw, ExternalLink } from 'lucide-react';
import { apiGet, apiSend } from './services/client';
import Toast from './components/Toast';
import { useToast } from './hooks/useFeedback';
import { detectAirline } from './utils/airlines';

const toYmd = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
const fmt = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '');

export default function UpcomingFlightsApp() {
  const [debts, setDebts] = useState([]);
  const [airlines, setAirlines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onlyPending, setOnlyPending] = useState(false);
  const { toast, showToast } = useToast();

  const today = toYmd(new Date());

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setDebts(await apiGet('/debts'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { apiGet('/airlines').then(setAirlines).catch(() => {}); }, []);

  const dayDiff = (ymd) => Math.round((new Date(ymd + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);

  // Gom các vé có ngày bay trong 0..7 ngày tới (bỏ vé quá khứ), theo nhóm.
  const groups = useMemo(() => {
    const buckets = { today: [], tomorrow: [], soon: [] };
    debts.forEach((d) => {
      const fd = (d.flight_date || '').slice(0, 10);
      if (!fd) return;
      const diff = dayDiff(fd);
      if (diff < 0 || diff > 7) return;
      if (onlyPending && d.checked_in) return;
      if (diff === 0) buckets.today.push(d);
      else if (diff === 1) buckets.tomorrow.push(d);
      else buckets.soon.push(d);
    });
    const byDate = (a, b) => (a.flight_date || '').localeCompare(b.flight_date || '');
    buckets.today.sort(byDate); buckets.tomorrow.sort(byDate); buckets.soon.sort(byDate);
    return buckets;
  }, [debts, onlyPending, today]);

  const toggleCheckin = async (d) => {
    const next = !d.checked_in;
    setDebts((prev) => prev.map((x) => (x.id === d.id ? { ...x, checked_in: next } : x)));
    try {
      await apiSend('PUT', `/debts/${d.id}/checkin`, { checkedIn: next });
    } catch (err) {
      setDebts((prev) => prev.map((x) => (x.id === d.id ? { ...x, checked_in: !next } : x)));
      showToast('Lỗi: ' + err.message, 'error');
    }
  };

  const Section = ({ title, items, accent }) => (
    <div className="mb-6">
      <h3 className={`text-sm font-bold uppercase tracking-wide mb-2 ${accent}`}>{title} ({items.length})</h3>
      {items.length === 0 ? (
        <p className="text-gray-400 text-sm">Không có chuyến nào.</p>
      ) : (
        <div className="space-y-2">
          {items.map((d) => {
            const airline = detectAirline(d.airline, airlines);
            return (
            <div key={d.id} className={`flex items-center gap-3 bg-white rounded-xl border px-4 py-3 ${d.checked_in ? 'border-green-200 opacity-70' : 'border-gray-200'}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-gray-900 truncate">{d.customer_name}{d.phone_number ? <span className="text-xs text-gray-400 font-normal"> · {d.phone_number}</span> : null}</p>
                <p className="text-sm text-gray-600">
                  <span className="font-medium">{d.route || '—'}</span>
                  {d.airline ? <span className="text-gray-400"> · {airline?.name || d.airline}</span> : null}
                  {d.ticket_code ? <span className="text-gray-400"> · {d.ticket_code}</span> : null}
                  <span className="text-gray-400"> · bay {fmt(d.flight_date)}</span>
                </p>
              </div>
              {airline && (
                <a
                  href={airline.checkinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold shrink-0 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition"
                  title={`Mở web check-in ${airline.name}`}
                >
                  <ExternalLink size={15} /> Web check-in
                </a>
              )}
              <button
                onClick={() => toggleCheckin(d)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold shrink-0 transition ${
                  d.checked_in ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                <Check size={15} /> {d.checked_in ? 'Đã đánh dấu' : 'Đánh dấu xong'}
              </button>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const totalUpcoming = groups.today.length + groups.tomorrow.length + groups.soon.length;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900"><PlaneTakeoff /> Sắp bay</h2>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} className="w-4 h-4 rounded" />
              Chỉ chưa check-in
            </label>
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 bg-white border rounded-lg hover:bg-gray-50 text-sm font-semibold">
              <RefreshCw size={15} /> Làm mới
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-500 mb-4 flex items-center gap-1"><Clock size={14} /> Khách bay trong 7 ngày tới (theo ngày bay trong Công nợ vé).</p>

        {loading && <p className="text-gray-500">Đang tải…</p>}
        {error && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700">{error}</div>}

        {!loading && !error && (
          totalUpcoming === 0 ? (
            <div className="text-center text-gray-400 py-16">
              <PlaneTakeoff size={48} className="mx-auto mb-3 opacity-40" />
              <p>Không có khách nào bay trong 7 ngày tới.</p>
            </div>
          ) : (
            <>
              <Section title="✈️ Ngày mai" items={groups.tomorrow} accent="text-red-600" />
              <Section title="Hôm nay" items={groups.today} accent="text-amber-600" />
              <Section title="Trong 7 ngày tới" items={groups.soon} accent="text-gray-600" />
            </>
          )
        )}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
