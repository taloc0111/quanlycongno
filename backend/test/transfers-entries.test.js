// test/transfers-entries.test.js — Dòng tiền v3.1: chuyển tiền giữa 2 TK (phí trừ TK nguồn),
// thu chi khác (danh mục của chủ không tính lãi/lỗ), sổ chi tiết kind mới, đối soát từng phía,
// khớp sao kê theo lô (tất cả hoặc không), số liệu stats bổ sung.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { todayLocal } = require('../utils/dates');

let U;
let api;
before(async () => {
  await h.start();
  U = await h.seedUsers();
  api = h.api(U.child.token);
});
after(() => h.stop());

const N = (x) => Number(x);
const bal = async (id) => {
  const a = (await api.get('/api/accounts?includeArchived=1')).body.find((x) => x.id === id);
  return a ? { balance: N(a.balance), in: N(a.total_in), out: N(a.total_out), unrec: a.unreconciled_count } : null;
};
// Luỹ kế sổ (không lọc ngày) phải bằng số dư cuối kỳ và bằng balance của danh sách TK.
async function assertLedgerConsistent(accountId) {
  const led = (await api.get(`/api/accounts/${accountId}/ledger`)).body;
  let run = N(led.opening);
  for (const r of led.rows) run += r.direction === 'in' ? N(r.amount) : -N(r.amount);
  assert.equal(Math.round(run * 100), Math.round(N(led.closing) * 100), 'luỹ kế = closing');
  assert.equal(N(led.closing), (await bal(accountId)).balance, 'closing = balance danh sách');
  return led;
}

test('chuyển tiền: số dư 2 TK + phí; xoá hoàn tác; cùng TK / TK người khác → 400; sổ transfer_in/out; đối soát từng phía', async () => {
  const A = (await api.post('/api/accounts', { name: 'TK chị Lan', isOwn: false, openingBalance: 1000000 })).body;
  const B = (await api.post('/api/accounts', { name: 'TCB', openingBalance: 0 })).body;
  const foreign = (await h.api(U.other.token).post('/api/accounts', { name: 'TK lạ' })).body;

  // validate
  const bad = [
    { fromAccountId: A.id, toAccountId: A.id, amount: 1000 },
    { fromAccountId: A.id, toAccountId: foreign.id, amount: 1000 },
    { fromAccountId: foreign.id, toAccountId: B.id, amount: 1000 },
    { fromAccountId: A.id, toAccountId: B.id, amount: 0 },
    { fromAccountId: A.id, toAccountId: B.id, amount: 1000, fee: -1 },
    { fromAccountId: A.id, amount: 1000 },
    { fromAccountId: A.id, toAccountId: B.id, amount: 1000, transferDate: '2026-02-30' },
  ];
  for (const body of bad) assert.equal((await api.post('/api/accounts/transfers', body)).status, 400, JSON.stringify(body));
  assert.equal((await api.post('/api/accounts/transfers', { fromAccountId: A.id, toAccountId: foreign.id, amount: 1 })).body.error, 'Tài khoản không hợp lệ');
  assert.equal((await h.pool.query('SELECT COUNT(*)::int AS n FROM account_transfers')).rows[0].n, 0);

  const t = await api.post('/api/accounts/transfers', { fromAccountId: A.id, toAccountId: B.id, amount: 300000, fee: 5000, transferDate: '2026-11-10', notes: 'chị Lan trả về' });
  assert.equal(t.status, 201);
  assert.equal(t.body.from_account_name, 'TK chị Lan');
  assert.equal(t.body.to_account_name, 'TCB');
  assert.equal(N(t.body.fee), 5000);
  assert.deepEqual(await bal(A.id), { balance: 695000, in: 0, out: 305000, unrec: 1 });
  assert.deepEqual(await bal(B.id), { balance: 300000, in: 300000, out: 0, unrec: 1 });

  // GET lọc theo TK + phạm vi
  assert.equal((await api.get(`/api/accounts/transfers?accountId=${B.id}`)).body.length, 1);
  assert.equal((await api.get(`/api/accounts/transfers?accountId=${foreign.id}`)).body.length, 0);
  assert.equal((await h.api(U.agency.token).get('/api/accounts/transfers')).body.length, 1, 'cấp trên xem được');
  assert.equal((await h.api(U.other.token).get('/api/accounts/transfers')).body.length, 0);

  // Sổ: transfer_out (amount + fee) / transfer_in
  const ledA = await assertLedgerConsistent(A.id);
  assert.deepEqual(ledA.rows.map((r) => [r.kind, r.direction, N(r.amount), r.ref.type, r.ref.id]), [['transfer_out', 'out', 305000, 'transfer', t.body.id]]);
  assert.match(ledA.rows[0].description, /Chuyển sang TCB/);
  assert.match(ledA.rows[0].description, /phí 5\.000/);
  const ledB = await assertLedgerConsistent(B.id);
  assert.deepEqual(ledB.rows.map((r) => [r.kind, r.direction, N(r.amount)]), [['transfer_in', 'in', 300000]]);
  assert.match(ledB.rows[0].description, /Nhận từ TK chị Lan/);

  // Đối soát từng phía độc lập
  assert.equal((await api.put('/api/accounts/reconcile', { kind: 'transfer_out', id: t.body.id, reconciled: true })).status, 200);
  let row = (await h.pool.query('SELECT reconciled_from, reconciled_to FROM account_transfers WHERE id = $1', [t.body.id])).rows[0];
  assert.deepEqual(row, { reconciled_from: true, reconciled_to: false });
  assert.equal((await bal(A.id)).unrec, 0);
  assert.equal((await bal(B.id)).unrec, 1);
  assert.equal((await api.put('/api/accounts/reconcile', { kind: 'transfer_in', id: t.body.id, reconciled: true })).status, 200);
  row = (await h.pool.query('SELECT reconciled_from, reconciled_to FROM account_transfers WHERE id = $1', [t.body.id])).rows[0];
  assert.deepEqual(row, { reconciled_from: true, reconciled_to: true });
  assert.equal((await h.api(U.other.token).put('/api/accounts/reconcile', { kind: 'transfer_in', id: t.body.id, reconciled: false })).status, 404);

  // TK có chuyển tiền → không xoá được
  assert.equal((await api.del(`/api/accounts/${B.id}`)).status, 400);

  // Xoá bằng id lấy từ dòng sổ (FE gọi DELETE /accounts/transfers/:id với row.id); chỉ chủ; số dư về như cũ
  assert.equal(ledA.rows[0].id, t.body.id);
  assert.equal(ledB.rows[0].id, t.body.id);
  assert.equal((await h.api(U.agency.token).del(`/api/accounts/transfers/${ledB.rows[0].id}`)).status, 404);
  assert.equal((await api.del(`/api/accounts/transfers/${ledB.rows[0].id}`)).status, 200);
  assert.equal((await api.del(`/api/accounts/transfers/${t.body.id}`)).status, 404);
  assert.deepEqual(await bal(A.id), { balance: 1000000, in: 0, out: 0, unrec: 0 });
  assert.deepEqual(await bal(B.id), { balance: 0, in: 0, out: 0, unrec: 0 });
  const audit = await h.waitFor(async () => {
    const r = await h.pool.query("SELECT action FROM audit_logs WHERE entity = 'account_transfer' AND entity_id = $1", [t.body.id]);
    return r.rows.length >= 2 ? r.rows.map((x) => x.action).sort() : null;
  });
  assert.deepEqual(audit, ['create', 'delete']);
  assert.equal((await api.del(`/api/accounts/${B.id}`)).status, 200, 'hết giao dịch → xoá được');
  assert.equal((await api.del(`/api/accounts/${A.id}`)).status, 200);
});

