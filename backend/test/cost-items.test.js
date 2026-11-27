// test/cost-items.test.js — Dòng tiền v3: giá vốn nhiều dòng trên 4 dịch vụ (vé down, trả ngay,
// thay thế dòng, giữ tiền đã trả NCC), cost_pending + thống kê (lợi nhuận bỏ qua dòng chưa đủ giá vốn).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { todayLocal, addDays } = require('../utils/dates');

let U;
let api;
let F1;
let DOWN;
let ACC;
before(async () => {
  await h.start();
  U = await h.seedUsers();
  api = h.api(U.child.token);
  F1 = (await api.post('/api/suppliers', { name: 'F1 Thùy Dương', kind: 'f1' })).body;
  DOWN = (await api.post('/api/suppliers', { name: 'Anh Down', kind: 'down' })).body;
  ACC = (await api.post('/api/accounts', { name: 'TCB', openingBalance: 0 })).body;
});
after(() => h.stop());

const N = (x) => Number(x);
const debt = (over = {}) => ({
  customerName: 'Khách Down', phoneNumber: '0933', ticketCode: 'VJ999', airline: 'VJ', route: 'SGN-HAN',
  issueDate: '2026-11-20', ticketAmount: 2000000, costAmount: 1, ...over,
});
const downItems = () => [
  { label: 'Giá vé F1', amount: 1500000, supplierId: F1.id },
  { label: 'Phí F1', amount: 5000, supplierId: F1.id },
  { label: 'Phí down', amount: 200000, supplierId: DOWN.id, dueDate: '2026-11-25' },
];

test('vé down 3 dòng: cost_amount = tổng; GET trả cost_items/cost_unpaid/cost_pending/ticket_kind', async () => {
  const c = await api.post('/api/debts', debt({ ticketKind: 'down', costItems: downItems(), costPending: false }));
  assert.equal(c.status, 201);
  assert.equal(N(c.body.cost_amount), 1705000, 'bỏ qua costAmount gửi lên khi có dòng');
  assert.equal(c.body.ticket_kind, 'down');
  assert.equal(c.body.cost_pending, false);
  assert.deepEqual(c.body.cost_items.map((i) => [i.label, N(i.amount), i.supplier_id, i.supplier_name]), [
    ['Giá vé F1', 1500000, F1.id, 'F1 Thùy Dương'],
    ['Phí F1', 5000, F1.id, 'F1 Thùy Dương'],
    ['Phí down', 200000, DOWN.id, 'Anh Down'],
  ]);

  const list = await api.get('/api/debts');
  const row = list.body.find((x) => x.id === c.body.id);
  assert.equal(row.ticket_kind, 'down');
  assert.equal(row.cost_pending, false);
  assert.equal(N(row.cost_unpaid), 1705000);
  assert.equal(row.cost_items.length, 3);
  const it = row.cost_items[2];
  assert.deepEqual(Object.keys(it).sort(), ['amount', 'due_date', 'id', 'label', 'paid_amount', 'supplier_id', 'supplier_name'].sort());
  assert.equal(it.due_date, '2026-11-25');
  assert.equal(typeof it.amount, 'string', 'tiền dạng chuỗi numeric');
  assert.equal(N(it.paid_amount), 0);
  // agency (cha) cũng thấy
  assert.equal((await h.api(U.agency.token).get('/api/debts')).body.find((x) => x.id === c.body.id).cost_items.length, 3);

  // audit tóm tắt giá vốn
  await h.waitFor(async () => (await h.pool.query("SELECT 1 FROM audit_logs WHERE entity = 'cost_items' AND entity_id = $1", [c.body.id])).rows.length > 0);
});

