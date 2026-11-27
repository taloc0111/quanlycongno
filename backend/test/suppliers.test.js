// test/suppliers.test.js — Dòng tiền v3: nhà cung cấp (CRUD, số dư, sổ chi tiết, trả tiền, xoá có chặn).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let U;
let api;
before(async () => {
  await h.start();
  U = await h.seedUsers();
  api = h.api(U.child.token);
});
after(() => h.stop());

const N = (x) => Number(x);

test('CRUD + validate + cập nhật từng phần', async () => {
  assert.equal((await api.post('/api/suppliers', {})).status, 400);
  assert.equal((await api.post('/api/suppliers', { name: 'A', kind: 'xyz' })).status, 400);
  const c = await api.post('/api/suppliers', { name: 'Chị Hoa', phone: '0988', notes: 'down' });
  assert.equal(c.status, 201);
  assert.equal(c.body.kind, 'other', 'mặc định other');
  assert.equal(N(c.body.balance), 0);
  assert.equal(c.body.items_count, 0);
  const u = await api.put(`/api/suppliers/${c.body.id}`, { kind: 'down' });
  assert.equal(u.status, 200);
  assert.equal(u.body.kind, 'down');
  assert.equal(u.body.name, 'Chị Hoa');
  assert.equal(u.body.phone, '0988');
  assert.equal((await api.put(`/api/suppliers/${c.body.id}`, { name: '' })).status, 400);
  assert.equal((await h.api(U.agency.token).put(`/api/suppliers/${c.body.id}`, { name: 'hack' })).status, 404);
  assert.equal((await api.del(`/api/suppliers/${c.body.id}`)).status, 200, 'chưa dùng → xoá được');
  assert.equal((await api.del(`/api/suppliers/${c.body.id}`)).status, 404);
  const audit = await h.waitFor(async () => {
    const r = await h.pool.query("SELECT action FROM audit_logs WHERE entity = 'supplier' AND entity_id = $1", [c.body.id]);
    return r.rows.length >= 3 ? r.rows : null;
  });
  assert.deepEqual(audit.map((a) => a.action).sort(), ['create', 'delete', 'update']);
});