test('thu chi khác: số dư vào/ra, PUT/DELETE, lọc; Góp vốn / Rút tiền riêng không tính lãi lỗ; netProfit + monthly', async () => {
  const today = todayLocal();
  const month = today.slice(0, 7);
  const acc = (await api.post('/api/accounts', { name: 'VIB', openingBalance: 100000 })).body;
  const foreign = (await h.api(U.other.token).post('/api/accounts', { name: 'TK lạ 2' })).body;

  // Một vé có lãi 200k để có totalProfit
  const d = await api.post('/api/debts', { customerName: 'Khách lãi', ticketAmount: 1000000, costAmount: 800000, issueDate: today });
  assert.equal(d.status, 201);
  const before0 = (await api.get('/api/stats')).body;
  assert.equal(before0.otherIncome, 0);
  assert.equal(before0.otherExpense, 0);
  assert.equal(before0.netProfit, before0.totalProfit);

  // validate
  for (const body of [
    { direction: 'in', amount: 1000 },
    { accountId: acc.id, direction: 'x', amount: 1000 },
    { accountId: acc.id, direction: 'out', amount: 0 },
    { accountId: acc.id, direction: 'out', amount: -5 },
    { accountId: foreign.id, direction: 'out', amount: 1000 },
    { accountId: acc.id, direction: 'out', amount: 1000, category: 'x'.repeat(51) },
  ]) assert.equal((await api.post('/api/accounts/entries', body)).status, 400, JSON.stringify(body));

  const mk = (b) => api.post('/api/accounts/entries', { accountId: acc.id, entryDate: today, ...b });
  const e1 = await mk({ direction: 'in', amount: 10000, category: 'Lãi ngân hàng' });
  assert.equal(e1.status, 201);
  assert.equal(e1.body.account_name, 'VIB');
  const e2 = (await mk({ direction: 'out', amount: 2000, category: 'Phí ngân hàng', notes: 'phí SMS' })).body;
  const e3 = (await mk({ direction: 'out', amount: 100000, category: 'Rút tiền riêng' })).body;
  const e4 = (await mk({ direction: 'in', amount: 500000, category: 'Góp vốn' })).body;
  const e5 = (await mk({ direction: 'out', amount: 7000 })).body;
  assert.equal(e5.category, 'Khác', 'mặc định Khác');

  // Số dư = 100k + 10k + 500k − 2k − 100k − 7k = 501k
  assert.deepEqual(await bal(acc.id), { balance: 501000, in: 510000, out: 109000, unrec: 5 });
  const led = await assertLedgerConsistent(acc.id);
  assert.deepEqual(led.rows.map((r) => [r.kind, r.direction, N(r.amount)]), [
    ['entry_in', 'in', 10000], ['entry_out', 'out', 2000], ['entry_out', 'out', 100000], ['entry_in', 'in', 500000], ['entry_out', 'out', 7000],
  ]);
  assert.equal(led.rows[1].description, 'Phí ngân hàng · phí SMS');
  assert.deepEqual(led.rows[1].ref, { type: 'entry', id: e2.id });

  // Stats: bỏ Góp vốn / Rút tiền riêng
  let s = (await api.get('/api/stats')).body;
  assert.equal(s.otherIncome, 10000);
  assert.equal(s.otherExpense, 9000);
  assert.equal(s.netProfit, s.totalProfit + 10000 - 9000);
  const m = s.monthly.find((x) => x.month === month);
  assert.ok(m, 'có tháng hiện tại');
  assert.equal(m.otherExpense, 9000);
  assert.equal(m.otherIncome, 10000);
  assert.equal(m.netProfit, m.profit + 10000 - 9000);
  assert.ok(s.monthly.every((x) => 'netProfit' in x && 'otherExpense' in x));
  // Phạm vi: cấp trên thấy, người lạ không
  assert.equal((await h.api(U.agency.token).get(`/api/stats?agencyId=${U.child.id}`)).body.otherExpense, 9000);
  assert.equal((await h.api(U.other.token).get('/api/stats')).body.otherExpense, 0);

  // Hợp đồng với FE: dòng entries có đủ field; id dòng sổ entry_* = account_entries.id
  const ent = (await api.get(`/api/accounts/entries?accountId=${acc.id}`)).body.find((x) => x.id === e2.id);
  for (const key of ['id', 'account_id', 'account_name', 'direction', 'amount', 'entry_date', 'category', 'reconciled', 'notes']) {
    assert.ok(key in ent, `entries thiếu ${key}`);
  }
  assert.deepEqual([ent.account_id, ent.account_name, ent.direction, N(ent.amount), ent.entry_date, ent.category, ent.reconciled, ent.notes],
    [acc.id, 'VIB', 'out', 2000, today, 'Phí ngân hàng', false, 'phí SMS']);
  assert.ok(led.rows.filter((r) => r.kind.startsWith('entry_')).every((r) => [e1.body.id, e2.id, e3.id, e4.id, e5.id].includes(r.id)));

  // GET lọc
  assert.equal((await api.get(`/api/accounts/entries?accountId=${acc.id}`)).body.length, 5);
  assert.deepEqual((await api.get(`/api/accounts/entries?category=${encodeURIComponent('Góp vốn')}`)).body.map((x) => x.id), [e4.id]);
  assert.equal((await api.get(`/api/accounts/entries?from=${today}&to=${today}`)).body.length, 5);
  assert.equal((await api.get('/api/accounts/entries?from=2000-01-01&to=2000-01-02')).body.length, 0);
  assert.equal((await api.get('/api/accounts/entries?from=bad')).status, 400);
  assert.equal((await h.api(U.other.token).get('/api/accounts/entries')).body.length, 0);

  // PUT từng phần
  let u = await api.put(`/api/accounts/entries/${e2.id}`, { amount: 3000 });
  assert.equal(u.status, 200);
  assert.equal(N(u.body.amount), 3000);
  assert.equal(u.body.category, 'Phí ngân hàng');
  assert.equal(u.body.notes, 'phí SMS');
  assert.equal((await api.put(`/api/accounts/entries/${e2.id}`, { accountId: foreign.id })).status, 400);
  assert.equal((await api.put(`/api/accounts/entries/${e2.id}`, { direction: 'up' })).status, 400);
  assert.equal((await h.api(U.agency.token).put(`/api/accounts/entries/${e2.id}`, { amount: 1 })).status, 404);
  assert.equal((await bal(acc.id)).balance, 500000);
  u = await api.put(`/api/accounts/entries/${e2.id}`, { direction: 'in' });
  assert.equal(u.body.direction, 'in');
  assert.equal((await bal(acc.id)).balance, 506000);
  s = (await api.get('/api/stats')).body;
  assert.equal(s.otherIncome, 13000);
  assert.equal(s.otherExpense, 7000);

  // DELETE → số dư về
  for (const e of [e1.body, e2, e3, e4, e5]) assert.equal((await api.del(`/api/accounts/entries/${e.id}`)).status, 200);
  assert.equal((await api.del(`/api/accounts/entries/${e2.id}`)).status, 404);
  assert.deepEqual(await bal(acc.id), { balance: 100000, in: 0, out: 0, unrec: 0 });
  s = (await api.get('/api/stats')).body;
  assert.equal(s.otherIncome, 0);
  assert.equal(s.netProfit, s.totalProfit);
  const audit = await h.waitFor(async () => {
    const r = await h.pool.query("SELECT DISTINCT action FROM audit_logs WHERE entity = 'account_entry'");
    return r.rows.length >= 3 ? r.rows.map((x) => x.action).sort() : null;
  });
  assert.deepEqual(audit, ['create', 'delete', 'update']);
  assert.equal((await api.del(`/api/debts/${d.body.id}`)).status, 200);
});