test('sửa: thay thế dòng (sửa 1, xoá 1 đã có tiền trả NCC, thêm 1) → tổng tính lại, tiền đã trả giữ nguyên (cost_item_id NULL)', async () => {
  const c = (await api.post('/api/debts', debt({ ticketKind: 'down', costItems: downItems() }))).body;
  const [i1, i2, i3] = c.cost_items;
  // Trả F1 cho dòng "Phí F1" 5.000
  const sp = await api.post(`/api/suppliers/${F1.id}/payments`, { amount: 5000, costItemId: i2.id, accountId: ACC.id });
  assert.equal(sp.status, 201);
  let r = await h.pool.query('SELECT paid_amount FROM cost_items WHERE id = $1', [i2.id]);
  assert.equal(N(r.rows[0].paid_amount), 5000);
  const supBefore = (await api.get('/api/suppliers')).body.find((s) => s.id === F1.id);

  const u = await api.put(`/api/debts/${c.id}`, debt({
    costItems: [
      { id: i1.id, label: 'Giá vé F1', amount: 1600000, supplierId: F1.id },
      { id: i3.id, label: 'Phí down', amount: 200000, supplierId: DOWN.id },
      { label: 'Khác', amount: 10000 },
    ],
  }));
  assert.equal(u.status, 200);
  assert.equal(N(u.body.cost_amount), 1810000);
  assert.deepEqual(u.body.cost_items.map((x) => x.label), ['Giá vé F1', 'Phí down', 'Khác']);
  assert.equal(u.body.cost_items[0].id, i1.id, 'giữ id dòng cũ');
  assert.equal(u.body.cost_items[1].due_date, null, 'không gửi dueDate → xoá hạn');
  assert.equal(u.body.ticket_kind, 'down', 'không gửi ticketKind → giữ nguyên');
  assert.equal((await h.pool.query('SELECT 1 FROM cost_items WHERE id = $1', [i2.id])).rows.length, 0);
  // Tiền đã trả vẫn còn, thành trả gộp.
  r = await h.pool.query('SELECT cost_item_id, amount FROM supplier_payments WHERE id = $1', [sp.body.id]);
  assert.equal(r.rows[0].cost_item_id, null);
  assert.equal(N(r.rows[0].amount), 5000);
  // Số dư NCC F1: tổng giá vốn đổi (1.505.000 → 1.600.000), đã trả giữ 5.000.
  const supAfter = (await api.get('/api/suppliers')).body.find((s) => s.id === F1.id);
  assert.equal(N(supAfter.total_paid), N(supBefore.total_paid));
  assert.equal(N(supAfter.total_cost), N(supBefore.total_cost) - 1505000 + 1600000);
  assert.equal(N(supAfter.balance), N(supAfter.total_cost) - N(supAfter.total_paid));
  // cost_unpaid chỉ tính dòng có NCC: 1.600.000 + 200.000
  const row = (await api.get('/api/debts')).body.find((x) => x.id === c.id);
  assert.equal(N(row.cost_unpaid), 1800000);

  // Không gửi khoá costItems → dòng giữ nguyên, cost_amount vẫn = tổng dòng (bỏ qua costAmount gửi lên).
  const keep = await api.put(`/api/debts/${c.id}`, debt({ costAmount: 5, notes: 'chỉ sửa ghi chú' }));
  assert.equal(keep.status, 200);
  assert.equal(keep.body.cost_items.length, 3);
  assert.equal(N(keep.body.cost_amount), 1810000);

  // Đổi NCC của dòng đã trả tiền → tiền đó tách khỏi dòng (giữ đúng số dư từng NCC).
  const sp2 = await api.post(`/api/suppliers/${DOWN.id}/payments`, { amount: 50000, costItemId: i3.id });
  assert.equal(sp2.status, 201);
  const sw = await api.put(`/api/debts/${c.id}`, debt({
    costItems: [
      { id: i1.id, label: 'Giá vé F1', amount: 1600000, supplierId: F1.id },
      { id: i3.id, label: 'Phí down', amount: 200000, supplierId: F1.id },
    ],
  }));
  assert.equal(sw.status, 200);
  assert.equal(N(sw.body.cost_items[1].paid_amount), 0);
  r = await h.pool.query('SELECT cost_item_id, supplier_id FROM supplier_payments WHERE id = $1', [sp2.body.id]);
  assert.deepEqual(r.rows[0], { cost_item_id: null, supplier_id: DOWN.id });

  // costItems: [] → xoá hết dòng, cost_amount = costAmount gửi lên.
  const empty = await api.put(`/api/debts/${c.id}`, debt({ costItems: [], costAmount: 999000 }));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.cost_items, []);
  assert.equal(N(empty.body.cost_amount), 999000);
  assert.equal((await h.pool.query('SELECT COUNT(*)::int AS n FROM cost_items WHERE debt_id = $1', [c.id])).rows[0].n, 0);
  assert.equal((await h.pool.query('SELECT COUNT(*)::int AS n FROM supplier_payments WHERE id = ANY($1)', [[sp.body.id, sp2.body.id]])).rows[0].n, 2, 'tiền đã trả NCC không mất');

  // Xoá cả vé → dòng giá vốn xoá theo, supplier_payments vẫn còn.
  const c2 = (await api.post('/api/debts', debt({ costItems: [{ label: 'Giá vé F1', amount: 100000, supplierId: F1.id, payNow: { accountId: ACC.id } }] }))).body;
  assert.equal((await api.del(`/api/debts/${c2.id}`)).status, 200);
  const left = await h.pool.query('SELECT cost_item_id FROM supplier_payments WHERE supplier_id = $1 AND amount = 100000', [F1.id]);
  assert.equal(left.rows.length, 1);
  assert.equal(left.rows[0].cost_item_id, null);
});