test('số dư, sổ chi tiết, trả tiền (theo dòng / trả gộp), xoá thanh toán tính lại paid_amount, xoá NCC bị chặn', async () => {
  const F1 = (await api.post('/api/suppliers', { name: 'F1 Minh', kind: 'f1' })).body;
  const F2 = (await api.post('/api/suppliers', { name: 'F1 Lan', kind: 'f1' })).body;
  const acc = (await api.post('/api/accounts', { name: 'VIB' })).body;
  const d = (await api.post('/api/debts', {
    customerName: 'Khách NCC', phoneNumber: '0977', ticketCode: 'VN555', route: 'HAN-DAD', issueDate: '2026-11-02', ticketAmount: 3000000,
    costItems: [
      { label: 'Giá vé F1', amount: 2000000, supplierId: F1.id, dueDate: '2026-11-30' },
      { label: 'Phí F1', amount: 5000, supplierId: F1.id },
      { label: 'Giá vé F2', amount: 100000, supplierId: F2.id },
    ],
  })).body;
  const [i1, i2, i3] = d.cost_items;

  // Trả 500k cho dòng i1 từ VIB, rồi trả gộp 10k.
  const p1 = await api.post(`/api/suppliers/${F1.id}/payments`, { amount: 500000, payDate: '2026-11-03', accountId: acc.id, costItemId: i1.id, notes: 'đợt 1' });
  assert.equal(p1.status, 201);
  assert.equal(p1.body.cost_item_id, i1.id);
  assert.equal(p1.body.pay_date, '2026-11-03');
  const p2 = await api.post(`/api/suppliers/${F1.id}/payments`, { amount: 10000 });
  assert.equal(p2.status, 201);
  assert.equal(p2.body.cost_item_id, null);
  let r = await h.pool.query('SELECT paid_amount FROM cost_items WHERE id = $1', [i1.id]);
  assert.equal(N(r.rows[0].paid_amount), 500000);

  // validate + dòng giá vốn của NCC khác / người khác → 400, không ghi.
  const cnt = async () => N((await h.pool.query('SELECT COUNT(*) FROM supplier_payments')).rows[0].count);
  const n0 = await cnt();
  let bad = await api.post(`/api/suppliers/${F1.id}/payments`, { amount: 1000, costItemId: i3.id });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /không thuộc nhà cung cấp/);
  const oSup = (await h.api(U.other.token).post('/api/suppliers', { name: 'NCC lạ' })).body;
  const oDebt = (await h.api(U.other.token).post('/api/debts', { customerName: 'X', ticketAmount: 1, costItems: [{ label: 'A', amount: 1, supplierId: oSup.id }] })).body;
  assert.equal((await api.post(`/api/suppliers/${F1.id}/payments`, { amount: 1000, costItemId: oDebt.cost_items[0].id })).status, 400);
  assert.equal((await api.post(`/api/suppliers/${F1.id}/payments`, { amount: 0 })).status, 400);
  assert.equal((await api.post(`/api/suppliers/${F1.id}/payments`, { amount: -5 })).status, 400);
  assert.equal((await api.post(`/api/suppliers/${F1.id}/payments`, {})).status, 400);
  assert.equal((await api.post(`/api/suppliers/${F1.id}/payments`, { amount: 5, payDate: 'x' })).status, 400);
  assert.equal((await api.post(`/api/suppliers/${oSup.id}/payments`, { amount: 5 })).status, 404, 'NCC người khác');
  assert.equal((await h.api(U.agency.token).post(`/api/suppliers/${F1.id}/payments`, { amount: 5 })).status, 404, 'cha chỉ xem');
  assert.equal(await cnt(), n0);

  // Danh sách: số dư từng NCC.
  const list = (await api.get('/api/suppliers')).body;
  const s1 = list.find((s) => s.id === F1.id);
  assert.equal(N(s1.total_cost), 2005000);
  assert.equal(N(s1.total_paid), 510000);
  assert.equal(N(s1.balance), 1495000);
  assert.equal(s1.items_count, 2);
  assert.equal(s1.unpaid_items, 2);
  assert.ok('owner_name' in s1);
  const s2 = list.find((s) => s.id === F2.id);
  assert.equal(N(s2.balance), 100000);
  assert.ok(!list.some((s) => s.id === oSup.id), 'không thấy NCC người khác');

  // Sổ chi tiết NCC.
  const led = await api.get(`/api/suppliers/${F1.id}/ledger`);
  assert.equal(led.status, 200);
  assert.equal(led.body.supplier.id, F1.id);
  assert.equal(N(led.body.total_cost), 2005000);
  assert.equal(N(led.body.total_paid), 510000);
  assert.equal(N(led.body.balance), 1495000);
  assert.equal(led.body.items.length, 2);
  const li1 = led.body.items.find((x) => x.id === i1.id);
  assert.equal(li1.label, 'Giá vé F1');
  assert.equal(N(li1.paid_amount), 500000);
  assert.equal(li1.due_date, '2026-11-30');
  assert.deepEqual(li1.target, { type: 'debt', id: d.id, customer_name: 'Khách NCC', label: 'Vé VN555 HAN-DAD' });
  assert.equal(led.body.payments.length, 2);
  const lp1 = led.body.payments.find((x) => x.id === p1.body.id);
  assert.equal(lp1.account_id, acc.id);
  assert.equal(lp1.account_name, 'VIB');
  assert.equal(lp1.cost_item_id, i1.id);
  assert.equal(lp1.cost_item_label, 'Giá vé F1');
  assert.equal(lp1.reconciled, false);
  assert.equal(lp1.notes, 'đợt 1');
  assert.deepEqual(Object.keys(lp1).sort(), ['account_id', 'account_name', 'amount', 'cost_item_id', 'cost_item_label', 'id', 'notes', 'pay_date', 'reconciled'].sort());
  // phạm vi
  assert.equal((await h.api(U.agency.token).get(`/api/suppliers/${F1.id}/ledger`)).status, 200);
  assert.equal((await h.api(U.other.token).get(`/api/suppliers/${F1.id}/ledger`)).status, 404);
  assert.ok((await h.api(U.agency.token).get('/api/suppliers')).body.some((s) => s.id === F1.id));

  // Xoá thanh toán → paid_amount tính lại (route /payments/:id không bị /:id bắt nhầm).
  assert.equal((await h.api(U.agency.token).del(`/api/suppliers/payments/${p1.body.id}`)).status, 404);
  assert.equal((await api.del(`/api/suppliers/payments/${p1.body.id}`)).status, 200);
  r = await h.pool.query('SELECT paid_amount FROM cost_items WHERE id = $1', [i1.id]);
  assert.equal(N(r.rows[0].paid_amount), 0);
  assert.equal((await api.del(`/api/suppliers/payments/${p1.body.id}`)).status, 404);
  assert.equal((await h.pool.query('SELECT 1 FROM suppliers WHERE id = $1', [F1.id])).rows.length, 1, 'NCC không bị xoá nhầm');
  assert.equal(N((await api.get('/api/suppliers')).body.find((s) => s.id === F1.id).total_paid), 10000);

  // Xoá NCC đang có dòng giá vốn / thanh toán → 400.
  let del = await api.del(`/api/suppliers/${F1.id}`);
  assert.equal(del.status, 400);
  del = await api.del(`/api/suppliers/${F2.id}`);
  assert.equal(del.status, 400, 'còn dòng giá vốn');
  // NCC chỉ có thanh toán gộp (không còn dòng) vẫn bị chặn.
  const F3 = (await api.post('/api/suppliers', { name: 'F3' })).body;
  await api.post(`/api/suppliers/${F3.id}/payments`, { amount: 1000 });
  assert.equal((await api.del(`/api/suppliers/${F3.id}`)).status, 400);
  assert.equal(i2.label, 'Phí F1');

  // audit thanh toán NCC
  await h.waitFor(async () => {
    const a = await h.pool.query("SELECT action FROM audit_logs WHERE entity = 'supplier_payment'");
    return a.rows.some((x) => x.action === 'payment') && a.rows.some((x) => x.action === 'delete');
  });
});
