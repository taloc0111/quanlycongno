import React, { useEffect, useState } from 'react';
import { DollarSign, TrendingDown, AlertTriangle, Users, RefreshCw } from 'lucide-react';
import { apiGet } from './services/client';
import { formatCurrency } from './utils/format';

function StatCard({ icon: Icon, label, value, gradient }) {
  return (
    <div className={`rounded-2xl p-5 text-white shadow-lg bg-gradient-to-br ${gradient}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm/relaxed opacity-90">{label}</p>
          <p className="text-xl sm:text-2xl font-bold mt-1">{value}</p>
        </div>
        <Icon size={32} className="opacity-80" />
      </div>
    </div>
  );
}

export default function DashboardApp() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setStats(await apiGet('/stats'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const maxMonthly = stats?.monthly?.reduce((m, x) => Math.max(m, x.amount), 0) || 1;

  return (
    <div className="min-h-screen bg-gray-50 p-4 sm:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900">📊 Tổng quan công nợ</h2>
          <button onClick={load} className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg hover:bg-gray-50 text-sm font-semibold">
            <RefreshCw size={16} /> Làm mới
          </button>
        </div>

        {loading && <p className="text-gray-500">Đang tải số liệu…</p>}
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-red-700">{error}</div>
        )}

        {stats && !loading && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard icon={DollarSign} label="Tổng phải thu" value={formatCurrency(stats.totalAmount)} gradient="from-blue-500 to-blue-600" />
              <StatCard icon={TrendingDown} label="Còn nợ" value={formatCurrency(stats.outstanding)} gradient="from-orange-500 to-red-600" />
              <StatCard icon={AlertTriangle} label="Nợ quá hạn" value={formatCurrency(stats.overdue)} gradient="from-rose-500 to-pink-600" />
              <StatCard icon={Users} label="Số khách hàng" value={stats.counts.customers} gradient="from-emerald-500 to-teal-600" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Top debtors */}
              <div className="bg-white rounded-2xl shadow p-5">
                <h3 className="font-bold text-gray-800 mb-4">Top khách còn nợ nhiều nhất</h3>
                {stats.topDebtors.length === 0 ? (
                  <p className="text-gray-400 text-sm">Chưa có dữ liệu.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {stats.topDebtors.map((d, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-2 text-gray-400 w-8">{i + 1}</td>
                          <td className="py-2 font-medium text-gray-800">{d.name}</td>
                          <td className="py-2 text-right font-semibold text-red-600">{formatCurrency(d.outstanding)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Monthly */}
              <div className="bg-white rounded-2xl shadow p-5">
                <h3 className="font-bold text-gray-800 mb-4">Doanh số vé 6 tháng gần nhất</h3>
                {stats.monthly.length === 0 ? (
                  <p className="text-gray-400 text-sm">Chưa có dữ liệu.</p>
                ) : (
                  <div className="space-y-3">
                    {stats.monthly.map((m) => (
                      <div key={m.month}>
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>{m.month}</span>
                          <span>{formatCurrency(m.amount)}</span>
                        </div>
                        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full"
                            style={{ width: `${Math.max(4, (m.amount / maxMonthly) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
