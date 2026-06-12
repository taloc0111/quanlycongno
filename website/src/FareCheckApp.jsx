import React, { useEffect, useState } from 'react';
import { Search, PlaneTakeoff, PlaneLanding, Loader2, Crown, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import VnDatePicker from './components/VnDatePicker';
import Toast from './components/Toast';
import { apiGet, apiSend } from './services/client';
import { formatCurrency } from './utils/format';
import { useToast } from './hooks/useFeedback';

// Các hãng nội địa thường gặp — hiện ở màn hình chờ cho biết phạm vi so giá.
const AIRLINES = ['VietJet', 'Vietnam Airlines', 'Bamboo Airways', 'Sun PhuQuoc Airways', 'Vietravel'];

// 'yyyy-mm-dd HH:MM' → 'HH:MM'
const hhmm = (t) => (t && t.length >= 16 ? t.slice(11, 16) : '');
// Hậu tố ' (+1)' khi giờ đến rơi sang ngày hôm sau (chuyến đêm).
const plusDays = (dep, arr) => {
  if (!dep || !arr) return '';
  const d1 = dep.slice(0, 10);
  const d2 = arr.slice(0, 10);
  if (d1 === d2) return '';
  const diff = Math.round((new Date(d2) - new Date(d1)) / 86400000);
  return diff > 0 ? ` (+${diff})` : '';
};
const fmtDur = (m) => (m ? `${Math.floor(m / 60)}g${String(m % 60).padStart(2, '0')}` : '');
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export default function FareCheckApp() {
  const [routes, setRoutes] = useState([]);
  const [route, setRoute] = useState('');
  const [roundTrip, setRoundTrip] = useState(false);
  const [date, setDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [pax, setPax] = useState('1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { route, date, returnDate, pax, legs: [...] }
  const [expanded, setExpanded] = useState(() => new Set()); // các dòng hãng đang xổ khung giờ
  const { toast, showToast } = useToast();

  useEffect(() => {
    apiGet('/routes').then(setRoutes).catch(() => {});
  }, []);

  const toggleExpand = (k) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const search = async () => {
    if (!/^[A-Za-z]{3}\s*[-→\s]\s*[A-Za-z]{3}$/.test(route)) { showToast('Nhập hành trình hợp lệ, vd: SGN-HAN', 'error'); return; }
    if (!date) { showToast('Chọn ngày đi', 'error'); return; }
    if (roundTrip) {
      if (!returnDate) { showToast('Chọn ngày về (hoặc chuyển sang Một chiều)', 'error'); return; }
      if (returnDate < date) { showToast('Ngày về phải từ ngày đi trở đi', 'error'); return; }
    }
    setLoading(true);
    setError('');
    setResult(null);
    setExpanded(new Set());
    try {
      const body = { route: route.toUpperCase(), date, pax };
      if (roundTrip) body.returnDate = returnDate;
      const data = await apiSend('POST', '/fares/quote', body);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Tổng rẻ nhất khứ hồi = cộng giá rẻ nhất của 2 chiều (mảng đã sắp tăng dần).
  const legCheapest = (leg) => leg.results.find((r) => r.ok) || null;
  const roundTripTotal =
    result?.legs?.length === 2 && result.legs.every((l) => legCheapest(l))
      ? result.legs.reduce((sum, l) => sum + legCheapest(l).price, 0)
      : null;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900 mb-1"><Search /> Check vé</h2>
        <p className="text-sm text-gray-500 mb-4">Tra giá hiện tại của các hãng cho một chặng — kèm khung giờ từng chuyến, không lưu khách.</p>

        {/* Form tra giá */}
        <div className="bg-white rounded-xl border-2 border-gray-200 shadow-sm p-4 grid grid-cols-1 sm:grid-cols-5 gap-3">
          {/* Một chiều / Khứ hồi */}
          <div className="sm:col-span-5 flex gap-2">
            {[{ v: false, label: 'Một chiều' }, { v: true, label: 'Khứ hồi' }].map((opt) => (
              <button
                key={opt.label}
                onClick={() => setRoundTrip(opt.v)}
                className={`px-4 py-1.5 rounded-full text-sm font-semibold border ${
                  roundTrip === opt.v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm text-gray-600 mb-1">Hành trình *</label>
            <input
              list="fc-routes"
              value={route}
              onChange={(e) => setRoute(e.target.value)}
              placeholder="VD: SGN-HAN"
              className="w-full border rounded-lg px-3 py-2 uppercase"
            />
            <datalist id="fc-routes">{routes.map((r) => <option key={r} value={r} />)}</datalist>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">Ngày đi *</label>
            <VnDatePicker value={date} onChange={setDate} />
          </div>
          {roundTrip && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">Ngày về *</label>
              <VnDatePicker value={returnDate} onChange={setReturnDate} />
            </div>
          )}
          <div>
            <label className="block text-sm text-gray-600 mb-1">Số khách</label>
            <input type="number" min="1" max="9" value={pax} onChange={(e) => setPax(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div className="sm:col-span-5">
            <button
              onClick={search}
              disabled={loading}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold disabled:opacity-60"
            >
              {loading ? <><Loader2 size={18} className="animate-spin" /> Đang tra giá…</> : <><Search size={18} /> Tra giá</>}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700 flex items-center gap-2">
            <AlertCircle size={18} /> {error}
          </div>
        )}

        {/* Kết quả so giá — mỗi chiều 1 bảng, bấm vào hãng để xổ khung giờ */}
        {result?.legs?.map((leg, li) => {
          const cheapest = legCheapest(leg);
          return (
            <div className="mt-5" key={leg.direction}>
              <p className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                {leg.direction === 'outbound' ? <PlaneTakeoff size={16} /> : <PlaneLanding size={16} />}
                <b>{result.legs.length === 2 ? (leg.direction === 'outbound' ? 'Chiều đi' : 'Chiều về') : 'Kết quả'}</b>
                · <b>{leg.route}</b> · {fmtDate(leg.date)} · {result.pax} khách
              </p>
              <div className="bg-white rounded-xl border-2 border-gray-200 shadow-sm divide-y">
                {leg.results.map((r) => {
                  const k = `${li}:${r.key}`;
                  const isCheapest = cheapest && r.ok && r.key === cheapest.key;
                  const canExpand = r.ok && r.flights?.length > 0;
                  const isOpen = expanded.has(k);
                  return (
                    <div key={r.key}>
                      <div
                        onClick={canExpand ? () => toggleExpand(k) : undefined}
                        className={`flex items-center justify-between gap-3 px-4 py-3 ${isCheapest ? 'bg-green-50' : ''} ${canExpand ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <PlaneTakeoff size={16} className={isCheapest ? 'text-green-600' : 'text-gray-400'} />
                          <span className="font-semibold text-gray-800 truncate">{r.airline}</span>
                          {isCheapest && <span className="flex items-center gap-1 text-xs font-semibold text-green-700"><Crown size={12} /> Rẻ nhất</span>}
                          {canExpand && <span className="text-xs text-gray-400 shrink-0">{r.flights.length} chuyến</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {r.ok ? (
                            <span className={`font-bold ${isCheapest ? 'text-green-700 text-lg' : 'text-gray-900'}`}>{formatCurrency(r.price)}</span>
                          ) : (
                            <span className="text-xs text-amber-600" title={r.error}>không lấy được</span>
                          )}
                          {canExpand && (isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />)}
                        </div>
                      </div>
                      {canExpand && isOpen && (
                        <div className="px-4 pb-3 pt-1 bg-gray-50">
                          {r.flights.map((f, fi) => (
                            <div key={`${f.flightNo || 'f'}-${fi}`} className="flex items-center justify-between gap-2 py-1.5 text-sm border-b border-gray-100 last:border-0">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="font-mono text-xs text-gray-500 w-16 shrink-0">{f.flightNo || '—'}</span>
                                <span className="font-semibold text-gray-800">
                                  {hhmm(f.departTime)} → {hhmm(f.arriveTime)}{plusDays(f.departTime, f.arriveTime)}
                                </span>
                                <span className="text-xs text-gray-400 hidden sm:inline">
                                  {fmtDur(f.durationMin)}{f.stops > 0 ? ` · ${f.stops} điểm dừng` : ' · bay thẳng'}
                                </span>
                              </div>
                              <span className={`shrink-0 ${f.price === r.price ? 'font-semibold text-green-700' : 'text-gray-700'}`}>{formatCurrency(f.price)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {leg.results.every((r) => !r.ok) && (
                <p className="text-sm text-amber-600 mt-3">
                  Chưa lấy được giá chiều này — thử lại sau giây lát (hoặc kiểm tra hạn mức SerpApi trong tháng).
                </p>
              )}
            </div>
          );
        })}

        {/* Tổng khứ hồi = giá rẻ nhất chiều đi + chiều về */}
        {roundTripTotal != null && (
          <div className="mt-4 rounded-xl border-2 border-green-200 bg-green-50 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-green-800">Tổng rẻ nhất khứ hồi (đi + về, có thể khác hãng)</span>
            <span className="text-lg font-bold text-green-700">{formatCurrency(roundTripTotal)}</span>
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center text-gray-400 py-16">
            <div className="flex justify-center gap-2 mb-3 flex-wrap">
              {AIRLINES.map((a) => <span key={a} className="px-2 py-1 rounded-full bg-gray-100 text-gray-500 text-xs">{a}</span>)}
            </div>
            <p>Nhập hành trình + ngày rồi bấm <b>Tra giá</b> để so giá và xem khung giờ các hãng.</p>
          </div>
        )}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
