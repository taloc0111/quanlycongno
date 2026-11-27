// test/wallets.test.js — Dòng tiền v3: ví trả trước (nạp, trừ khi thanh toán, hoàn, điều chỉnh,
// xoá có kiểm số dư, chống trừ trùng khi chạy song song, phạm vi đại lý, chặn xoá khách có ví).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let U;
let api;
let cust;
let debtId;
let acc;
before(async () => {
  await h.start();
  U = await h.seedUsers();
  api = h.api(U.child.token);
  cust = (await api.post('/api/customers', { name: 'Đại lý Minh', phone: '0966' })).body;
  const d = await api.post('/api/debts', { customerName: 'Đại lý Minh', phoneNumber: '0966', ticketCode: 'VN777', route: 'SGN-PQC', ticketAmount: 5000000, issueDate: '2026-11-01' });
  assert.equal(d.body.customer_id, cust.id);
  debtId = d.body.id;
  acc = (await api.post('/api/accounts', { name: 'ACB' })).body;
});
after(() => h.stop());

const N = (x) => Number(x);
const balance = async () => N((await api.get(`/api/wallets/${cust.id}`)).body.balance);
const counts = async () => (await h.pool.query('SELECT (SELECT COUNT(*) FROM payments) p, (SELECT COUNT(*) FROM wallet_entries) w')).rows[0];

