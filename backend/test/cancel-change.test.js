// test/cancel-change.test.js — Dòng tiền v3.1: huỷ / hoàn vé (cả 4 dịch vụ), hoàn tác huỷ khôi phục
// CHÍNH XÁC mọi con số (giá bán, đã trả, giá vốn, dòng giá vốn, số dư NCC, ví, tài khoản, lãi),
// chặn khi ví đã tiêu; đổi vé máy bay; NCC trả lại tiền (direction 'in').
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');
const { todayLocal, addDays } = require('../utils/dates');

let U;
let api;
let F1;
let DOWN;
let ACC;
let ACC2;
before(async () => {
  await h.start();
  U = await h.seedUsers();
  api = h.api(U.child.token);
  F1 = (await api.post('/api/suppliers', { name: 'F1 Thùy Dương', kind: 'f1' })).body;
  DOWN = (await api.post('/api/suppliers', { name: 'Anh Down', kind: 'down' })).body;
  ACC = (await api.post('/api/accounts', { name: 'TCB', openingBalance: 0 })).body;
  ACC2 = (await api.post('/api/accounts', { name: 'VIB', openingBalance: 0 })).body;
});
after(() => h.stop());

const N = (x) => Number(x);
const TABLE = { debt: ['debts', 'debt_id', 'ticket_amount', 'paid'], passport: ['passports', 'passport_id', 'total_amount', 'paid_amount'], train: ['train_tickets', 'train_ticket_id', 'ticket_amount', 'paid'], tour: ['tours', 'tour_id', 'sell_amount', 'paid'] };
const URL = { debt: 'debts', passport: 'passports', train: 'train-tickets', tour: 'tours' };

/** Ảnh chụp mọi con số liên quan tới 1 dịch vụ + khách của nó. */
async function snap(type, id, customerId) {
  const [table, col, price, paid] = TABLE[type];
  const row = (await h.pool.query(
    `SELECT ${price} AS price, ${paid} AS paid, cost_amount, original_amount, status, cancelled_at, cancel_note FROM ${table} WHERE id = $1`, [id]
  )).rows[0];
  const items = (await h.pool.query(
    `SELECT label, amount, paid_amount, supplier_id, kind FROM cost_items WHERE ${col} = $1 ORDER BY id`, [id]
  )).rows;
  const payments = (await h.pool.query(`SELECT amount, kind, method, account_id FROM payments WHERE ${col} = $1 ORDER BY id`, [id])).rows;
  const sups = Object.fromEntries((await api.get('/api/suppliers')).body.map((s) => [s.name, [s.total_cost, s.total_paid, s.balance]]));
  const accs = Object.fromEntries((await api.get('/api/accounts')).body.map((a) => [a.name, [a.balance, a.total_in, a.total_out]]));
  const wallet = customerId ? (await api.get(`/api/wallets/${customerId}`)).body.balance : null;
  const stats = (await api.get('/api/stats')).body;
  return {
    row, items, payments, sups, accs, wallet,
    profit: stats.totalProfit, supplierOwed: stats.supplierOwed, walletTotal: stats.walletTotal, cancelled: stats.counts.cancelled,
  };
}

const downItems = () => [
  { label: 'Giá vé F1', amount: 1500000, supplierId: F1.id },
  { label: 'Phí F1', amount: 5000, supplierId: F1.id },
  { label: 'Phí down', amount: 200000, supplierId: DOWN.id },
];