test('payNow: tạo supplier_payment = số còn nợ của dòng; thiếu NCC → 400; id dòng của vé khác / NCC người khác → 400 (không ghi gì)', async () => {
  const c = await api.post('/api/debts', debt({
    costItems: [
      { label: 'Giá vé F1', amount: 1000000, supplierId: F1.id, payNow: { accountId: ACC.id, payDate: '2026-11-21' } },
      { label: 'Phí F1', amount: 5000, supplierId: F1.id, payNow: true },
      { label: 'Phí down', amount: 0, supplierId: DOWN.id, payNow: {} },
    ],
  }));
  assert.equal(c.status, 201);
  assert.deepEqual(c.body.cost_items.map((i) => N(i.paid_amount)), [1000000, 5000, 0]);
  const sps = await h.pool.query('SELECT amount, account_id, pay_date, cost_item_id FROM supplier_payments WHERE cost_item_id = ANY($1) ORDER BY amount DESC', [c.body.cost_items.map((i) => i.id)]);
  assert.equal(sps.rows.length, 2, 'dòng 0đ không tạo thanh toán');
  assert.equal(N(sps.rows[0].amount), 1000000);
  assert.equal(sps.rows[0].account_id, ACC.id);
  assert.equal(sps.rows[0].pay_date, '2026-11-21');
  assert.equal(sps.rows[1].pay_date, todayLocal());
  assert.equal(N((await api.get('/api/debts')).body.find((x) => x.id === c.body.id).cost_unpaid), 0);

  // Lưu lại với payNow trên dòng đã trả đủ → bỏ qua (không trả 2 lần).
  const again = await api.put(`/api/debts/${c.body.id}`, debt({
    costItems: c.body.cost_items.map((i) => ({ id: i.id, label: i.label, amount: N(i.amount), supplierId: i.supplier_id, payNow: {} })),
  }));
  assert.equal(again.status, 200);
  assert.equal((await h.pool.query('SELECT COUNT(*)::int AS n FROM supplier_payments WHERE cost_item_id = ANY($1)', [c.body.cost_items.map((i) => i.id)])).rows[0].n, 2);
  // Tăng số tiền dòng 1 rồi payNow → chỉ trả phần chênh.
  const more = await api.put(`/api/debts/${c.body.id}`, debt({
    costItems: [{ id: c.body.cost_items[0].id, label: 'Giá vé F1', amount: 1200000, supplierId: F1.id, payNow: {} }],
  }));
  assert.equal(N(more.body.cost_items[0].paid_amount), 1200000);
  const diff = await h.pool.query('SELECT amount FROM supplier_payments WHERE cost_item_id = $1 ORDER BY id', [c.body.cost_items[0].id]);
  assert.deepEqual(diff.rows.map((x) => N(x.amount)), [1000000, 200000]);

  const counts = async () => (await h.pool.query('SELECT (SELECT COUNT(*) FROM debts) d, (SELECT COUNT(*) FROM cost_items) c, (SELECT COUNT(*) FROM supplier_payments) s')).rows[0];
  const before0 = await counts();
  let r = await api.post('/api/debts', debt({ costItems: [{ label: 'Không NCC', amount: 1000, payNow: {} }] }));
  assert.equal(r.status, 400);
  assert.match(r.body.error, /nhà cung cấp/);
  // id dòng thuộc vé khác
  const other = (await api.post('/api/debts', debt({ costItems: [{ label: 'A', amount: 1 }] }))).body;
  const before1 = await counts();
  r = await api.put(`/api/debts/${c.body.id}`, debt({ costItems: [{ id: other.cost_items[0].id, label: 'Cướp', amount: 1 }] }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Dòng giá vốn không hợp lệ');
  // NCC của người khác
  const otherSup = (await h.api(U.other.token).post('/api/suppliers', { name: 'NCC lạ' })).body;
  r = await api.post('/api/debts', debt({ costItems: [{ label: 'A', amount: 1, supplierId: otherSup.id }] }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Nhà cung cấp không hợp lệ');
  // validate từng dòng
  assert.equal((await api.post('/api/debts', debt({ costItems: [{ amount: 1 }] }))).status, 400, 'thiếu label');
  assert.equal((await api.post('/api/debts', debt({ costItems: [{ label: 'x'.repeat(101), amount: 1 }] }))).status, 400);
  assert.equal((await api.post('/api/debts', debt({ costItems: [{ label: 'A', amount: -1 }] }))).status, 400);
  assert.equal((await api.post('/api/debts', debt({ costItems: [{ label: 'A' }] }))).status, 400, 'thiếu amount');
  assert.equal((await api.post('/api/debts', debt({ costItems: [{ label: 'A', amount: 1, dueDate: '2026-02-31' }] }))).status, 400);
  assert.equal((await api.post('/api/debts', debt({ costItems: 'abc' }))).status, 400);
  assert.equal((await api.post('/api/debts', debt({ ticketKind: 'vip' }))).status, 400);
  assert.equal((await api.post('/api/debts', debt({ costPending: 'maybe' }))).status, 400);
  assert.equal((await api.put(`/api/debts/${c.body.id}`, debt({ costItems: [{ id: c.body.cost_items[0].id, label: 'A', amount: 1 }, { id: c.body.cost_items[0].id, label: 'B', amount: 1 }] }))).status, 400, 'trùng id');
  // Không ghi gì khi lỗi (ngoài vé "other" tạo hợp lệ ở trên)
  assert.deepEqual(await counts(), before1);
  assert.equal(Number(before1.d), Number(before0.d) + 1);
  // agency không sửa được giá vốn vé của child
  assert.equal((await h.api(U.agency.token).put(`/api/debts/${c.body.id}`, debt({ costItems: [] }))).status, 404);
  assert.equal((await h.pool.query('SELECT COUNT(*)::int AS n FROM cost_items WHERE debt_id = $1', [c.body.id])).rows[0].n, 1);
});

test('hộ chiếu / vé tàu / tour: costItems + costPending khi tạo/sửa, GET trả cột mới', async () => {
  const items = [{ label: 'Phí dịch vụ', amount: 300000, supplierId: DOWN.id }, { label: 'Lệ phí', amount: 200000 }];
  const cases = [
    ['/api/passports', { customerName: 'HC', serviceDate: '2026-11-10', totalAmount: 1000000 }],
    ['/api/train-tickets', { customerName: 'Tàu', trainNo: 'SE1', issueDate: '2026-11-10', ticketAmount: 1000000 }],
    ['/api/tours', { customerName: 'Tour', tourName: 'Huế', issueDate: '2026-11-10', sellAmount: 1000000 }],
  ];
  for (const [url, base] of cases) {
    const c = await api.post(url, { ...base, costAmount: 7, costItems: items, costPending: true });
    assert.equal(c.status, 201, url);
    assert.equal(N(c.body.cost_amount), 500000, url);
    assert.equal(c.body.cost_pending, true, url);
    assert.equal(c.body.cost_items.length, 2, url);

    const list = await api.get(url);
    const row = list.body.find((x) => x.id === c.body.id);
    assert.equal(row.cost_items.length, 2, url);
    assert.equal(N(row.cost_unpaid), 300000, `${url}: chỉ dòng có NCC`);
    assert.equal(row.cost_pending, true, url);

    // Sửa: bỏ cờ chờ giá vốn, sửa 1 dòng + xoá 1 dòng.
    const u = await api.put(`${url}/${c.body.id}`, { ...base, costPending: false, costItems: [{ id: c.body.cost_items[0].id, label: 'Phí dịch vụ', amount: 350000, supplierId: DOWN.id }] });
    assert.equal(u.status, 200, url);
    assert.equal(N(u.body.cost_amount), 350000, url);
    assert.equal(u.body.cost_pending, false, url);
    // Không gửi costPending → giữ nguyên; không gửi costItems → giữ dòng
    const k = await api.put(`${url}/${c.body.id}`, { ...base, notes: 'x' });
    assert.equal(k.body.cost_pending, false, url);
    assert.equal(k.body.cost_items.length, 1, url);
    assert.equal(N(k.body.cost_amount), 350000, url);
    // Không có dòng nào: costAmount vắng → giữ giá trị cũ; có gửi → dùng giá trị gửi.
    const e = await api.put(`${url}/${c.body.id}`, { ...base, costItems: [], costAmount: 123 });
    assert.equal(N(e.body.cost_amount), 123, url);
    const e2 = await api.put(`${url}/${c.body.id}`, { ...base });
    assert.equal(N(e2.body.cost_amount), 123, `${url}: costAmount vắng → giữ`);
    // id dòng không thuộc dịch vụ này → 400
    assert.equal((await api.put(`${url}/${c.body.id}`, { ...base, costItems: [{ id: 999999, label: 'A', amount: 1 }] })).status, 400, url);
  }
});

test('stats: lợi nhuận bỏ qua dòng cost_pending; supplierOwed, walletTotal, othersHolding, todo.costPending, todo.supplierDue', async () => {
  const S = await h.createUser({ username: 'statsuser' });
  const s = h.api(S.token);
  const today = todayLocal();
  const sup1 = (await s.post('/api/suppliers', { name: 'F1 Stats', kind: 'f1' })).body;
  const sup2 = (await s.post('/api/suppliers', { name: 'Down Stats', kind: 'down' })).body;
  const own = (await s.post('/api/accounts', { name: 'TK mình', openingBalance: 100000 })).body;
  const held = (await s.post('/api/accounts', { name: 'TK chị Lan', isOwn: false, openingBalance: 50000 })).body;

  const A = (await s.post('/api/debts', {
    customerName: 'Khách A', phoneNumber: '0101', issueDate: today, ticketAmount: 1000000,
    costItems: [{ label: 'Giá vé F1', amount: 800000, supplierId: sup1.id, dueDate: addDays(today, 3) }],
  })).body;
  const B = (await s.post('/api/debts', { customerName: 'Khách B', issueDate: today, ticketAmount: 500000, costPending: true })).body;
  const C = (await s.post('/api/passports', { customerName: 'Khách C', serviceDate: today, totalAmount: 300000, costPending: true })).body;
  (await s.post('/api/debts', {
    customerName: 'Khách D', issueDate: today, ticketAmount: 100000,
    costItems: [
      { label: 'Phí down', amount: 50000, supplierId: sup2.id, dueDate: addDays(today, 30) },
      { label: 'Phí F1', amount: 5000, supplierId: sup1.id, dueDate: addDays(today, -1), payNow: { accountId: own.id } },
    ],
  }));
  assert.equal((await s.post(`/api/suppliers/${sup1.id}/payments`, { amount: 300000, costItemId: A.cost_items[0].id, accountId: own.id })).status, 201);
  // Ví khách A: nạp 700k vào TK mình, trừ ví 200k.
  assert.equal((await s.post(`/api/wallets/${A.customer_id}/topup`, { amount: 700000, accountId: own.id })).status, 201);
  assert.equal((await s.post('/api/payments', { debtId: A.id, amount: 200000, method: 'wallet' })).status, 201);
  // Khách B trả 250k vào TK người khác giữ hộ.
  assert.equal((await s.post('/api/payments', { debtId: B.id, amount: 250000, accountId: held.id })).status, 201);

  const r = await s.get('/api/stats');
  assert.equal(r.status, 200);
  const st = r.body;
  // Doanh số vẫn tính cả dòng chờ giá vốn: 1tr + 500k + 300k + 100k
  assert.equal(st.totalAmount, 1900000);
  assert.equal(st.totalPaid, 450000);
  assert.equal(st.outstanding, 1450000);
  // Lợi nhuận: A (1tr − 800k) + D (100k − 55k) — bỏ B và C.
  assert.equal(st.totalProfit, 245000);
  assert.equal(st.costPendingCount, 2);
  assert.equal(st.byType.debts.profit, 245000);
  assert.equal(st.byType.debts.costPendingCount, 1);
  assert.equal(st.byType.passports.profit, 0);
  assert.equal(st.byType.passports.costPendingCount, 1);
  assert.equal(st.byType.debts.cost, 855000, 'giá vốn vẫn là tổng cost_amount');
  const month = st.monthly.find((x) => x.month === today.slice(0, 7));
  assert.equal(month.amount, 1900000);
  assert.equal(month.profit, 245000);
  // Nợ NCC = (800k + 50k + 5k) − (300k + 5k)
  assert.equal(st.supplierOwed, 550000);
  assert.equal(st.walletTotal, 500000);
  assert.equal(st.othersHolding, 300000);
  // todo.costPending
  assert.deepEqual(st.todo.costPending.map((x) => [x.type, x.id, x.customer_name, x.issue_date, x.amount]).sort(), [
    ['debt', B.id, 'Khách B', today, 500000],
    ['passport', C.id, 'Khách C', today, 300000],
  ].sort());
  // todo.supplierDue: chỉ dòng còn nợ có hạn ≤ hôm nay + 7 (dòng Phí F1 quá hạn đã trả đủ, Phí down hạn +30)
  assert.equal(st.todo.supplierDue.length, 1);
  const due = st.todo.supplierDue[0];
  assert.equal(due.supplier_id, sup1.id);
  assert.equal(due.supplier_name, 'F1 Stats');
  assert.equal(due.label, 'Giá vé F1');
  assert.equal(due.amount_due, 500000);
  assert.equal(due.due_date, addDays(today, 3));
  assert.equal(due.target_label, 'Vé');
  assert.equal(due.target_type, 'debt');
  assert.equal(due.target_id, A.id);

  // Phạm vi: user khác không thấy số liệu của statsuser.
  const o = (await h.api(U.other.token).get('/api/stats')).body;
  assert.equal(o.supplierOwed, 0);
  assert.equal(o.walletTotal, 0);
  assert.equal(o.othersHolding, 0);
  assert.deepEqual(o.todo.costPending, []);
});
