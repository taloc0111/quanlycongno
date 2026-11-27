// test/passports-payments.test.js — sổ thanh toán hộ chiếu + recompute paid.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let U;
before(async () => {
  await h.start();
  U = await h.seedUsers();
});
after(() => h.stop());

const body = (over = {}) => ({
  passportNumber: 'P123', customerName: 'Trần B', phoneNumber: '0909', address: 'HCM',
  serviceDate: '2026-11-10', dueDate: '2026-11-30', totalAmount: 2000000, costAmount: 1500000, paidAmount: 800000, notes: '', ...over,
});

test('create paidAmount>0 → payments row; update không đụng paid_amount; payment recompute đúng', async () => {
  const api = h.api(U.child.token);
  const c = await api.post('/api/passports', body({ paymentTarget: 'agency' }));
  assert.equal(c.status, 201);
  assert.equal(Number(c.body.paid_amount), 800000);
  assert.equal(c.body.service_date, '2026-11-10');
  assert.equal(c.body.due_date, '2026-11-30');

  let pays = await api.get(`/api/payments?passportId=${c.body.id}`);
  assert.equal(pays.body.length, 1);
  assert.equal(Number(pays.body[0].amount), 800000);
  assert.equal(pays.body[0].method, 'cash');
  assert.equal(pays.body[0].payment_target, 'agency');
  assert.equal(pays.body[0].payment_date, '2026-11-10');

  // GET có agency_paid
  const list = await api.get('/api/passports');
  assert.equal(Number(list.body.find((p) => p.id === c.body.id).agency_paid), 800000);

  // update với paidAmount khác → bỏ qua
  const u = await api.put(`/api/passports/${c.body.id}`, body({ paidAmount: 1, totalAmount: 2500000 }));
  assert.equal(u.status, 200);
  assert.equal(Number(u.body.paid_amount), 800000);
  assert.equal(Number(u.body.total_amount), 2500000);

  // thêm 1 khoản thu → paid_amount = 800000 + 200000
  const p = await api.post('/api/payments', { passportId: c.body.id, amount: 200000, paymentDate: '2026-11-15', method: 'bank_transfer' });
  assert.equal(p.status, 201);
  let row = await h.pool.query('SELECT paid_amount FROM passports WHERE id = $1', [c.body.id]);
  assert.equal(Number(row.rows[0].paid_amount), 1000000);

  // xoá khoản thu đầu → còn 200000
  pays = await api.get(`/api/payments?passportId=${c.body.id}`);
  const first = pays.body.find((x) => Number(x.amount) === 800000);
  assert.equal((await api.del(`/api/payments/${first.id}`)).status, 200);
  row = await h.pool.query('SELECT paid_amount FROM passports WHERE id = $1', [c.body.id]);
  assert.equal(Number(row.rows[0].paid_amount), 200000);

  // audit payment
  const audit = await h.waitFor(async () => {
    const r = await h.pool.query("SELECT action FROM audit_logs WHERE entity = 'payment' ORDER BY id");
    return r.rows.length >= 2 ? r.rows : null;
  });
  assert.deepEqual(audit.map((a) => a.action), ['payment', 'delete']);
});

test('validation hộ chiếu + payment', async () => {
  const api = h.api(U.child.token);
  assert.equal((await api.post('/api/passports', body({ serviceDate: '' }))).status, 400);
  assert.equal((await api.post('/api/passports', body({ totalAmount: -1 }))).status, 400);
  assert.equal((await api.post('/api/passports', body({ paidAmount: 'x' }))).status, 400);
  assert.equal((await api.post('/api/passports', body({ passportNumber: 'P'.repeat(51) }))).status, 400);
  assert.equal((await api.post('/api/payments', { amount: 100 })).status, 400, 'không có target');
  assert.equal((await api.post('/api/payments', { debtId: 1, passportId: 1, amount: 100 })).status, 400, '2 target');
  assert.equal((await api.post('/api/payments', { passportId: 1, amount: 0 })).status, 400);
  assert.equal((await api.post('/api/payments', { passportId: 1, amount: -5 })).status, 400);
  assert.equal((await api.post('/api/payments', { passportId: 99999, amount: 5 })).status, 403);
  assert.equal((await api.get('/api/payments?passportId=abc')).status, 400);
});

test('import passports: paidAmount>0 tạo payments', async () => {
  const api = h.api(U.child.token);
  const r = await api.post('/api/passports/import', {
    rows: [
      { customerName: 'HC Import', passportNumber: 'IMPP', serviceDate: '05/11/2026', totalAmount: '3.000.000', paidAmount: '1.000.000' },
      { customerName: 'HC Thiếu ngày', totalAmount: 100 },
    ],
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.inserted, 1);
  assert.equal(r.body.failed, 1);
  const p = await h.pool.query("SELECT p.amount, p.payment_date FROM payments p JOIN passports ps ON ps.id = p.passport_id WHERE ps.passport_number = 'IMPP'");
  assert.equal(p.rows.length, 1);
  assert.equal(Number(p.rows[0].amount), 1000000);
  assert.equal(p.rows[0].payment_date, '2026-11-05');
});