test('nạp → số dư; trừ ví khi thanh toán; không đủ → 400 không ghi gì; xoá payment → hoàn ví', async () => {
  assert.equal(await balance(), 0);
  assert.deepEqual((await api.get(`/api/wallets/${cust.id}`)).body.entries, []);
  assert.ok(!(await api.get('/api/wallets')).body.some((w) => w.customer_id === cust.id), 'chưa có entry → không liệt kê');

  const t = await api.post(`/api/wallets/${cust.id}/topup`, { amount: 1000000, entryDate: '2026-11-02', accountId: acc.id, notes: 'chuyển khoản' });
  assert.equal(t.status, 201);
  assert.equal(t.body.kind, 'topup');
  assert.equal(N(t.body.amount), 1000000);
  assert.equal(N(t.body.balance), 1000000);
  assert.equal(await balance(), 1000000);

  const list = (await api.get('/api/wallets')).body;
  const w = list.find((x) => x.customer_id === cust.id);
  assert.deepEqual(
    { name: w.customer_name, phone: w.phone, bal: N(w.balance), last: w.last_entry_date, n: w.entries_count },
    { name: 'Đại lý Minh', phone: '0966', bal: 1000000, last: '2026-11-02', n: 1 }
  );
  assert.ok('owner_name' in w);

  // Trừ ví 300k (accountId bị bỏ qua).
  const p = await api.post('/api/payments', { debtId, amount: 300000, method: 'wallet', paymentDate: '2026-11-03', accountId: acc.id });
  assert.equal(p.status, 201);
  assert.equal(p.body.method, 'wallet');
  assert.equal(p.body.account_id, null);
  assert.equal(await balance(), 700000);
  let wallet = (await api.get(`/api/wallets/${cust.id}`)).body;
  assert.equal(wallet.customer.id, cust.id);
  const charge = wallet.entries.find((e) => e.kind === 'charge');
  assert.equal(N(charge.amount), -300000);
  assert.equal(charge.payment_id, p.body.id);
  assert.equal(charge.entry_date, '2026-11-03');
  assert.equal(charge.target_label, 'Vé VN777 SGN-PQC');
  assert.equal(wallet.entries.find((e) => e.kind === 'topup').account_name, 'ACB');
  let d = await h.pool.query('SELECT paid FROM debts WHERE id = $1', [debtId]);
  assert.equal(N(d.rows[0].paid), 300000);

  // Không đủ số dư → 400, không ghi payment / entry, paid giữ nguyên.
  const c0 = await counts();
  const bad = await api.post('/api/payments', { debtId, amount: 800000, method: 'wallet' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Ví khách chỉ còn/);
  assert.deepEqual(await counts(), c0);
  d = await h.pool.query('SELECT paid FROM debts WHERE id = $1', [debtId]);
  assert.equal(N(d.rows[0].paid), 300000);

  // Không xoá trực tiếp entry charge.
  const delCharge = await api.del(`/api/wallets/entries/${charge.id}`);
  assert.equal(delCharge.status, 400);

  // Xoá payment → entry charge xoá theo, tiền về ví, paid tính lại.
  assert.equal((await api.del(`/api/payments/${p.body.id}`)).status, 200);
  assert.equal(await balance(), 1000000);
  assert.equal((await h.pool.query('SELECT 1 FROM wallet_entries WHERE id = $1', [charge.id])).rows.length, 0);
  d = await h.pool.query('SELECT paid FROM debts WHERE id = $1', [debtId]);
  assert.equal(N(d.rows[0].paid), 0);

  // Dịch vụ không gắn khách → 400.
  const orphan = (await api.post('/api/debts', { customerName: 'Mồ côi', ticketAmount: 1000 })).body;
  await h.pool.query('UPDATE debts SET customer_id = NULL WHERE id = $1', [orphan.id]);
  assert.equal((await api.post('/api/payments', { debtId: orphan.id, amount: 1, method: 'wallet' })).status, 400);
});

test('hoàn ví (không vượt số dư), điều chỉnh ±, xoá entry kiểm tra số dư âm', async () => {
  const start = await balance(); // 1.000.000
  assert.equal(start, 1000000);
  let r = await api.post(`/api/wallets/${cust.id}/refund`, { amount: 2000000, accountId: acc.id });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /vượt số dư/);
  assert.equal((await api.post(`/api/wallets/${cust.id}/refund`, { amount: 0 })).status, 400);
  assert.equal((await api.post(`/api/wallets/${cust.id}/topup`, { amount: -5 })).status, 400);
  assert.equal((await api.post(`/api/wallets/${cust.id}/topup`, {})).status, 400);
  r = await api.post(`/api/wallets/${cust.id}/refund`, { amount: 100000, accountId: acc.id, entryDate: '2026-11-04' });
  assert.equal(r.status, 201);
  assert.equal(N(r.body.amount), -100000, 'hoàn lưu số âm');
  const refundId = r.body.id;
  assert.equal(await balance(), 900000);

  // Điều chỉnh
  assert.equal((await api.post(`/api/wallets/${cust.id}/adjust`, { amount: 0 })).status, 400);
  assert.equal((await api.post(`/api/wallets/${cust.id}/adjust`, { amount: 50000, notes: '+' })).status, 201);
  const adjNeg = await api.post(`/api/wallets/${cust.id}/adjust`, { amount: -30000, accountId: acc.id });
  assert.equal(adjNeg.status, 201);
  assert.equal(adjNeg.body.account_id, null, 'điều chỉnh không gắn tài khoản');
  assert.equal(await balance(), 920000);
  assert.equal((await api.post(`/api/wallets/${cust.id}/adjust`, { amount: -5000000 })).status, 400, 'không cho âm');

  // Trừ ví 600k → số dư 320k. Xoá topup 1tr sẽ âm → 400.
  const p = await api.post('/api/payments', { debtId, amount: 600000, method: 'wallet' });
  assert.equal(p.status, 201);
  const topup = (await api.get(`/api/wallets/${cust.id}`)).body.entries.find((e) => e.kind === 'topup');
  const del = await api.del(`/api/wallets/entries/${topup.id}`);
  assert.equal(del.status, 400);
  assert.match(del.body.error, /Số dư ví sẽ âm/);
  assert.equal(await balance(), 320000);
  // Xoá hoàn ví (+100k) OK; nạp thêm rồi xoá chính khoản đó OK.
  assert.equal((await api.del(`/api/wallets/entries/${refundId}`)).status, 200);
  assert.equal(await balance(), 420000);
  const t2 = (await api.post(`/api/wallets/${cust.id}/topup`, { amount: 500000 })).body;
  assert.equal((await api.del(`/api/wallets/entries/${t2.id}`)).status, 200);
  assert.equal(await balance(), 420000);
  assert.equal((await api.del(`/api/wallets/entries/${t2.id}`)).status, 404);
  assert.equal((await api.del('/api/payments/' + p.body.id)).status, 200);
  assert.equal(await balance(), 1020000);

  // audit
  await h.waitFor(async () => {
    const a = await h.pool.query("SELECT DISTINCT action FROM audit_logs WHERE entity = 'wallet_entry'");
    return a.rows.length >= 3;
  });
});