test('huỷ vé down (đã trả 1 phần, NCC hoàn nhận ngay + chưa nhận) → số liệu đúng; hoàn tác khôi phục chính xác', async () => {
  const d = (await api.post('/api/debts', {
    customerName: 'Khách Huỷ', phoneNumber: '0911', ticketCode: 'VJ1', route: 'SGN-HAN', issueDate: '2026-11-01',
    ticketAmount: 2000000, paid: 500000, accountId: ACC.id, ticketKind: 'down', costItems: downItems(),
  })).body;
  const cid = d.customer_id;
  // Đã trả F1 đủ giá vé 1,5tr từ TCB
  assert.equal((await api.post(`/api/suppliers/${F1.id}/payments`, { amount: 1500000, accountId: ACC.id, costItemId: d.cost_items[0].id })).status, 201);
  const before0 = await snap('debt', d.id, cid);
  assert.equal(N(before0.row.cost_amount), 1705000);

  // Lỗi: hoàn quá số đã trả, NCC lạ, TK lạ → 400, không đổi gì
  const foreignSup = (await h.api(U.other.token).post('/api/suppliers', { name: 'NCC lạ' })).body;
  const foreignAcc = (await h.api(U.other.token).post('/api/accounts', { name: 'TK lạ' })).body;
  for (const body of [
    { finalAmount: 300000, customerRefund: { amount: 600000 } },
    { finalAmount: 300000, supplierRefunds: [{ supplierId: foreignSup.id, amount: 1000 }] },
    { finalAmount: 300000, supplierRefunds: [{ supplierId: F1.id, amount: 1000, receivedNow: true, accountId: foreignAcc.id }] },
    { finalAmount: 300000, customerRefund: { to: 'account', accountId: foreignAcc.id } },
    { finalAmount: -1 },
    { finalAmount: 300000, supplierRefunds: [{ supplierId: F1.id, amount: 0 }] },
    { finalAmount: 300000, customerRefund: { to: 'bank' } },
  ]) {
    const r = await api.post(`/api/debts/${d.id}/cancel`, body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.match((await api.post(`/api/debts/${d.id}/cancel`, { customerRefund: { amount: 600000 } })).body.error, /Không hoàn quá/);
  assert.equal((await h.api(U.agency.token).post(`/api/debts/${d.id}/cancel`, {})).status, 404, 'cấp trên không huỷ được');
  assert.deepEqual(await snap('debt', d.id, cid), before0, 'lỗi → không đổi gì');

  // Huỷ: khách chịu 300k → hoàn 200k vào ví (mặc định); F1 hoàn 1,2tr nhận ngay vào VIB; Down hoàn 50k chưa nhận.
  const c = await api.post(`/api/debts/${d.id}/cancel`, {
    cancelDate: '2026-11-10', note: 'khách bận', finalAmount: 300000,
    supplierRefunds: [
      { supplierId: F1.id, amount: 1200000, receivedNow: true, accountId: ACC2.id },
      { supplierId: DOWN.id, amount: 50000 },
    ],
  });
  assert.equal(c.status, 200);
  assert.equal(c.body.status, 'cancelled');
  assert.equal(N(c.body.ticket_amount), 300000);
  assert.equal(N(c.body.original_amount), 2000000);
  assert.equal(N(c.body.paid), 300000);
  assert.equal(c.body.cancelled_at, '2026-11-10');
  assert.equal(c.body.cancel_note, 'khách bận');
  assert.equal(N(c.body.cost_amount), 1705000 - 1250000);
  assert.deepEqual(c.body.cost_items.map((i) => [i.label, N(i.amount), N(i.paid_amount), i.kind]), [
    ['Giá vé F1', 1500000, 1500000, 'cost'], ['Phí F1', 5000, 0, 'cost'], ['Phí down', 200000, 0, 'cost'],
    ['Hoàn từ F1 Thùy Dương', -1200000, -1200000, 'refund'], ['Hoàn từ Anh Down', -50000, 0, 'refund'],
  ]);

  const after1 = await snap('debt', d.id, cid);
  assert.equal(N(after1.wallet), 200000, 'hoàn vào ví');
  assert.deepEqual(after1.payments.map((p) => [N(p.amount), p.kind, p.method]), [[500000, 'payment', 'cash'], [-200000, 'refund', 'wallet']]);
  // NCC: F1 nợ 5k như cũ (cost 305k − paid 300k); Down còn nợ 150k
  assert.deepEqual(after1.sups['F1 Thùy Dương'].map(N), [305000, 300000, 5000]);
  assert.deepEqual(after1.sups['Anh Down'].map(N), [150000, 0, 150000]);
  // TK: TCB không đổi (hoàn vào ví), VIB +1,2tr (NCC trả lại)
  assert.deepEqual(after1.accs.TCB, before0.accs.TCB);
  assert.equal(N(after1.accs.VIB[0]), N(before0.accs.VIB[0]) + 1200000);
  // Lãi = phí khách chịu − giá vốn không được hoàn = 300k − 455k
  assert.equal(after1.profit - before0.profit, (300000 - 455000) - (2000000 - 1705000));
  assert.equal(after1.cancelled, before0.cancelled + 1);
  // Sổ VIB: dòng supplier_refund chiều vào
  const ledV = (await api.get(`/api/accounts/${ACC2.id}/ledger`)).body;
  const sr = ledV.rows.find((x) => x.kind === 'supplier_refund');
  assert.equal(sr.direction, 'in');
  assert.equal(N(sr.amount), 1200000);
  assert.match(sr.description, /^Nhận lại từ F1 Thùy Dương · Hoàn từ F1 Thùy Dương \(vé VJ1 SGN-HAN\)$/);
  // Sổ NCC: items có kind; payments có dòng âm (NCC trả lại)
  const slF1 = (await api.get(`/api/suppliers/${F1.id}/ledger`)).body;
  const myItems = slF1.items.filter((i) => i.target.type === 'debt' && i.target.id === d.id);
  assert.deepEqual(myItems.map((i) => [i.label, i.kind, N(i.amount)]).sort(), [
    ['Giá vé F1', 'cost', 1500000], ['Hoàn từ F1 Thùy Dương', 'refund', -1200000], ['Phí F1', 'cost', 5000],
  ].sort());
  assert.ok(slF1.payments.some((p) => N(p.amount) === -1200000 && p.cost_item_label === 'Hoàn từ F1 Thùy Dương'));
  // Ví: dòng credit gắn payment hoàn
  const w = (await api.get(`/api/wallets/${cid}`)).body;
  const credit = w.entries.find((e) => e.kind === 'credit');
  assert.equal(N(credit.amount), 200000);
  assert.equal(credit.target_label, 'Vé VJ1 SGN-HAN');

  // Đã huỷ: huỷ lại / thanh toán / đổi vé → 400; không vào công nợ khách; không xoá thẳng được
  assert.match((await api.post(`/api/debts/${d.id}/cancel`, {})).body.error, /đã huỷ/);
  assert.equal((await api.post('/api/payments', { debtId: d.id, amount: 1000 })).status, 400);
  assert.equal((await api.post('/api/payments', { debtId: d.id, amount: 1000, method: 'wallet' })).status, 400);
  assert.equal((await api.post('/api/receipts', { amount: 1000, allocations: [{ type: 'debt', id: d.id, amount: 1000 }] })).status, 400);
  assert.equal((await api.post(`/api/debts/${d.id}/change`, { customerFee: 1 })).status, 400);
  assert.ok(!(await api.get(`/api/customers/${cid}/outstanding`)).body.some((x) => x.type === 'debt' && x.id === d.id));
  assert.equal((await api.del(`/api/debts/${d.id}`)).status, 400);
  assert.equal((await api.post('/api/debts/bulk-delete', { ids: [d.id] })).status, 400);
  assert.equal((await api.del(`/api/wallets/entries/${credit.id}`)).status, 400);
  // Sửa dịch vụ đã huỷ gửi lại nguyên cost_items (kể cả dòng hoàn âm) → dòng hoàn giữ nguyên
  const put = await api.put(`/api/debts/${d.id}`, {
    customerName: 'Khách Huỷ', phoneNumber: '0911', ticketCode: 'VJ1', route: 'SGN-HAN', issueDate: '2026-11-01', ticketAmount: 300000,
    costItems: c.body.cost_items.map((i) => ({ id: i.id, label: i.label, amount: i.amount, supplierId: i.supplier_id })),
  });
  assert.equal(put.status, 200);
  assert.equal(N(put.body.cost_amount), 455000);
  // FE bỏ dòng hoàn khỏi mảng → vẫn không bị xoá
  const put2 = await api.put(`/api/debts/${d.id}`, {
    customerName: 'Khách Huỷ', phoneNumber: '0911', ticketCode: 'VJ1', route: 'SGN-HAN', issueDate: '2026-11-01', ticketAmount: 300000,
    costItems: c.body.cost_items.filter((i) => i.kind !== 'refund').map((i) => ({ id: i.id, label: i.label, amount: i.amount, supplierId: i.supplier_id })),
  });
  assert.equal(put2.body.cost_items.length, 5);
  // dòng thường không được âm
  assert.equal((await api.put(`/api/debts/${d.id}`, {
    customerName: 'Khách Huỷ', ticketAmount: 300000, costItems: [{ id: c.body.cost_items[1].id, label: 'Phí F1', amount: -5 }],
  })).status, 400);
  assert.deepEqual(await snap('debt', d.id, cid), after1, 'sửa không làm đổi số liệu');

  // Hoàn tác → mọi con số về đúng như trước khi huỷ
  const u = await api.post(`/api/debts/${d.id}/uncancel`, {});
  assert.equal(u.status, 200);
  assert.equal(u.body.status, 'active');
  assert.deepEqual(await snap('debt', d.id, cid), before0);
  assert.match((await api.post(`/api/debts/${d.id}/uncancel`, {})).body.error, /chưa huỷ/);
  const audit = await h.waitFor(async () => {
    const r = await h.pool.query("SELECT details->>'action' AS a FROM audit_logs WHERE entity = 'debt' AND entity_id = $1 AND details ? 'action'", [d.id]);
    return r.rows.length >= 2 ? r.rows.map((x) => x.a).sort() : null;
  });
  assert.deepEqual(audit, ['cancel', 'uncancel']);
});

test('hoàn tác bị chặn khi khách đã tiêu tiền hoàn trong ví; hoàn qua tài khoản; NCC chưa có dòng giá vốn', async () => {
  const k = { customerName: 'Khách Tiêu', phoneNumber: '0922' };
  const d = (await api.post('/api/debts', { ...k, ticketAmount: 1000000, costAmount: 700000, paid: 1000000, accountId: ACC.id, issueDate: '2026-11-02' })).body;
  const cid = d.customer_id;
  const before0 = await snap('debt', d.id, cid);

  // Hoàn qua TK TCB 400k (khách chịu 600k); F1 hoàn 300k chưa nhận → dòng "Giá vốn" 700k được giữ
  let c = await api.post(`/api/debts/${d.id}/cancel`, { finalAmount: 600000, customerRefund: { to: 'account', accountId: ACC.id }, supplierRefunds: [{ supplierId: F1.id, amount: 300000 }] });
  assert.equal(c.status, 200);
  assert.equal(N(c.body.paid), 600000);
  assert.deepEqual(c.body.cost_items.map((i) => [i.label, N(i.amount), i.supplier_id, i.kind]), [['Giá vốn', 700000, null, 'cost'], ['Hoàn từ F1 Thùy Dương', -300000, F1.id, 'refund']]);
  assert.equal(N(c.body.cost_amount), 400000);
  let s = await snap('debt', d.id, cid);
  assert.equal(N(s.accs.TCB[0]), N(before0.accs.TCB[0]) - 400000);
  assert.equal(N(s.wallet), 0);
  assert.equal(N(s.sups['F1 Thùy Dương'][2]), N(before0.sups['F1 Thùy Dương'][2]) - 300000);
  const led = (await api.get(`/api/accounts/${ACC.id}/ledger`)).body;
  const cr = led.rows.find((x) => x.kind === 'customer_refund');
  assert.equal(cr.direction, 'out');
  assert.equal(N(cr.amount), 400000);
  assert.deepEqual(cr.ref, { type: 'debt', id: d.id });
  let run = N(led.opening);
  for (const r of led.rows) run += r.direction === 'in' ? N(r.amount) : -N(r.amount);
  assert.equal(run, N(led.closing));
  assert.equal((await api.post(`/api/debts/${d.id}/uncancel`)).status, 200);
  s = await snap('debt', d.id, cid);
  // Khác duy nhất: giá vốn cũ giờ nằm ở 1 dòng "Giá vốn" (cost_amount không đổi)
  assert.deepEqual(s.items.map((i) => [i.label, N(i.amount), i.kind]), [['Giá vốn', 700000, 'cost']]);
  assert.deepEqual({ ...s, items: [] }, { ...before0, items: [] });

  // Hoàn vào ví 400k rồi khách tiêu 300k → hoàn tác bị chặn
  c = await api.post(`/api/debts/${d.id}/cancel`, { finalAmount: 600000 });
  assert.equal(N((await api.get(`/api/wallets/${cid}`)).body.balance), 400000);
  const d2 = (await api.post('/api/debts', { ...k, ticketAmount: 900000 })).body;
  const spend = await api.post('/api/payments', { debtId: d2.id, amount: 300000, method: 'wallet' });
  assert.equal(spend.status, 201);
  const refundPay = (await api.get(`/api/payments?debtId=${d.id}`)).body.find((p) => p.kind === 'refund');
  assert.equal((await api.del(`/api/payments/${refundPay.id}`)).status, 400, 'xoá payment hoàn → ví sẽ âm');
  const blocked = await api.post(`/api/debts/${d.id}/uncancel`);
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /đã dùng tiền hoàn/);
  assert.equal((await h.pool.query('SELECT status FROM debts WHERE id = $1', [d.id])).rows[0].status, 'cancelled');
  assert.equal((await api.del(`/api/payments/${spend.body.id}`)).status, 200);
  assert.equal((await api.post(`/api/debts/${d.id}/uncancel`)).status, 200);
  s = await snap('debt', d.id, cid);
  // d2 (900k, giá vốn 0) tạo giữa chừng → lãi tổng +900k; mọi số khác như trước khi huỷ
  assert.deepEqual({ ...s, items: [], profit: 0 }, { ...before0, items: [], profit: 0 });
  assert.equal(s.profit, before0.profit + 900000);
  assert.equal(N(s.wallet), 0);

  // Vé không có giá vốn: NCC hoàn chưa nhận → cost_amount âm; hoàn tác → về 0
  const d3 = (await api.post('/api/debts', { ...k, ticketAmount: 500000 })).body;
  const b3 = await snap('debt', d3.id, cid);
  c = await api.post(`/api/debts/${d3.id}/cancel`, { supplierRefunds: [{ supplierId: DOWN.id, amount: 20000 }] });
  assert.equal(N(c.body.cost_amount), -20000);
  assert.equal(N(c.body.ticket_amount), 0);
  assert.equal((await api.post(`/api/debts/${d3.id}/uncancel`)).status, 200);
  assert.deepEqual(await snap('debt', d3.id, cid), b3);

  // Không có khách → mặc định hoàn qua TK; ép vào ví → 400
  const t = (await h.pool.query("INSERT INTO debts (user_id, customer_name, ticket_amount, paid) VALUES ($1, 'Không khách', 100000, 0) RETURNING id", [U.child.id])).rows[0];
  await h.pool.query("INSERT INTO payments (user_id, debt_id, amount, method) VALUES ($1, $2, 100000, 'cash')", [U.child.id, t.id]);
  await h.pool.query('UPDATE debts SET paid = 100000 WHERE id = $1', [t.id]);
  assert.equal((await api.post(`/api/debts/${t.id}/cancel`, { customerRefund: { to: 'wallet' } })).status, 400);
  c = await api.post(`/api/debts/${t.id}/cancel`, {});
  assert.equal(c.status, 200);
  const rp = (await h.pool.query("SELECT amount, method, account_id FROM payments WHERE debt_id = $1 AND kind = 'refund'", [t.id])).rows[0];
  assert.deepEqual([N(rp.amount), rp.method, rp.account_id], [-100000, 'bank_transfer', null]);
  assert.equal((await api.post(`/api/debts/${t.id}/uncancel`)).status, 200);
});

test('huỷ / hoàn tác cho hộ chiếu, vé tàu, tour (tour dùng status cancelled → deposited)', async () => {
  const k = { customerName: 'Khách 3 loại', phoneNumber: '0933' };
  const ps = (await api.post('/api/passports', { ...k, serviceDate: '2026-11-03', totalAmount: 900000, costAmount: 500000, paidAmount: 900000, accountId: ACC.id })).body;
  const tr = (await api.post('/api/train-tickets', { ...k, trainNo: 'SE5', ticketAmount: 400000, paid: 100000 })).body;
  const tu = (await api.post('/api/tours', { ...k, tourName: 'Huế', sellAmount: 5000000, costAmount: 4000000, paid: 2000000, status: 'deposited' })).body;
  const cid = ps.customer_id;
  const cases = [
    ['passport', ps.id, { finalAmount: 100000 }, 800000, 'active'],
    ['train', tr.id, { finalAmount: 50000, supplierRefunds: [{ supplierId: F1.id, amount: 1000, receivedNow: true, accountId: ACC.id }] }, 50000, 'active'],
    ['tour', tu.id, { finalAmount: 500000, supplierRefunds: [{ supplierId: DOWN.id, amount: 3000000 }] }, 1500000, 'deposited'],
  ];
  for (const [type, id, body, refund, active] of cases) {
    const b0 = await snap(type, id, cid);
    const w0 = N(b0.wallet);
    const c = await api.post(`/api/${URL[type]}/${id}/cancel`, body);
    assert.equal(c.status, 200, type);
    assert.equal(c.body.status, 'cancelled');
    assert.equal(N(c.body[TABLE[type][2]]), body.finalAmount);
    assert.equal(N(c.body[TABLE[type][3]]), body.finalAmount, `${type}: đã trả = phí khách chịu`);
    const s = await snap(type, id, cid);
    assert.equal(N(s.wallet), w0 + refund, `${type}: hoàn vào ví`);
    assert.equal((await api.post(`/api/${URL[type]}/${id}/cancel`, body)).status, 400);
    assert.equal((await api.post('/api/payments', { [{ passport: 'passportId', train: 'trainTicketId', tour: 'tourId' }[type]]: id, amount: 1 })).status, 400);
    assert.equal((await api.del(`/api/${URL[type]}/${id}`)).status, 400, `${type}: không xoá khi còn hoàn tiền`);
    const u = await api.post(`/api/${URL[type]}/${id}/uncancel`);
    assert.equal(u.status, 200);
    assert.equal(u.body.status, active);
    const back = await snap(type, id, cid);
    assert.deepEqual({ ...back, items: [] }, { ...b0, items: [] }, `${type}: hoàn tác khôi phục`);
    assert.equal(N(back.row.cost_amount), N(b0.row.cost_amount));
  }
  // Tour đã huỷ qua "Huỷ / hoàn" → không đổi status trực tiếp bằng PUT
  await api.post(`/api/tours/${tu.id}/cancel`, { finalAmount: 0, customerRefund: { amount: 0 } });
  const put = await api.put(`/api/tours/${tu.id}`, { customerName: k.customerName, phoneNumber: k.phoneNumber, sellAmount: 0, status: 'completed' });
  assert.equal(put.status, 400);
  assert.equal((await api.put(`/api/tours/${tu.id}`, { customerName: k.customerName, phoneNumber: k.phoneNumber, sellAmount: 0, status: 'cancelled', notes: 'x' })).status, 200);
  assert.equal((await api.post(`/api/tours/${tu.id}/uncancel`)).status, 200);
  assert.equal(N((await h.pool.query('SELECT sell_amount FROM tours WHERE id = $1', [tu.id])).rows[0].sell_amount), 5000000);
  assert.equal((await api.post('/api/passports/999999/cancel', {})).status, 404);
  assert.equal((await api.post('/api/train-tickets/abc/uncancel', {})).status, 400);
  assert.equal((await h.api(null).post(`/api/tours/${tu.id}/cancel`, {})).status, 401);
});

test('dịch vụ đã huỷ không vào quá hạn / đến hạn / bay ngày mai / chưa đủ giá vốn; counts.cancelled', async () => {
  const today = todayLocal();
  const k = { customerName: 'Khách Todo', phoneNumber: '0944' };
  const late = (await api.post('/api/debts', { ...k, ticketAmount: 700000, dueDate: addDays(today, -3), flightDate: addDays(today, 1), costPending: true })).body;
  const soon = (await api.post('/api/tours', { ...k, sellAmount: 300000, dueDate: addDays(today, 2) })).body;
  let s = (await api.get('/api/stats')).body;
  assert.ok(s.todo.overdue.some((x) => x.type === 'debt' && x.id === late.id));
  assert.ok(s.todo.dueSoon.some((x) => x.type === 'tour' && x.id === soon.id));
  assert.ok(s.todo.flightsTomorrow.some((x) => x.id === late.id));
  assert.ok(s.todo.costPending.some((x) => x.type === 'debt' && x.id === late.id));
  const overdue0 = s.overdue;
  const c0 = s.counts.cancelled;

  // Huỷ nhưng khách vẫn chịu phí (chưa trả đồng nào) → phí còn nợ VẪN phải nhắc (quá hạn / đến hạn),
  // còn "bay ngày mai" và "chưa đủ giá vốn" thì bỏ.
  assert.equal((await api.post(`/api/debts/${late.id}/cancel`, { finalAmount: 200000 })).status, 200);
  assert.equal((await api.post(`/api/tours/${soon.id}/cancel`, { finalAmount: 100000 })).status, 200);
  s = (await api.get('/api/stats')).body;
  assert.ok(s.todo.overdue.some((x) => x.type === 'debt' && x.id === late.id && N(x.outstanding) === 200000));
  assert.ok(s.todo.dueSoon.some((x) => x.type === 'tour' && x.id === soon.id && N(x.outstanding) === 100000));
  assert.ok(!s.todo.flightsTomorrow.some((x) => x.id === late.id));
  assert.ok(!s.todo.costPending.some((x) => x.id === late.id && x.type === 'debt'));
  assert.equal(s.overdue, overdue0 - 500000);
  assert.equal(s.counts.cancelled, c0 + 2);
  assert.equal((await h.api(U.agency.token).get(`/api/stats?agencyId=${U.child.id}`)).body.counts.cancelled, c0 + 2);
  assert.equal((await api.post(`/api/debts/${late.id}/uncancel`)).status, 200);
  assert.equal((await api.post(`/api/tours/${soon.id}/uncancel`)).status, 200);
  assert.equal((await api.get('/api/stats')).body.counts.cancelled, c0);
});

test('đổi vé: giá bán += phí khách, dòng "Phí đổi vé" (kind change) gắn NCC, giữ giá vốn cũ thành dòng "Giá vốn", ghi chú', async () => {
  const d = (await api.post('/api/debts', {
    customerName: 'Khách Đổi', ticketCode: 'VN9', route: 'HAN-SGN', flightDate: '2026-12-01', issueDate: '2026-11-04',
    ticketAmount: 1200000, costAmount: 1000000, notes: 'ghi chú cũ',
  })).body;
  const f1Before = N((await api.get('/api/suppliers')).body.find((x) => x.id === F1.id).balance);
  const foreignSup = (await h.api(U.other.token).post('/api/suppliers', { name: 'NCC lạ 2' })).body;
  const r0 = (await h.pool.query('SELECT ticket_amount, cost_amount, notes FROM debts WHERE id = $1', [d.id])).rows[0];
  for (const body of [{ supplierFee: 1000, supplierId: foreignSup.id }, { customerFee: -1 }, { newFlightDate: '2026-13-01' }, { newRoute: 'x'.repeat(51) }]) {
    assert.equal((await api.post(`/api/debts/${d.id}/change`, body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await h.api(U.agency.token).post(`/api/debts/${d.id}/change`, { customerFee: 1 })).status, 404);
  assert.deepEqual((await h.pool.query('SELECT ticket_amount, cost_amount, notes FROM debts WHERE id = $1', [d.id])).rows[0], r0);
  assert.equal((await h.pool.query('SELECT COUNT(*)::int n FROM cost_items WHERE debt_id = $1', [d.id])).rows[0].n, 0);

  const c = await api.post(`/api/debts/${d.id}/change`, {
    changeDate: '2026-11-20', customerFee: 200000, supplierFee: 150000, supplierId: F1.id,
    newFlightDate: '2026-12-05', newRoute: 'HAN-PQC', newTicketCode: 'VN10', note: 'khách đổi ngày',
  });
  assert.equal(c.status, 200);
  assert.equal(N(c.body.ticket_amount), 1400000);
  assert.equal(N(c.body.cost_amount), 1150000);
  assert.deepEqual(c.body.cost_items.map((i) => [i.label, N(i.amount), i.supplier_id, i.kind]), [
    ['Giá vốn', 1000000, null, 'cost'], ['Phí đổi vé', 150000, F1.id, 'change'],
  ]);
  const chItem = (await api.get(`/api/suppliers/${F1.id}/ledger`)).body.items.find((i) => i.target.id === d.id && i.target.type === 'debt');
  assert.equal(chItem.kind, 'change');
  assert.equal(c.body.flight_date, '2026-12-05');
  assert.equal(c.body.route, 'HAN-PQC');
  assert.equal(c.body.ticket_code, 'VN10');
  assert.ok(c.body.notes.startsWith('ghi chú cũ\n[20/11/2026] Đổi vé: '));
  assert.match(c.body.notes, /mã VN9 → VN10; hành trình HAN-SGN → HAN-PQC; ngày bay 01\/12\/2026 → 05\/12\/2026; phí khách 200\.000₫; phí NCC 150\.000₫; khách đổi ngày$/);
  assert.equal(N((await api.get('/api/suppliers')).body.find((x) => x.id === F1.id).balance), f1Before + 150000);

  // Đổi lần 2 (đã có dòng) chỉ thêm phí; không phí NCC → không thêm dòng
  const c2 = await api.post(`/api/debts/${d.id}/change`, { customerFee: 50000, supplierFee: 30000 });
  assert.equal(c2.body.cost_items.length, 3);
  assert.equal(N(c2.body.cost_amount), 1180000);
  assert.equal(N(c2.body.ticket_amount), 1450000);
  const c3 = await api.post(`/api/debts/${d.id}/change`, { customerFee: 0, note: 'chỉ ghi chú' });
  assert.equal(c3.body.cost_items.length, 3);
  assert.equal(c3.body.notes.split('\n').length, 4);
  await h.waitFor(async () => (await h.pool.query("SELECT 1 FROM audit_logs WHERE entity = 'debt' AND entity_id = $1 AND details->>'action' = 'change'", [d.id])).rows.length >= 3);

  // Vé không có giá vốn, đổi có phí NCC → chỉ 1 dòng phí đổi
  const e = (await api.post('/api/debts', { customerName: 'Khách Đổi 2', ticketAmount: 500000 })).body;
  const ce = await api.post(`/api/debts/${e.id}/change`, { supplierFee: 40000 });
  assert.deepEqual(ce.body.cost_items.map((i) => [i.label, N(i.amount)]), [['Phí đổi vé', 40000]]);
  assert.equal(N(ce.body.cost_amount), 40000);
});

test('NCC trả lại tiền (direction in): lưu âm, sổ TK supplier_refund chiều vào, số dư TK tăng', async () => {
  const S = (await api.post('/api/suppliers', { name: 'F1 Trả lại', kind: 'f1' })).body;
  const A = (await api.post('/api/accounts', { name: 'ACB nhận lại' })).body;
  assert.equal((await api.post(`/api/suppliers/${S.id}/payments`, { amount: 1000, direction: 'sideways' })).status, 400);
  const r = await api.post(`/api/suppliers/${S.id}/payments`, { amount: 70000, direction: 'in', accountId: A.id, payDate: '2026-11-21', notes: 'trả dư' });
  assert.equal(r.status, 201);
  assert.equal(N(r.body.amount), -70000);
  const out = await api.post(`/api/suppliers/${S.id}/payments`, { amount: 20000, accountId: A.id, payDate: '2026-11-22' });
  assert.equal(N(out.body.amount), 20000, 'mặc định out');
  const acc = (await api.get('/api/accounts')).body.find((x) => x.id === A.id);
  assert.equal(N(acc.balance), 50000);
  assert.equal(N(acc.total_in), 70000);
  assert.equal(N(acc.total_out), 20000);
  const led = (await api.get(`/api/accounts/${A.id}/ledger`)).body;
  assert.deepEqual(led.rows.map((x) => [x.kind, x.direction, N(x.amount)]), [['supplier_refund', 'in', 70000], ['supplier_payment', 'out', 20000]]);
  assert.equal(led.rows[0].description, 'Nhận lại từ F1 Trả lại');
  // reconcile bằng kind của sổ
  assert.equal((await api.put('/api/accounts/reconcile', { kind: 'supplier_refund', id: r.body.id, reconciled: true })).status, 200);
  // NCC: đã trả = 20k − 70k = −50k → số dư +50k (mình nợ họ / họ giữ tiền âm)
  const sup = (await api.get('/api/suppliers')).body.find((x) => x.id === S.id);
  assert.equal(N(sup.total_paid), -50000);
  assert.equal(N(sup.balance), 50000);
  const sl = (await api.get(`/api/suppliers/${S.id}/ledger`)).body;
  assert.ok(sl.payments.some((p) => N(p.amount) === -70000));
  // Xoá → hoàn tác
  assert.equal((await api.del(`/api/suppliers/payments/${r.body.id}`)).status, 200);
  assert.equal(N((await api.get('/api/accounts')).body.find((x) => x.id === A.id).balance), -20000);
  const a = await h.waitFor(async () => (await h.pool.query("SELECT summary FROM audit_logs WHERE entity = 'supplier_payment' AND entity_id = $1 AND action = 'payment'", [r.body.id])).rows[0]);
  assert.match(a.summary, /^Nhận lại từ F1 Trả lại/);
});

test('vé đã huỷ mà khách còn nợ phí huỷ: thu được tới đúng số còn nợ (thanh toán lẻ + phiếu thu), hết nợ thì chặn', async () => {
  const k = { customerName: 'Khách Nợ Phí', phoneNumber: '0955' };
  const d = (await api.post('/api/debts', { ...k, ticketAmount: 1000000, paid: 100000, accountId: ACC.id })).body;
  // Phí huỷ 400k, đã trả 100k → không hoàn gì, khách còn nợ 300k
  assert.equal((await api.post(`/api/debts/${d.id}/cancel`, { finalAmount: 400000, customerRefund: { amount: 0 } })).status, 200);
  let row = (await h.pool.query('SELECT ticket_amount, paid, status FROM debts WHERE id = $1', [d.id])).rows[0];
  assert.deepEqual([N(row.ticket_amount), N(row.paid), row.status], [400000, 100000, 'cancelled']);

  // Còn trong danh sách nợ của khách
  const out = (await api.get(`/api/customers/${d.customer_id}/outstanding`)).body;
  assert.ok(out.some((x) => x.type === 'debt' && x.id === d.id && N(x.remaining) === 300000));

  // Thu vượt số còn nợ → 400; thu 120k → OK
  assert.equal((await api.post('/api/payments', { debtId: d.id, amount: 350000, accountId: ACC.id })).status, 400);
  assert.equal((await api.post('/api/payments', { debtId: d.id, amount: 120000, accountId: ACC.id })).status, 201);
  // Phiếu thu phần còn lại 180k
  const r = await api.post('/api/receipts', { accountId: ACC.id, amount: 180000, allocations: [{ type: 'debt', id: d.id, amount: 180000 }] });
  assert.equal(r.status, 201);
  row = (await h.pool.query('SELECT paid FROM debts WHERE id = $1', [d.id])).rows[0];
  assert.equal(N(row.paid), 400000);

  // Hết nợ → không nhận thêm, không còn trong danh sách nợ
  assert.equal((await api.post('/api/payments', { debtId: d.id, amount: 1000, accountId: ACC.id })).status, 400);
  const out2 = (await api.get(`/api/customers/${d.customer_id}/outstanding`)).body;
  assert.ok(!out2.some((x) => x.type === 'debt' && x.id === d.id));
  const r2 = await api.post('/api/receipts', { accountId: ACC.id, amount: 1000, customerId: d.customer_id, allocations: [{ type: 'debt', id: d.id, amount: 1000 }] });
  assert.equal(r2.status, 400);
});
