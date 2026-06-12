import React, { useEffect, useState } from 'react';
import { Search, PlaneTakeoff, Loader2, Crown, AlertCircle } from 'lucide-react';
import VnDatePicker from './components/VnDatePicker';
import Toast from './components/Toast';
import { apiGet, apiSend } from './services/client';
import { formatCurrency } from './utils/format';
import { useToast } from './hooks/useFeedback';

// 5 hãng worker hỗ trợ — hiện sẵn khung để biết đang chờ hãng nào.
const AIRLINES = ['VietJet', 'Vietnam Airlines', 'Bamboo Airways', 'Sun PhuQuoc Airways', 'Vietravel'];

export default function FareCheckApp() {
  const [routes, setRoutes] = useState([]);
  const [route, setRoute] = useState('');
  const [date, setDate] = useState('');
  const [pax, setPax] = useState('1');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null); // { route, date, pax, results: [...] }
  const { toast, showToast } = useToast();

  useEffect(() => {
    apiGet('/routes').then(setRoutes).catch(() => {});
  }, []);

  const search = async () => {
    if (!/^[A-Za-z]{3}\s*[-→\s]\s*[A-Za-z]{3}$/.test(route)) { showToast('Nhập hành trình hợp lệ, vd: SGN-HAN', 'error'); return; }
    if (!date) { showToast('Chọn ngày đi', 'error'); return; }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await apiSend('POST', '/fares/quote', { route: route.toUpperCase(), date, pax });
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const cheapest = result?.results?.find((r) => r.ok); // mảng đã sắp tăng dần → phần tử ok đầu là rẻ nhất

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <h2 className="flex items-center gap-2 text-2xl font-bold text-gray-900 mb-1"><Search /> Check vé</h2>
        <p className="text-sm text-gray-500 mb-4">Tra giá hiện tại của cả 5 hãng cho một chặng — so sánh nhanh, không lưu khách.</p>

        {/* Form tra giá */}
        <div className="bg-white rounded-xl border-2 border-gray-200 shadow-sm p-4 grid grid-cols-1 sm:grid-cols-4 gap-3">
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
          <div>
            <label className="block text-sm text-gray-600 mb-1">Số khách</label>
            <input type="number" min="1" max="9" value={pax} onChange={(e) => setPax(e.target.value)} className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div className="sm:col-span-4">
            <button
              onClick={search}
              disabled={loading}
              className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-semibold disabled:opacity-60"
            >
              {loading ? <><Loader2 size={18} className="animate-spin" /> Đang tra 5 hãng…</> : <><Search size={18} /> Tra giá</>}
            </button>
          </div>
        </div>

        {loading && (
          <p className="text-sm text-gray-500 mt-3">
            Đang mở web từng hãng để lấy giá (mỗi hãng vài chục giây). Vui lòng đợi…
          </p>
        )}
        {error && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700 flex items-center gap-2">
            <AlertCircle size={18} /> {error}
          </div>
        )}

        {/* Kết quả so giá */}
        {result && (
          <div className="mt-5">
            <p className="text-sm text-gray-600 mb-2">
              <b>{result.route}</b> · {date.split('-').reverse().join('/')} · {result.pax} khách
            </p>
            <div className="bg-white rounded-xl border-2 border-gray-200 shadow-sm divide-y">
              {result.results.map((r) => {
                const isCheapest = cheapest && r.key === cheapest.key && r.ok;
                return (
                  <div key={r.key} className={`flex items-center justify-between gap-3 px-4 py-3 ${isCheapest ? 'bg-green-50' : ''}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <PlaneTakeoff size={16} className={isCheapest ? 'text-green-600' : 'text-gray-400'} />
                      <span className="font-semibold text-gray-800 truncate">{r.airline}</span>
                      {isCheapest && <span className="flex items-center gap-1 text-xs font-semibold text-green-700"><Crown size={12} /> Rẻ nhất</span>}
                    </div>
                    {r.ok ? (
                      <span className={`font-bold shrink-0 ${isCheapest ? 'text-green-700 text-lg' : 'text-gray-900'}`}>{formatCurrency(r.price)}</span>
                    ) : (
                      <span className="text-xs text-amber-600 shrink-0" title={r.error}>không lấy được</span>
                    )}
                  </div>
                );
              })}
            </div>
            {result.results.every((r) => !r.ok) && (
              <p className="text-sm text-amber-600 mt-3">
                Chưa lấy được giá hãng nào lần này — có thể do anti-bot hoặc giao diện hãng vừa đổi. Thử lại sau giây lát.
              </p>
            )}
          </div>
        )}

        {!result && !loading && !error && (
          <div className="text-center text-gray-400 py-16">
            <div className="flex justify-center gap-2 mb-3 flex-wrap">
              {AIRLINES.map((a) => <span key={a} className="px-2 py-1 rounded-full bg-gray-100 text-gray-500 text-xs">{a}</span>)}
            </div>
            <p>Nhập hành trình + ngày rồi bấm <b>Tra giá</b> để so giá 5 hãng.</p>
          </div>
        )}
      </div>
      <Toast toast={toast} />
    </div>
  );
}