test('song song: 2 lần trừ ví cùng lúc vượt số dư → đúng 1 lần thành công', async () => {
  const bal = await balance();
  const amt = Math.ceil(bal * 0.6);
  const [a, b] = await Promise.all([
    api.post('/api/payments', { debtId, amount: amt, method: 'wallet' }),
    api.post('/api/payments', { debtId, amount: amt, method: 'wallet' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 400]);
  assert.equal(await balance(), bal - amt);
  assert.ok((await balance()) >= 0);
  // Lặp thêm nhiều lần song song: không bao giờ âm.
  const many = await Promise.all(Array.from({ length: 6 }, () => api.post('/api/payments', { debtId, amount: 100000, method: 'wallet' })));
  const ok = many.filter((x) => x.status === 201).length;
  assert.equal(ok, Math.min(6, Math.floor((bal - amt) / 100000)));
  assert.ok((await balance()) >= 0);
});

test('phạm vi + id ngoại + chặn xoá khách có ví', async () => {
  const ag = h.api(U.agency.token);
  assert.ok((await ag.get('/api/wallets')).body.some((w) => w.customer_id === cust.id));
  assert.equal((await ag.get(`/api/wallets/${cust.id}`)).status, 200);
  assert.equal((await ag.post(`/api/wallets/${cust.id}/topup`, { amount: 1000 })).status, 404);
  assert.equal((await ag.post(`/api/wallets/${cust.id}/adjust`, { amount: 1000 })).status, 404);
  const anyEntry = (await api.get(`/api/wallets/${cust.id}`)).body.entries[0];
  assert.equal((await ag.del(`/api/wallets/entries/${anyEntry.id}`)).status, 404);
  assert.equal((await h.api(U.other.token).get(`/api/wallets/${cust.id}`)).status, 404);
  assert.ok(!(await h.api(U.other.token).get('/api/wallets')).body.some((w) => w.customer_id === cust.id));
  assert.equal((await api.get('/api/wallets/abc')).status, 400);
  assert.equal((await api.post('/api/wallets/99999/topup', { amount: 1 })).status, 404);
  const foreignAcc = (await h.api(U.other.token).post('/api/accounts', { name: 'X' })).body;
  assert.equal((await api.post(`/api/wallets/${cust.id}/topup`, { amount: 1000, accountId: foreignAcc.id })).status, 400);

  // Khách có ví: không xoá được (đơn lẻ + hàng loạt), dữ liệu ví còn nguyên.
  const before0 = N((await h.pool.query('SELECT COUNT(*) FROM wallet_entries WHERE customer_id = $1', [cust.id])).rows[0].count);
  const del = await api.del(`/api/customers/${cust.id}`);
  assert.equal(del.status, 400);
  const plain = (await api.post('/api/customers', { name: 'Khách thường' })).body;
  const bulk = await api.post('/api/customers/bulk-delete', { ids: [cust.id, plain.id] });
  assert.equal(bulk.status, 200);
  assert.deepEqual(bulk.body, { deleted: 1, skipped: 1 });
  assert.equal((await h.pool.query('SELECT 1 FROM customers WHERE id = $1', [cust.id])).rows.length, 1);
  assert.equal(N((await h.pool.query('SELECT COUNT(*) FROM wallet_entries WHERE customer_id = $1', [cust.id])).rows[0].count), before0);
  // Khách không có ví vẫn xoá đơn lẻ được
  const plain2 = (await api.post('/api/customers', { name: 'Khách thường 2' })).body;
  assert.equal((await api.del(`/api/customers/${plain2.id}`)).status, 200);
});