test('reconcile-batch: tất cả hoặc không; nhận kind của sổ (entry_in, topup...); validate', async () => {
  const A = (await api.post('/api/accounts', { name: 'ACB lô' })).body;
  const B = (await api.post('/api/accounts', { name: 'MoMo lô' })).body;
  const e = (await api.post('/api/accounts/entries', { accountId: A.id, direction: 'in', amount: 50000 })).body;
  const t = (await api.post('/api/accounts/transfers', { fromAccountId: A.id, toAccountId: B.id, amount: 20000 })).body;
  const cust = (await api.post('/api/customers', { name: 'Khách lô' })).body;
  const w = (await api.post(`/api/wallets/${cust.id}/topup`, { amount: 30000, accountId: A.id })).body;
  const otherE = (await h.api(U.other.token).post('/api/accounts/entries', {
    accountId: (await h.api(U.other.token).post('/api/accounts', { name: 'lạ' })).body.id, direction: 'in', amount: 1,
  })).body;

  // 1 dòng của người khác → 400, không dòng nào bị đổi
  let r = await api.put('/api/accounts/reconcile-batch', { items: [
    { kind: 'entry_in', id: e.id, reconciled: true },
    { kind: 'entry', id: otherE.id, reconciled: true },
  ] });
  assert.equal(r.status, 400);
  assert.equal((await h.pool.query('SELECT reconciled FROM account_entries WHERE id = $1', [e.id])).rows[0].reconciled, false);
  // id không tồn tại → 400
  assert.equal((await api.put('/api/accounts/reconcile-batch', { items: [{ kind: 'payment', id: 999999, reconciled: true }] })).status, 400);
  // validate
  assert.equal((await api.put('/api/accounts/reconcile-batch', {})).status, 400);
  assert.equal((await api.put('/api/accounts/reconcile-batch', { items: [] })).status, 400);
  assert.equal((await api.put('/api/accounts/reconcile-batch', { items: [{ kind: 'xyz', id: e.id, reconciled: true }] })).status, 400);
  assert.equal((await api.put('/api/accounts/reconcile-batch', { items: [{ kind: 'entry', id: e.id }] })).status, 400);

  r = await api.put('/api/accounts/reconcile-batch', { items: [
    { kind: 'entry_in', id: e.id, reconciled: true },
    { kind: 'transfer_out', id: t.id, reconciled: true },
    { kind: 'topup', id: w.id, reconciled: true },
  ] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { updated: 3 });
  assert.equal((await bal(A.id)).unrec, 0);
  assert.equal((await bal(B.id)).unrec, 1, 'phía nhận chưa đối soát');
  assert.equal((await h.pool.query('SELECT reconciled FROM wallet_entries WHERE id = $1', [w.id])).rows[0].reconciled, true);
  // cấp trên không đối soát được dữ liệu cấp dưới
  assert.equal((await h.api(U.agency.token).put('/api/accounts/reconcile-batch', { items: [{ kind: 'entry', id: e.id, reconciled: false }] })).status, 400);
  assert.equal((await h.pool.query('SELECT reconciled FROM account_entries WHERE id = $1', [e.id])).rows[0].reconciled, true);
  await h.waitFor(async () => (await h.pool.query("SELECT 1 FROM audit_logs WHERE entity = 'reconcile' AND summary LIKE 'Khớp sao kê%'")).rows.length > 0);
  // không token → 401
  assert.equal((await h.api(null).put('/api/accounts/reconcile-batch', { items: [] })).status, 401);
  assert.equal((await h.api(null).get('/api/accounts/transfers')).status, 401);
  assert.equal((await h.api(null).get('/api/accounts/entries')).status, 401);
});
